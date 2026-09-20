import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import nodemailer from "nodemailer";
import { getDiscordBotStatus, startDiscordBot } from "./discord-bot.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 10000);
const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") || `http://localhost:${PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL?.replace(/\/$/, "") || BASE_URL;
const DISCORD_API = "https://discord.com/api/v10";
const REQUIRED_BOT_PERMISSIONS = String(1024n | 2048n | 16n | 268435456n | 2147483648n | 65536n);

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
      discord_id TEXT UNIQUE,
      google_id TEXT UNIQUE,
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
    CREATE TABLE IF NOT EXISTS guild_connections (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
      guild_id TEXT NOT NULL,
      guild_name TEXT,
      install_status TEXT NOT NULL DEFAULT 'discovered',
      bot_user_id TEXT,
      permissions_snapshot TEXT,
      last_error TEXT,
      last_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, guild_id)
    );
    CREATE TABLE IF NOT EXISTS change_sets (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
      template_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      plan JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS change_operations (
      id BIGSERIAL PRIMARY KEY,
      change_set_id BIGINT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
      operation_key TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(change_set_id, operation_key)
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guild_id TEXT,
      event_type TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_guild_connections_user ON guild_connections(user_id);
    CREATE INDEX IF NOT EXISTS idx_change_sets_user ON change_sets(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events(user_id, created_at DESC);
  `);
  await pool.query(`
    ALTER TABLE users ALTER COLUMN discord_id DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ;
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
async function discordUserToken(user) {
  let accessToken = decrypt(user?.access_token);
  const expiresAt = user?.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
  if (accessToken && expiresAt > Date.now() + 60_000) return accessToken;
  const refreshToken = decrypt(user?.refresh_token);
  if (!refreshToken || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return accessToken;
  const response = await fetch(`${DISCORD_API}/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: refreshToken }) });
  if (!response.ok) return null;
  const tokens = await response.json();
  const expires = new Date(Date.now() + Number(tokens.expires_in || 604800) * 1000);
  await pool.query("UPDATE users SET access_token=$1,refresh_token=$2,token_expires_at=$3,updated_at=NOW() WHERE id=$4", [encrypt(tokens.access_token), encrypt(tokens.refresh_token || refreshToken), expires, user.id]);
  return tokens.access_token;
}
async function discordBotFetch(pathname, options = {}) {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, status: 503, data: { message: "Discord bot غير مهيأ" } };
  const response = await fetch(`${DISCORD_API}${pathname}`, { ...options, headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  let data = null; try { data = await response.json(); } catch { data = {}; }
  return { ok: response.ok, status: response.status, data, headers: response.headers };
}
async function manageableGuilds(user) {
  const token = await discordUserToken(user);
  if (!token) return [];
  const response = await fetch(`${DISCORD_API}/users/@me/guilds`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return [];
  return (await response.json()).filter((g) => (BigInt(g.permissions || "0") & 0x20n) === 0x20n || g.owner);
}
async function authorizedGuild(user, guildId) {
  return (await manageableGuilds(user)).find((guild) => String(guild.id) === String(guildId)) || null;
}
const TEMPLATES = {
  gaming: { name: "مجتمع الألعاب", categories: [{ name: "WELCOME", channels: ["start-here", "rules"] }, { name: "COMMUNITY", channels: ["general", "announcements", "bot-commands"] }, { name: "VOICE LOUNGE", channels: ["Lounge", "Team Room"] }], roles: ["Member", "Moderator"] },
  support: { name: "مركز الدعم", categories: [{ name: "WELCOME", channels: ["start-here", "rules"] }, { name: "SUPPORT", channels: ["help", "tickets", "announcements"] }], roles: ["Member", "Support"] },
  study: { name: "مساحة التركيز", categories: [{ name: "WELCOME", channels: ["start-here", "rules"] }, { name: "STUDY", channels: ["general", "resources", "study-room"] }], roles: ["Member", "Study Lead"] }
};
function makeTemplatePlan(templateKey) {
  const template = TEMPLATES[templateKey] || TEMPLATES.gaming;
  const operations = [];
  template.categories.forEach((category, categoryIndex) => {
    const categoryKey = `category:${categoryIndex}:${category.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    operations.push({ operation_key: categoryKey, resource_type: "category", name: category.name, channels: category.channels });
    category.channels.forEach((name, channelIndex) => operations.push({ operation_key: `${categoryKey}:channel:${channelIndex}`, resource_type: "channel", name, parent_key: categoryKey }));
  });
  template.roles.forEach((name, index) => operations.push({ operation_key: `role:${index}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, resource_type: "role", name }));
  return { template_key: templateKey, name: template.name, operations };
}
function isAdmin(user) {
  const ids = (process.env.ADMIN_DISCORD_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const emails = (process.env.ADMIN_EMAILS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !!user && (ids.includes(String(user.discord_id)) || emails.includes(String(user.email || "").toLowerCase()));
}
function safeReturnTo(value) {
  const target = String(value || "");
  return target.startsWith("/") && !target.startsWith("//") && !target.includes("\\") ? target : null;
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

function mailTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}
async function sendWelcomeEmail(user) {
  if (!user?.email || user.welcome_sent_at) return;
  const transport = mailTransport();
  if (!transport) return;
  await transport.sendMail({ from: process.env.SMTP_FROM || "diskoko <support@diskoko.com>", to: user.email, replyTo: "support@diskoko.com", subject: "مرحبًا بك في diskoko | ديسكوكو", text: `أهلًا ${user.display_name || user.username}، تم إنشاء حسابك في ديسكوكو بنجاح. افتح حسابك من https://diskoko.com/account.html وللدعم: support@diskoko.com`, html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h1>مرحبًا بك في ديسكوكو</h1><p>أهلًا ${user.display_name || user.username}، تم إنشاء حسابك بنجاح.</p><p><a href="https://diskoko.com/account.html">افتح لوحة حسابك</a></p><p>للمساعدة: <a href="mailto:support@diskoko.com">support@diskoko.com</a></p></div>` });
  await pool.query("UPDATE users SET welcome_sent_at=NOW() WHERE id=$1", [user.id]);
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "diskoko", bot: getDiscordBotStatus(), time: new Date().toISOString() }));
app.get("/auth/discord", rateLimit(12, 60_000), (req, res) => {
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;
  req.session.returnTo = safeReturnTo(req.query.returnTo);
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
    void sendWelcomeEmail(rows[0]).catch((error) => console.error("Welcome email failed", error));
    await audit(rows[0].id, "login", "user", rows[0].id);
    const returnTo = safeReturnTo(req.session.returnTo); delete req.session.returnTo;
    res.redirect(returnTo || (isAdmin(rows[0]) ? "/admin.html" : "/account.html"));
  } catch (error) { next(error); }
});
app.get("/auth/google", rateLimit(12, 60_000), (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).send("تسجيل Google غير مفعّل بعد");
  const state = crypto.randomBytes(24).toString("hex");
  req.session.googleOauthState = state;
  req.session.returnTo = safeReturnTo(req.query.returnTo);
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${BASE_URL}/auth/google/callback`, response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});
app.get("/auth/google/callback", async (req, res, next) => {
  try {
    if (!req.query.code || req.query.state !== req.session.googleOauthState) return res.status(400).send("طلب تسجيل الدخول غير صالح");
    delete req.session.googleOauthState;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: "authorization_code", code: String(req.query.code), redirect_uri: `${BASE_URL}/auth/google/callback` }) });
    if (!tokenResponse.ok) throw new Error("Google token exchange failed");
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) throw new Error("Google profile request failed");
    const profile = await profileResponse.json();
    const username = String(profile.email || profile.name || profile.sub).slice(0, 80);
    const { rows } = await pool.query(`INSERT INTO users(google_id,username,display_name,avatar,email,last_login_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(google_id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,avatar=EXCLUDED.avatar,email=EXCLUDED.email,last_login_at=NOW(),updated_at=NOW() RETURNING *`, [profile.sub, username, profile.name || username, profile.picture || null, profile.email || null]);
    req.session.userId = rows[0].id;
    void sendWelcomeEmail(rows[0]).catch((error) => console.error("Welcome email failed", error));
    await audit(rows[0].id, "login.google", "user", rows[0].id);
    const returnTo = safeReturnTo(req.session.returnTo); delete req.session.returnTo;
    res.redirect(returnTo || (isAdmin(rows[0]) ? "/admin.html" : "/account.html"));
  } catch (error) { next(error); }
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", async (req, res, next) => { try { const user = await currentUser(req); res.json({ user: user ? publicUser(user) : null, loginUrl: "/auth/discord" }); } catch (e) { next(e); } });
app.get("/api/guilds", requireUser, async (req, res, next) => {
  try {
    const guilds = await manageableGuilds(req.user);
    if (!guilds.length && !req.user.access_token) return res.status(401).json({ error: "أعد تسجيل الدخول إلى Discord" });
    const connections = await pool.query("SELECT guild_id,install_status,bot_user_id,permissions_snapshot,last_error,last_verified_at FROM guild_connections WHERE user_id=$1", [req.user.id]);
    const byGuild = new Map(connections.rows.map((row) => [String(row.guild_id), row]));
    await Promise.all(guilds.map((guild) => pool.query("INSERT INTO guild_connections(user_id,guild_id,guild_name,install_status,updated_at) VALUES($1,$2,$3,'discovered',NOW()) ON CONFLICT(user_id,guild_id) DO UPDATE SET guild_name=EXCLUDED.guild_name,updated_at=NOW()", [req.user.id, guild.id, guild.name])));
    const visible = guilds.map(({ id, name, icon, owner, permissions }) => ({ id, name, icon, owner, permissions, connection: byGuild.get(String(id)) || { install_status: "discovered" } }));
    res.json({ guilds: visible });
  } catch (e) { next(e); }
});
app.get("/api/guilds/:guildId/connection", requireUser, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.params.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const bot = await discordBotFetch(`/guilds/${encodeURIComponent(req.params.guildId)}`);
    const row = (await pool.query("SELECT * FROM guild_connections WHERE user_id=$1 AND guild_id=$2", [req.user.id, req.params.guildId])).rows[0] || null;
    const botInstalled = bot.ok;
    const connection = { ...(row || {}), guild_id: guild.id, guild_name: guild.name, bot_installed: botInstalled, install_status: botInstalled ? "installed" : (row?.install_status || "install_required"), required_permissions: REQUIRED_BOT_PERMISSIONS };
    await pool.query("INSERT INTO guild_connections(user_id,guild_id,guild_name,install_status,last_verified_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT(user_id,guild_id) DO UPDATE SET guild_name=EXCLUDED.guild_name,install_status=EXCLUDED.install_status,last_verified_at=NOW(),updated_at=NOW()", [req.user.id, guild.id, guild.name, connection.install_status]);
    res.json({ connection });
  } catch (e) { next(e); }
});
app.get("/api/guilds/:guildId/install-url", requireUser, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.params.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID || "", scope: "bot applications.commands", permissions: REQUIRED_BOT_PERMISSIONS, guild_id: String(guild.id), disable_guild_select: "true" });
    res.json({ url: `https://discord.com/oauth2/authorize?${params}`, guild: { id: guild.id, name: guild.name } });
  } catch (e) { next(e); }
});
app.post("/api/guilds/:guildId/connection/verify", requireUser, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.params.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const bot = await discordBotFetch(`/guilds/${encodeURIComponent(req.params.guildId)}`);
    const status = bot.ok ? "installed" : "permissions_insufficient";
    await pool.query("INSERT INTO guild_connections(user_id,guild_id,guild_name,install_status,last_error,last_verified_at,updated_at) VALUES($1,$2,$3,$4,$5,NOW(),NOW()) ON CONFLICT(user_id,guild_id) DO UPDATE SET guild_name=EXCLUDED.guild_name,install_status=EXCLUDED.install_status,last_error=EXCLUDED.last_error,last_verified_at=NOW(),updated_at=NOW()", [req.user.id, guild.id, guild.name, status, bot.ok ? null : `Discord API ${bot.status}`]);
    await audit(req.user.id, "guild.verify", "guild", guild.id, { status });
    res.json({ ok: bot.ok, status, bot: bot.ok ? { id: bot.data.id, name: bot.data.name } : null });
  } catch (e) { next(e); }
});
app.get("/api/templates", requireUser, (_req, res) => res.json({ templates: Object.entries(TEMPLATES).map(([key, value]) => ({ key, name: value.name, categories: value.categories.length, roles: value.roles.length })) }));
app.post("/api/projects/:id/bind-guild", requireUser, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.body.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const { rows } = await pool.query("UPDATE projects SET guild_id=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *", [guild.id, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "المشروع غير موجود" });
    await pool.query("UPDATE guild_connections SET project_id=$1,updated_at=NOW() WHERE user_id=$2 AND guild_id=$3", [rows[0].id, req.user.id, guild.id]);
    await audit(req.user.id, "project.bind_guild", "project", rows[0].id, { guild_id: guild.id });
    res.json({ project: rows[0] });
  } catch (e) { next(e); }
});
app.post("/api/change-sets", requireUser, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.body.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const templateKey = String(req.body.templateKey || "gaming");
    const plan = makeTemplatePlan(templateKey);
    const projectId = req.body.projectId ? Number(req.body.projectId) : null;
    const { rows } = await pool.query("INSERT INTO change_sets(user_id,guild_id,project_id,template_key,status,plan) VALUES($1,$2,$3,$4,'draft',$5) RETURNING *", [req.user.id, guild.id, projectId, templateKey, plan]);
    await pool.query("INSERT INTO change_operations(change_set_id,operation_key,resource_type,result) SELECT $1,(item->>'operation_key'),(item->>'resource_type'),item FROM jsonb_array_elements($2::jsonb->'operations') item", [rows[0].id, JSON.stringify(plan)]);
    await audit(req.user.id, "change_set.create", "change_set", rows[0].id, { guild_id: guild.id, template_key: templateKey });
    res.status(201).json({ changeSet: rows[0], plan });
  } catch (e) { next(e); }
});
app.get("/api/change-sets/:id", requireUser, async (req, res, next) => { try { const changeSet = (await pool.query("SELECT * FROM change_sets WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0]; if (!changeSet) return res.status(404).json({ error: "خطة التغيير غير موجودة" }); const operations = (await pool.query("SELECT * FROM change_operations WHERE change_set_id=$1 ORDER BY id", [changeSet.id])).rows; res.json({ changeSet, operations }); } catch (e) { next(e); } });
app.post("/api/change-sets/:id/apply", requireUser, async (req, res, next) => {
  try {
    const changeSet = (await pool.query("SELECT * FROM change_sets WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0];
    if (!changeSet) return res.status(404).json({ error: "خطة التغيير غير موجودة" });
    const guild = await authorizedGuild(req.user, changeSet.guild_id);
    if (!guild) return res.status(403).json({ error: "لم تعد تملك صلاحية إدارة هذا السيرفر" });
    const guildCheck = await discordBotFetch(`/guilds/${encodeURIComponent(changeSet.guild_id)}`);
    if (!guildCheck.ok) return res.status(409).json({ error: "ثبت Bot Diskoko في السيرفر أولًا ثم أعد التحقق" });
    const [channelsResponse, rolesResponse] = await Promise.all([discordBotFetch(`/guilds/${changeSet.guild_id}/channels`), discordBotFetch(`/guilds/${changeSet.guild_id}/roles`)]);
    if (!channelsResponse.ok || !rolesResponse.ok) return res.status(502).json({ error: "تعذر قراءة بنية السيرفر من Discord" });
    await pool.query("UPDATE change_sets SET status='running',updated_at=NOW() WHERE id=$1", [changeSet.id]);
    const operations = (await pool.query("SELECT * FROM change_operations WHERE change_set_id=$1 AND status<>'succeeded' ORDER BY id", [changeSet.id])).rows;
    const categories = new Map(channelsResponse.data.filter((item) => item.type === 4).map((item) => [item.name.toLowerCase(), item]));
    const channels = channelsResponse.data.filter((item) => item.type === 0);
    const roles = new Map(rolesResponse.data.map((item) => [item.name.toLowerCase(), item]));
    const categoryResources = new Map();
    for (const operation of operations) {
      const data = operation.result || {};
      let resource = null;
      if (operation.resource_type === "category") resource = categories.get(String(data.name || "").toLowerCase());
      if (operation.resource_type === "channel") { const parentId = categoryResources.get(data.parent_key); resource = channels.find((item) => item.name.toLowerCase() === String(data.name || "").toLowerCase() && (!parentId || item.parent_id === parentId)); }
      if (operation.resource_type === "role") resource = roles.get(String(data.name || "").toLowerCase());
      if (!resource) {
        const parentId = categoryResources.get(data.parent_key);
        const body = operation.resource_type === "category" ? { name: data.name, type: 4 } : operation.resource_type === "channel" ? { name: data.name, type: 0, ...(parentId ? { parent_id: parentId } : {}) } : { name: data.name, mentionable: false };
        const created = await discordBotFetch(`/guilds/${changeSet.guild_id}/${operation.resource_type === "role" ? "roles" : "channels"}`, { method: "POST", body: JSON.stringify(body) });
        if (!created.ok) { await pool.query("UPDATE change_operations SET status='failed',result=$1,updated_at=NOW() WHERE id=$2", [created.data, operation.id]); throw new Error(`Discord ${created.status} while creating ${operation.resource_type}`); }
        resource = created.data;
      }
      if (operation.resource_type === "category") categoryResources.set(operation.operation_key, resource.id);
      await pool.query("UPDATE change_operations SET status='succeeded',resource_id=$1,result=$2,updated_at=NOW() WHERE id=$3", [resource.id, resource, operation.id]);
      await pool.query("INSERT INTO usage_events(user_id,guild_id,event_type,metadata) VALUES($1,$2,$3,$4)", [req.user.id, changeSet.guild_id, `discord.${operation.resource_type}.ensure`, { change_set_id: changeSet.id, resource_id: resource.id }]);
    }
    await pool.query("UPDATE change_sets SET status='succeeded',updated_at=NOW() WHERE id=$1", [changeSet.id]);
    await audit(req.user.id, "change_set.apply", "change_set", changeSet.id, { guild_id: changeSet.guild_id });
    res.json({ ok: true, status: "succeeded", changeSetId: changeSet.id });
  } catch (e) { await pool.query("UPDATE change_sets SET status='failed',updated_at=NOW() WHERE id=$1", [req.params.id]).catch(() => {}); next(e); }
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
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "account.html")));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(__dirname, "account.html")));
app.get("/studio", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "حدث خطأ غير متوقع" }); });

migrate().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`diskoko running on ${PORT}`));
  void startDiscordBot();
}).catch((error) => { console.error("Database migration failed", error); process.exit(1); });
