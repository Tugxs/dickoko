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
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const required = ["DATABASE_URL", "SESSION_SECRET", "ENCRYPTION_KEY", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  const message = `Missing environment variables: ${missing.join(", ")}`;
  if (IS_PRODUCTION) throw new Error(message);
  console.warn(message);
}

const SESSION_SECRET = process.env.SESSION_SECRET || "development-only-change-me";
const allowedOrigins = new Set([BASE_URL, FRONTEND_URL].filter(Boolean));

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
    CREATE TABLE IF NOT EXISTS subscription_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      provider_ref TEXT,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider, event_id)
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
    CREATE TABLE IF NOT EXISTS custom_templates (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      definition JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS custom_bots (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      definition JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, slug)
    );
    CREATE TABLE IF NOT EXISTS bot_guild_settings (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL UNIQUE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      command_keys JSONB NOT NULL DEFAULT '["help","ping","about"]'::jsonb,
      log_channel_id TEXT,
      locale TEXT NOT NULL DEFAULT 'ar',
      welcome_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS template_versions (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES custom_templates(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      definition JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(template_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscription_events_user ON subscription_events(user_id, processed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_guild_connections_user ON guild_connections(user_id);
    CREATE INDEX IF NOT EXISTS idx_change_sets_user ON change_sets(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_custom_templates_user ON custom_templates(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_custom_bots_user ON custom_bots(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bot_guild_settings_updated ON bot_guild_settings(updated_at DESC);
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
app.disable("x-powered-by");
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
app.use(express.json({ limit: "512kb", verify: (req, _res, buffer) => { if (req.path === "/api/webhooks/billing") req.rawBody = Buffer.from(buffer); } }));
app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH"].includes(req.method) && req.is("application/json") && (!req.body || typeof req.body !== "object" || Array.isArray(req.body))) return res.status(400).json({ error: "يجب أن تكون بيانات الطلب JSON object صالحًا" });
  next();
});
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: "diskoko.sid",
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 14 },
}));

function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  return req.session.csrfToken;
}

function sameOrigin(req) {
  const origin = req.get("origin");
  return !origin || allowedOrigins.has(origin);
}

app.get("/api/csrf-token", (req, res) => res.json({ token: csrfToken(req) }));
app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (!sameOrigin(req)) return res.status(403).json({ error: "مصدر الطلب غير مسموح" });
  const token = req.get("x-csrf-token");
  if (!token || token !== csrfToken(req)) return res.status(403).json({ error: "رمز حماية الطلب غير صالح أو مفقود" });
  next();
});

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
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is required for token encryption");
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
const PLAN_LIMITS = {
  trial: { servers: 1, customBots: 1, changeSetsPerMonth: 10 },
  starter: { servers: 1, customBots: 5, changeSetsPerMonth: 50 },
  growth: { servers: 3, customBots: 10, changeSetsPerMonth: 250 },
  complete: { servers: 5, customBots: 5, changeSetsPerMonth: 1000 },
};
function entitlementsFor(user) { return PLAN_LIMITS[user?.plan] || PLAN_LIMITS.trial; }
async function planCapacity(user, kind) {
  const limits = entitlementsFor(user);
  if (kind === "servers") {
    const { rows } = await pool.query("SELECT COUNT(DISTINCT guild_id)::int AS count FROM guild_connections WHERE user_id=$1 AND install_status <> 'removed'", [user.id]);
    return { used: rows[0].count, limit: limits.servers };
  }
  if (kind === "customBots") {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM custom_bots WHERE user_id=$1 AND status <> 'deleted'", [user.id]);
    return { used: rows[0].count, limit: limits.customBots };
  }
  if (kind === "changeSetsPerMonth") {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM change_sets WHERE user_id=$1 AND created_at >= date_trunc('month', NOW())", [user.id]);
    return { used: rows[0].count, limit: limits.changeSetsPerMonth };
  }
  return { used: 0, limit: 0 };
}
async function requirePlanCapacity(user, kind) {
  const capacity = await planCapacity(user, kind);
  if (capacity.used >= capacity.limit) {
    const error = new Error(`وصلت إلى حد باقة ${user.plan} لهذه الميزة`);
    error.status = 402;
    error.code = "PLAN_LIMIT_REACHED";
    error.capacity = capacity;
    throw error;
  }
  return capacity;
}
const BILLING_PLANS = new Set(["trial", "starter", "growth", "complete"]);
const BILLING_STATUSES = new Set(["trial", "active", "past_due", "cancelled", "expired"]);
function verifyBillingSignature(req) {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  const signature = String(req.get("x-diskoko-signature") || "");
  if (!secret || !signature || !req.rawBody) return false;
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
function billingPayload(body) {
  const plan = String(body?.plan || "");
  const status = String(body?.status || "");
  const userId = Number(body?.user_id);
  if (!Number.isSafeInteger(userId) || userId < 1 || !BILLING_PLANS.has(plan) || !BILLING_STATUSES.has(status)) return null;
  const periodEnd = body.current_period_end ? new Date(body.current_period_end) : null;
  if (periodEnd && Number.isNaN(periodEnd.getTime())) return null;
  return { userId, plan, status, provider: String(body.provider || "external").slice(0, 40), providerRef: String(body.provider_ref || "").slice(0, 200) || null, periodEnd };
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
app.post("/api/webhooks/billing", async (req, res, next) => {
  if (!process.env.BILLING_WEBHOOK_SECRET) return res.status(503).json({ error: "لم يتم إعداد سر webhook للفوترة" });
  if (!verifyBillingSignature(req)) return res.status(401).json({ error: "توقيع webhook غير صالح" });
  const eventId = String(req.get("x-diskoko-event-id") || req.body?.id || "").slice(0, 200);
  const eventType = String(req.body?.type || "subscription.updated").slice(0, 100);
  const payload = billingPayload(req.body?.data || req.body);
  if (!eventId || !payload) return res.status(400).json({ error: "بيانات حدث الفوترة غير صالحة" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query("INSERT INTO subscription_events(provider,event_id,event_type,provider_ref,user_id,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider,event_id) DO NOTHING RETURNING id", [payload.provider, eventId, eventType, payload.providerRef, payload.userId, req.body]);
    if (!inserted.rows[0]) { await client.query("ROLLBACK"); return res.json({ ok: true, duplicate: true }); }
    const periodEnd = payload.periodEnd ? payload.periodEnd.toISOString() : null;
    const existing = await client.query("SELECT id FROM subscriptions WHERE user_id=$1 AND provider=$2 AND COALESCE(provider_ref,'')=COALESCE($3,'') ORDER BY updated_at DESC LIMIT 1", [payload.userId, payload.provider, payload.providerRef]);
    if (existing.rows[0]) await client.query("UPDATE subscriptions SET plan=$1,status=$2,current_period_end=$3,updated_at=NOW() WHERE id=$4", [payload.plan, payload.status, periodEnd, existing.rows[0].id]);
    else await client.query("INSERT INTO subscriptions(user_id,provider,provider_ref,plan,status,current_period_end) VALUES($1,$2,$3,$4,$5,$6)", [payload.userId, payload.provider, payload.providerRef, payload.plan, payload.status, periodEnd]);
    await client.query("UPDATE users SET plan=$1,status=$2,updated_at=NOW() WHERE id=$3", [payload.plan, ["cancelled", "expired"].includes(payload.status) ? "cancelled" : "active", payload.userId]);
    await client.query("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES(NULL,$1,'user',$2,$3)", ["billing.subscription.updated", payload.userId, { event_id: eventId, provider: payload.provider, plan: payload.plan, status: payload.status }]);
    await client.query("COMMIT");
    res.json({ ok: true, eventId, plan: payload.plan, status: payload.status });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); next(error); } finally { client.release(); }
});
app.get("/api/account/overview", requireUser, async (req, res, next) => { try { const [subscription, guilds, connections, activity, customBots, changeSets] = await Promise.all([pool.query("SELECT plan,status,current_period_end,created_at,updated_at FROM subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1", [req.user.id]), manageableGuilds(req.user), pool.query("SELECT guild_id,guild_name,install_status,last_error,last_verified_at,updated_at FROM guild_connections WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]), pool.query("SELECT event_type,created_at,metadata FROM usage_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8", [req.user.id]), planCapacity(req.user, "customBots"), planCapacity(req.user, "changeSetsPerMonth")]); const byGuild = new Map(connections.rows.map((row) => [String(row.guild_id), row])); res.json({ user: publicUser(req.user), plan: subscription.rows[0] || { plan: req.user.plan, status: req.user.plan === "trial" ? "trial" : "active", current_period_end: null }, limits: entitlementsFor(req.user), usage: { customBots, changeSetsPerMonth: changeSets }, servers: guilds.map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon, owner: guild.owner, permissions: guild.permissions, connection: byGuild.get(String(guild.id)) || { guild_id: guild.id, guild_name: guild.name, install_status: "not_connected" } })), activity: activity.rows }); } catch (e) { next(e); } });
app.get("/api/account/subscription-events", requireUser, async (req, res, next) => { try { const { rows } = await pool.query("SELECT provider,event_id,event_type,provider_ref,payload,processed_at FROM subscription_events WHERE user_id=$1 ORDER BY processed_at DESC LIMIT 50", [req.user.id]); res.json({ events: rows }); } catch (e) { next(e); } });
app.get("/api/account/entitlements", requireUser, async (req, res, next) => { try { const [customBots, changeSetsPerMonth] = await Promise.all([planCapacity(req.user, "customBots"), planCapacity(req.user, "changeSetsPerMonth")]); res.json({ plan: req.user.plan, limits: entitlementsFor(req.user), usage: { customBots, changeSetsPerMonth } }); } catch (e) { next(e); } });
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
    if (!process.env.DISCORD_CLIENT_ID) return res.status(503).json({ error: "لم يتم إعداد معرف تطبيق Discord على الخادم" });
    const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID || "", scope: "bot applications.commands", permissions: REQUIRED_BOT_PERMISSIONS, guild_id: String(guild.id), disable_guild_select: "true" });
    res.json({ url: `https://discord.com/oauth2/authorize?${params.toString()}`, guild: { id: guild.id, name: guild.name }, permissions: REQUIRED_BOT_PERMISSIONS });
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
const BOT_CATALOG = [
  { key: "assistant", name: "Diskoko Assistant", group: "community", description: "الترحيب والمساعدة وصياغة الإعلانات", status: "available", permissions: "قراءة وإرسال الرسائل" },
  { key: "guardian", name: "Guardian", group: "security", description: "مقترحات الإشراف ومكافحة السبام", status: "available", permissions: "إدارة الرسائل فقط" },
  { key: "events", name: "Event Host", group: "automation", description: "الفعاليات والتذكيرات والتسجيل", status: "available", permissions: "إرسال الرسائل وإدارة الفعاليات" },
  { key: "insights", name: "Insight", group: "analytics", description: "تقارير النشاط والصحة", status: "planned", permissions: "قراءة الإحصاءات" },
  { key: "music", name: "Melody", group: "entertainment", description: "الصوت وقوائم التشغيل", status: "planned", permissions: "الاتصال بالقنوات الصوتية" }
];
const COMMAND_CATALOG = [
  { key: "help", name: "/help", group: "أساسي", description: "عرض أوامر البوت ومركز المساعدة", permission: "الجميع", example: "أهلًا! هذه قائمة الأوامر المتاحة لك." },
  { key: "about", name: "/about", group: "أساسي", description: "عرض هوية البوت وإصداره", permission: "الجميع", example: "أنا مساعد مجتمعك. أستطيع الترحيب والمساعدة." },
  { key: "ping", name: "/ping", group: "أساسي", description: "فحص سرعة الاستجابة", permission: "الجميع", example: "Pong — الاستجابة مستقرة." },
  { key: "welcome", name: "/welcome", group: "الترحيب", description: "إرسال رسالة ترحيب أو معاينتها", permission: "المشرفون", example: "مرحبًا بك في مجتمعنا. ابدأ من قناة #start-here." },
  { key: "rules", name: "/rules", group: "الترحيب", description: "عرض قواعد المجتمع", permission: "الجميع", example: "القواعد: الاحترام، لا سبام، واحترام خصوصية الأعضاء." },
  { key: "roles", name: "/roles", group: "الترحيب", description: "اختيار الرتب الذاتية المسموحة", permission: "الجميع", example: "اختر اهتماماتك من القائمة التالية." },
  { key: "report", name: "/report", group: "الأمان", description: "فتح بلاغ خاص للمشرفين", permission: "الجميع", example: "تم فتح البلاغ بشكل خاص وسيراجعه الفريق." },
  { key: "warn", name: "/warn", group: "الأمان", description: "تسجيل تنبيه مع سبب ومراجعة", permission: "المشرفون", example: "تم تسجيل التنبيه في سجل المراجعة." },
  { key: "slowmode", name: "/slowmode", group: "الأمان", description: "اقتراح أو تعديل بطء القناة", permission: "المشرفون", example: "تم ضبط وضع التهدئة بعد موافقة المشرف." },
  { key: "modlog", name: "/modlog", group: "الأمان", description: "عرض سجل الإشراف المسموح", permission: "المشرفون", example: "آخر عمليات الإشراف: 3 عمليات قابلة للمراجعة." },
  { key: "event", name: "/event", group: "الفعاليات", description: "إنشاء مسودة فعالية", permission: "المشرفون", example: "جهزت مسودة فعالية. راجعها قبل النشر." },
  { key: "remind", name: "/remind", group: "الفعاليات", description: "إعداد تذكير في قناة محددة", permission: "المشرفون", example: "تم حفظ التذكير بانتظار المراجعة." },
  { key: "poll", name: "/poll", group: "الفعاليات", description: "إنشاء استطلاع بسيط", permission: "المشرفون", example: "تم إعداد استطلاع جديد للنشر." },
  { key: "schedule", name: "/schedule", group: "الأتمتة", description: "جدولة رسالة أو مهمة", permission: "المشرفون", example: "تم إنشاء الجدول مع خيار الإيقاف." },
  { key: "announce", name: "/announce", group: "الأتمتة", description: "صياغة إعلان ومراجعته", permission: "المشرفون", example: "هذه مسودة الإعلان. هل تريد اعتمادها؟" },
  { key: "digest", name: "/digest", group: "الأتمتة", description: "طلب ملخص نشاط المجتمع", permission: "المشرفون", example: "سأجهز ملخصًا يعتمد على البيانات المتاحة." },
  { key: "stats", name: "/stats", group: "التحليلات", description: "عرض مؤشرات المجتمع المسموحة", permission: "المشرفون", example: "الصحة جيدة. راجع لوحة التحليلات للتفاصيل." },
  { key: "channels", name: "/channels", group: "الإدارة", description: "عرض خريطة القنوات الحالية", permission: "المشرفون", example: "لديك 4 تصنيفات و18 قناة في آخر قراءة." },
  { key: "roles-admin", name: "/roles-admin", group: "الإدارة", description: "عرض خريطة الرتب والصلاحيات", permission: "المشرفون", example: "هذه الرتب مرتبة حسب مستوى الوصول." },
  { key: "backup", name: "/backup", group: "الإدارة", description: "إنشاء مسودة نسخة من تصميم المجتمع", permission: "المالك", example: "تم إعداد نسخة تصميم للمراجعة." }
];
const DEFAULT_BOT_SETTINGS = { enabled: true, command_keys: ["help", "ping", "about"], log_channel_id: null, locale: "ar", welcome_enabled: false };
app.get("/api/guilds/:guildId/bot-settings", requireUser, async (req, res, next) => { try { const guild = await authorizedGuild(req.user, req.params.guildId); if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" }); const row = (await pool.query("SELECT guild_id,enabled,command_keys,log_channel_id,locale,welcome_enabled,updated_at FROM bot_guild_settings WHERE guild_id=$1", [guild.id])).rows[0]; res.json({ settings: row || { guild_id: guild.id, ...DEFAULT_BOT_SETTINGS } }); } catch (e) { next(e); } });
app.put("/api/guilds/:guildId/bot-settings", requireUser, async (req, res, next) => { try { const guild = await authorizedGuild(req.user, req.params.guildId); if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" }); const commandKeys = Array.isArray(req.body.command_keys) ? [...new Set(req.body.command_keys.map((key) => String(key)).filter((key) => COMMAND_CATALOG.some((command) => command.key === key)))].slice(0, 50) : DEFAULT_BOT_SETTINGS.command_keys; const locale = ["ar", "en"].includes(req.body.locale) ? req.body.locale : "ar"; const enabled = req.body.enabled !== false; const welcomeEnabled = req.body.welcome_enabled === true; const logChannelId = req.body.log_channel_id ? String(req.body.log_channel_id).slice(0, 30) : null; const { rows } = await pool.query("INSERT INTO bot_guild_settings(guild_id,enabled,command_keys,log_channel_id,locale,welcome_enabled,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT(guild_id) DO UPDATE SET enabled=EXCLUDED.enabled,command_keys=EXCLUDED.command_keys,log_channel_id=EXCLUDED.log_channel_id,locale=EXCLUDED.locale,welcome_enabled=EXCLUDED.welcome_enabled,updated_at=NOW() RETURNING guild_id,enabled,command_keys,log_channel_id,locale,welcome_enabled,updated_at", [guild.id, enabled, JSON.stringify(commandKeys), logChannelId, locale, welcomeEnabled]); await audit(req.user.id, "bot.settings.update", "guild", guild.id, { command_keys: commandKeys, enabled, log_channel_id: logChannelId, locale, welcome_enabled: welcomeEnabled }); res.json({ settings: rows[0] }); } catch (e) { next(e); } });
app.get("/api/bots/catalog", requireUser, (_req, res) => res.json({ bots: BOT_CATALOG }));
app.get("/api/bots/commands", requireUser, (_req, res) => res.json({ commands: COMMAND_CATALOG, groups: [...new Set(COMMAND_CATALOG.map((command) => command.group))] }));
app.get("/api/custom-templates", requireUser, async (req, res, next) => { try { const { rows } = await pool.query("SELECT id,name,description,definition,status,version,created_at,updated_at FROM custom_templates WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]); res.json({ templates: rows }); } catch (e) { next(e); } });
app.post("/api/custom-templates", requireUser, async (req, res, next) => { try { const name = String(req.body.name || "قالب جديد").trim().slice(0, 80); const description = String(req.body.description || "").trim().slice(0, 300); const definition = req.body.definition && typeof req.body.definition === "object" ? req.body.definition : { categories: [], channels: [], roles: [] }; const { rows } = await pool.query("INSERT INTO custom_templates(user_id,name,description,definition) VALUES($1,$2,$3,$4) RETURNING *", [req.user.id, name, description, definition]); await pool.query("INSERT INTO template_versions(template_id,version,definition) VALUES($1,1,$2)", [rows[0].id, definition]); await audit(req.user.id, "custom_template.create", "custom_template", rows[0].id, { name }); res.status(201).json({ template: rows[0] }); } catch (e) { next(e); } });
app.put("/api/custom-templates/:id", requireUser, async (req, res, next) => { try { const current = (await pool.query("SELECT * FROM custom_templates WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0]; if (!current) return res.status(404).json({ error: "القالب غير موجود" }); const definition = req.body.definition && typeof req.body.definition === "object" ? req.body.definition : current.definition; const name = String(req.body.name || current.name).trim().slice(0, 80); const description = String(req.body.description ?? current.description).trim().slice(0, 300); const version = Number(current.version || 1) + 1; const { rows } = await pool.query("UPDATE custom_templates SET name=$1,description=$2,definition=$3,version=$4,updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING *", [name, description, definition, version, current.id, req.user.id]); await pool.query("INSERT INTO template_versions(template_id,version,definition) VALUES($1,$2,$3)", [current.id, version, definition]); await audit(req.user.id, "custom_template.update", "custom_template", current.id, { version }); res.json({ template: rows[0] }); } catch (e) { next(e); } });
app.delete("/api/custom-templates/:id", requireUser, async (req, res, next) => { try { const result = await pool.query("DELETE FROM custom_templates WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]); if (!result.rowCount) return res.status(404).json({ error: "القالب غير موجود" }); await audit(req.user.id, "custom_template.delete", "custom_template", req.params.id); res.json({ ok: true }); } catch (e) { next(e); } });
app.get("/api/custom-bots", requireUser, async (req, res, next) => { try { const { rows } = await pool.query("SELECT id,name,slug,description,definition,status,version,created_at,updated_at FROM custom_bots WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]); res.json({ bots: rows }); } catch (e) { next(e); } });
app.post("/api/custom-bots", requireUser, async (req, res, next) => { try { await requirePlanCapacity(req.user, "customBots"); const name = String(req.body.name || "Bot جديد").trim().slice(0, 80); const slug = String(req.body.slug || name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || `bot-${Date.now()}`; const description = String(req.body.description || "").trim().slice(0, 300); const definition = req.body.definition && typeof req.body.definition === "object" ? req.body.definition : { personality: "مساعد هادئ ومفيد", commands: [], capabilities: [], approval_required: true }; const { rows } = await pool.query("INSERT INTO custom_bots(user_id,name,slug,description,definition) VALUES($1,$2,$3,$4,$5) RETURNING *", [req.user.id, name, slug, description, definition]); await audit(req.user.id, "custom_bot.create", "custom_bot", rows[0].id, { name, slug }); res.status(201).json({ bot: rows[0] }); } catch (e) { if (e.code === "23505") return res.status(409).json({ error: "اسم الـBot مستخدم مسبقًا" }); next(e); } });
app.put("/api/custom-bots/:id", requireUser, async (req, res, next) => { try { const current = (await pool.query("SELECT * FROM custom_bots WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0]; if (!current) return res.status(404).json({ error: "البوت غير موجود" }); const definition = req.body.definition && typeof req.body.definition === "object" ? req.body.definition : current.definition; const name = String(req.body.name || current.name).trim().slice(0, 80); const description = String(req.body.description ?? current.description).trim().slice(0, 300); const version = Number(current.version || 1) + 1; const { rows } = await pool.query("UPDATE custom_bots SET name=$1,description=$2,definition=$3,version=$4,updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING *", [name, description, definition, version, current.id, req.user.id]); await audit(req.user.id, "custom_bot.update", "custom_bot", current.id, { version }); res.json({ bot: rows[0] }); } catch (e) { next(e); } });
app.patch("/api/guilds/:guildId/settings/name", requireUser, async (req, res, next) => { try { const guild = await authorizedGuild(req.user, req.params.guildId); if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" }); const name = String(req.body.name || "").trim().slice(0, 100); if (name.length < 2) return res.status(400).json({ error: "اكتب اسمًا من حرفين على الأقل" }); const result = await discordBotFetch(`/guilds/${guild.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); if (!result.ok) return res.status(result.status === 403 ? 403 : 502).json({ error: "لم يسمح Discord بتغيير الاسم. تحقق من صلاحية إدارة السيرفر." }); await pool.query("UPDATE guild_connections SET guild_name=$1,updated_at=NOW() WHERE user_id=$2 AND guild_id=$3", [name, req.user.id, guild.id]); await audit(req.user.id, "guild.rename", "guild", guild.id, { from: guild.name, to: name }); res.json({ ok: true, guild: { id: guild.id, name: result.data.name } }); } catch (e) { next(e); } });
function draftDesign(body) {
  const design = body?.design;
  if (!design || typeof design !== "object" || Array.isArray(design)) return null;
  if (JSON.stringify(design).length > 200_000) return null;
  return design;
}
app.get("/api/guilds/:guildId/draft", requireUser, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.params.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const { rows } = await pool.query("SELECT id,name,design,deployment_status,created_at,updated_at FROM projects WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 1", [req.user.id, guild.id]);
    res.json({ draft: rows[0] || null });
  } catch (e) { next(e); }
});
app.put("/api/guilds/:guildId/draft", requireUser, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.params.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const design = draftDesign(req.body);
    if (!design) return res.status(400).json({ error: "بيانات المسودة غير صالحة أو أكبر من الحد المسموح" });
    const name = String(req.body.name || design.name || guild.name || "مسودتي").trim().slice(0, 80) || "مسودتي";
    const current = (await pool.query("SELECT id FROM projects WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 1", [req.user.id, guild.id])).rows[0];
    const result = current
      ? await pool.query("UPDATE projects SET name=$1,design=$2,deployment_status='draft',updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING id,name,guild_id,design,deployment_status,created_at,updated_at", [name, design, current.id, req.user.id])
      : await pool.query("INSERT INTO projects(user_id,name,guild_id,design,deployment_status) VALUES($1,$2,$3,$4,'draft') RETURNING id,name,guild_id,design,deployment_status,created_at,updated_at", [req.user.id, name, guild.id, design]);
    await audit(req.user.id, "project.draft.save", "project", result.rows[0].id, { guild_id: guild.id });
    res.json({ draft: result.rows[0] });
  } catch (e) { next(e); }
});
app.get("/api/guilds/:guildId/summary", requireUser, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.params.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const [connection, channels, roles, changes, events, draft] = await Promise.all([
      pool.query("SELECT guild_id,guild_name,install_status,last_error,last_verified_at FROM guild_connections WHERE user_id=$1 AND guild_id=$2", [req.user.id, guild.id]),
      discordBotFetch(`/guilds/${guild.id}/channels`),
      discordBotFetch(`/guilds/${guild.id}/roles`),
      pool.query("SELECT id,template_key,status,updated_at FROM change_sets WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 8", [req.user.id, guild.id]),
      pool.query("SELECT event_type,quantity,metadata,created_at FROM usage_events WHERE user_id=$1 AND guild_id=$2 ORDER BY created_at DESC LIMIT 20", [req.user.id, guild.id]),
      pool.query("SELECT id,name,design,deployment_status,created_at,updated_at FROM projects WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 1", [req.user.id, guild.id]),
    ]);
    const channelRows = channels.ok && Array.isArray(channels.data) ? channels.data : [];
    const roleRows = roles.ok && Array.isArray(roles.data) ? roles.data : [];
    res.json({ guild: { id: guild.id, name: guild.name, icon: guild.icon, owner: guild.owner, permissions: guild.permissions, approximate_member_count: guild.approximate_member_count || null }, connection: connection.rows[0] || { install_status: "discovered" }, bot: { online: Boolean(process.env.DISCORD_BOT_TOKEN), installed: channels.ok, permissions: REQUIRED_BOT_PERMISSIONS }, counts: { channels: channelRows.filter((item) => item.type !== 4).length, categories: channelRows.filter((item) => item.type === 4).length, roles: roleRows.length, members: guild.approximate_member_count || null }, draft: draft.rows[0] || null, changeSets: changes.rows, activity: events.rows });
  } catch (e) { next(e); }
});
app.get("/api/guilds/:guildId/change-sets", requireUser, async (req, res, next) => { try { const guild = await authorizedGuild(req.user, req.params.guildId); if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" }); const rows = await pool.query("SELECT id,template_key,status,plan,created_at,updated_at FROM change_sets WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 30", [req.user.id, guild.id]); res.json({ changeSets: rows.rows }); } catch (e) { next(e); } });
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
    await requirePlanCapacity(req.user, "changeSetsPerMonth");
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
app.get("/api/projects/:id/export", requireUser, async (req, res, next) => { try { const project = (await pool.query("SELECT id,name,guild_id,design,deployment_status,created_at,updated_at FROM projects WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0]; if (!project) return res.status(404).json({ error: "المشروع غير موجود" }); await audit(req.user.id, "project.export", "project", project.id); res.set("Content-Disposition", `attachment; filename=\"diskoko-project-${project.id}.json\"`); res.json({ exported_at: new Date().toISOString(), project }); } catch (e) { next(e); } });
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

app.use((req, res, next) => {
  if (/^\/(?:server\.js|discord-bot\.js|package(?:-lock)?\.json|\.env(?:\..*)?|node_modules(?:\/|$)|docs(?:\/|$))/.test(req.path)) return res.status(404).end();
  next();
});
app.use(express.static(__dirname, { extensions: ["html"], maxAge: IS_PRODUCTION ? "1h" : 0, dotfiles: "deny" }));
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "account.html")));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(__dirname, "account.html")));
app.get("/studio", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.use((error, _req, res, _next) => { console.error(error); const status = Number(error.status) >= 400 && Number(error.status) < 500 ? Number(error.status) : 500; res.status(status).json({ error: status === 500 ? "حدث خطأ غير متوقع" : error.message, ...(error.code ? { code: error.code } : {}), ...(error.capacity ? { capacity: error.capacity } : {}) }); });

migrate().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`diskoko running on ${PORT}`));
  void startDiscordBot({ pool });
}).catch((error) => { console.error("Database migration failed", error); process.exit(1); });
