import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { getDiscordBotStatus, startDiscordBot } from "./discord-bot.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 10000);
const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") || `http://localhost:${PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL?.replace(/\/$/, "") || BASE_URL;
const DISCORD_API = "https://discord.com/api/v10";

const required = ["DATABASE_URL", "SESSION_SECRET", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) console.warn(`Missing environment variables: ${missing.join(", ")}`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      discord_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT,
      avatar TEXT,
      email TEXT,
      plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','starter','growth','complete')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','cancelled')),
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS projects (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      guild_id TEXT,
      design JSONB NOT NULL DEFAULT '{}'::jsonb,
      deployment_status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'manual',
      provider_ref TEXT,
      plan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      current_period_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);
  await pool.query(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;
    UPDATE users SET plan = CASE plan WHEN 'free' THEN 'trial' WHEN 'pro' THEN 'growth' WHEN 'studio' THEN 'complete' ELSE plan END;
    ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'trial';
    ALTER TABLE users ADD CONSTRAINT users_plan_check CHECK (plan IN ('trial','starter','growth','complete'));
  `);
}

const PgStore = connectPgSimple(session);
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: "512kb" }));
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  name: "diskoko.sid",
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 14 },
}));

const attempts = new Map();
function rateLimit(max = 80, windowMs = 60_000) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const item = attempts.get(key) || { count: 0, reset: now + windowMs };
    if (now > item.reset) Object.assign(item, { count: 0, reset: now + windowMs });
    item.count += 1; attempts.set(key, item);
    if (item.count > max) return res.status(429).json({ error: "طلبات كثيرة، حاول بعد قليل" });
    next();
  };
}
app.use("/api", rateLimit());

function encryptionKey() {
  const raw = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || "";
  return crypto.createHash("sha256").update(raw).digest();
}
function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decrypt(value) {
  if (!value) return null;
  const [iv, tag, data] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
function isAdmin(user) {
  const ids = (process.env.ADMIN_DISCORD_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  return !!user && ids.includes(String(user.discord_id));
}
function publicUser(row) {
  return { id: row.id, discordId: row.discord_id, username: row.username, displayName: row.display_name, avatar: row.avatar, email: row.email, plan: row.plan, status: row.status, isAdmin: isAdmin(row), createdAt: row.created_at };
}
async function currentUser(req) {
  if (!req.session.userId) return null;
  const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [req.session.userId]);
  return rows[0] || null;
}
function requireUser(req, res, next) {
  currentUser(req).then((user) => {
    if (!user) return res.status(401).json({ error: "يلزم تسجيل الدخول" });
    if (user.status !== "active") return res.status(403).json({ error: "الحساب موقوف" });
    req.user = user; next();
  }).catch(next);
}
function requireAdmin(req, res, next) {
  requireUser(req, res, () => isAdmin(req.user) ? next() : res.status(403).json({ error: "غير مصرح" }));
}
async function audit(actor, action, targetType, targetId, details = {}) {
  await pool.query("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)", [actor || null, action, targetType, targetId ? String(targetId) : null, details]);
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "diskoko", bot: getDiscordBotStatus(), time: new Date().toISOString() }));
app.get("/auth/discord", rateLimit(12, 60_000), (req, res) => {
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;
  const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID || "", redirect_uri: `${BASE_URL}/auth/discord/callback`, response_type: "code", scope: "identify email guilds", state, prompt: "consent" });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});
app.get("/auth/discord/callback", async (req, res, next) => {
  try {
    if (!req.query.code || req.query.state !== req.session.oauthState) return res.status(400).send("طلب تسجيل الدخول غير صالح");
    delete req.session.oauthState;
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code: String(req.query.code), redirect_uri: `${BASE_URL}/auth/discord/callback` }) });
    if (!tokenResponse.ok) throw new Error("Discord token exchange failed");
    const tokens = await tokenResponse.json();
    const discordResponse = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!discordResponse.ok) throw new Error("Discord profile request failed");
    const profile = await discordResponse.json();
    const avatar = profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128` : null;
    const expires = new Date(Date.now() + Number(tokens.expires_in || 604800) * 1000);
    const { rows } = await pool.query(`INSERT INTO users(discord_id,username,display_name,avatar,email,access_token,refresh_token,token_expires_at,last_login_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT(discord_id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,avatar=EXCLUDED.avatar,email=EXCLUDED.email,access_token=EXCLUDED.access_token,refresh_token=EXCLUDED.refresh_token,token_expires_at=EXCLUDED.token_expires_at,last_login_at=NOW(),updated_at=NOW() RETURNING *`,
      [profile.id, profile.username, profile.global_name || profile.username, avatar, profile.email || null, encrypt(tokens.access_token), encrypt(tokens.refresh_token), expires]);
    req.session.userId = rows[0].id;
    await audit(rows[0].id, "login", "user", rows[0].id);
    res.redirect(isAdmin(rows[0]) ? "/admin.html" : "/account.html");
  } catch (error) { next(error); }
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", async (req, res, next) => { try { const user = await currentUser(req); res.json({ user: user ? publicUser(user) : null, loginUrl: "/auth/discord" }); } catch (e) { next(e); } });
app.get("/api/guilds", requireUser, async (req, res, next) => {
  try {
    const response = await fetch(`${DISCORD_API}/users/@me/guilds`, { headers: { Authorization: `Bearer ${decrypt(req.user.access_token)}` } });
    if (!response.ok) return res.status(401).json({ error: "أعد تسجيل الدخول إلى Discord" });
    const guilds = (await response.json()).filter((g) => (BigInt(g.permissions) & 0x20n) === 0x20n || g.owner).map(({ id, name, icon, owner }) => ({ id, name, icon, owner }));
    res.json({ guilds });
  } catch (e) { next(e); }
});
app.get("/api/projects", requireUser, async (req, res, next) => { try { const { rows } = await pool.query("SELECT id,name,guild_id,design,deployment_status,created_at,updated_at FROM projects WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]); res.json({ projects: rows }); } catch (e) { next(e); } });
app.post("/api/projects", requireUser, async (req, res, next) => {
  try {
    const name = String(req.body.name || "عالمي الجديد").trim().slice(0, 80);
    const design = req.body.design && typeof req.body.design === "object" ? req.body.design : {};
    const { rows } = await pool.query("INSERT INTO projects(user_id,name,guild_id,design) VALUES($1,$2,$3,$4) RETURNING *", [req.user.id, name, req.body.guildId || null, design]);
    await audit(req.user.id, "project.create", "project", rows[0].id); res.status(201).json({ project: rows[0] });
  } catch (e) { next(e); }
});
app.put("/api/projects/:id", requireUser, async (req, res, next) => {
  try {
    const { rows } = await pool.query("UPDATE projects SET name=COALESCE($1,name),guild_id=COALESCE($2,guild_id),design=COALESCE($3,design),updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *", [req.body.name?.slice(0,80) || null, req.body.guildId || null, req.body.design || null, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "المشروع غير موجود" });
    await audit(req.user.id, "project.update", "project", rows[0].id); res.json({ project: rows[0] });
  } catch (e) { next(e); }
});

app.get("/api/admin/stats", requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM users WHERE status='active') active,(SELECT COUNT(*) FROM users WHERE plan='starter') starter,(SELECT COUNT(*) FROM users WHERE plan='growth') growth,(SELECT COUNT(*) FROM users WHERE plan='complete') complete,(SELECT COUNT(*) FROM projects) projects`);
    res.json({ stats: rows[0] });
  } catch (e) { next(e); }
});
app.get("/api/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const q = `%${String(req.query.q || "").slice(0,80)}%`;
    const { rows } = await pool.query("SELECT id,discord_id,username,display_name,avatar,email,plan,status,created_at,last_login_at FROM users WHERE username ILIKE $1 OR COALESCE(display_name,'') ILIKE $1 OR COALESCE(email,'') ILIKE $1 ORDER BY created_at DESC LIMIT 200", [q]);
    res.json({ users: rows.map(publicUser) });
  } catch (e) { next(e); }
});
app.patch("/api/admin/users/:id", requireAdmin, async (req, res, next) => {
  try {
    const plan = ["trial","starter","growth","complete"].includes(req.body.plan) ? req.body.plan : null;
    const status = ["active","suspended","cancelled"].includes(req.body.status) ? req.body.status : null;
    const { rows } = await pool.query("UPDATE users SET plan=COALESCE($1,plan),status=COALESCE($2,status),updated_at=NOW() WHERE id=$3 RETURNING *", [plan, status, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "المستخدم غير موجود" });
    await audit(req.user.id, "admin.user.update", "user", rows[0].id, { plan, status }); res.json({ user: publicUser(rows[0]) });
  } catch (e) { next(e); }
});
app.get("/api/admin/audit", requireAdmin, async (_req, res, next) => { try { const { rows } = await pool.query("SELECT a.*,u.username actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 100"); res.json({ logs: rows }); } catch (e) { next(e); } });

app.use(express.static(__dirname, { extensions: ["html"], maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(__dirname, "account.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "حدث خطأ غير متوقع" }); });

migrate().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`diskoko running on ${PORT}`));
  void startDiscordBot();
}).catch((error) => { console.error("Database migration failed", error); process.exit(1); });
