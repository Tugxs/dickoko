import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import nodemailer from "nodemailer";
import { getDiscordBotStatus, startDiscordBot } from "./discord-bot.js";
import { mountWorkspace, migrateWorkspace, startScheduleRunner } from "./lib/workspace-api.js";
import { manageable, problem, supportedCommands, connectionState } from "./lib/workspace-domain.js";
import { BILLING_PLANS, BILLING_STATUSES, canonicalPlan, entitlementsFor, publicPlanCatalog, subscriptionAccess, usageAlert } from "./lib/billing.js";

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
    UPDATE users SET plan = CASE plan WHEN 'trial' THEN 'free' WHEN 'complete' THEN 'business' WHEN 'pro' THEN 'growth' WHEN 'studio' THEN 'business' ELSE plan END;
    ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'free';
    ALTER TABLE users ADD CONSTRAINT users_plan_check CHECK (plan IN ('free','starter','growth','business'));
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly';
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ;
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS amount_sar INTEGER;
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SAR';
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
    UPDATE subscriptions SET plan = CASE plan WHEN 'trial' THEN 'free' WHEN 'complete' THEN 'business' WHEN 'pro' THEN 'growth' WHEN 'studio' THEN 'business' ELSE plan END;
    CREATE TABLE IF NOT EXISTS billing_invoices (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, provider_ref TEXT NOT NULL, status TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'SAR', invoice_url TEXT,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), paid_at TIMESTAMPTZ,
      UNIQUE(provider,provider_ref)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_invoices_user ON billing_invoices(user_id,issued_at DESC);
    CREATE TABLE IF NOT EXISTS billing_upgrade_requests (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL, billing_interval TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_upgrade_pending ON billing_upgrade_requests(user_id) WHERE status='pending';
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
  if (req.path === "/webhooks/billing") return next();
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
const tokenRefreshes = new Map();
async function discordUserToken(user) {
  const key = String(user.id);
  if (tokenRefreshes.has(key)) return tokenRefreshes.get(key);
  const task = refreshDiscordUserToken(user);
  tokenRefreshes.set(key, task);
  try { return await task; } finally { tokenRefreshes.delete(key); }
}
async function refreshDiscordUserToken(user) {
  let accessToken = decrypt(user?.access_token);
  const expiresAt = user?.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
  if (accessToken && expiresAt > Date.now() + 60_000) return accessToken;
  const refreshToken = decrypt(user?.refresh_token);
  if (!refreshToken || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return accessToken;
  const response = await fetch(`${DISCORD_API}/oauth2/token`, { signal: AbortSignal.timeout(15000), method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: refreshToken }) });
  if (!response.ok) return null;
  const tokens = await response.json();
  const expires = new Date(Date.now() + Number(tokens.expires_in || 604800) * 1000);
  await pool.query("UPDATE users SET access_token=$1,refresh_token=$2,token_expires_at=$3,updated_at=NOW() WHERE id=$4", [encrypt(tokens.access_token), encrypt(tokens.refresh_token || refreshToken), expires, user.id]);
  return tokens.access_token;
}
async function discordBotFetch(pathname, options = {}) {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, status: 503, data: { message: "Discord bot غير مهيأ" } };
  const response = await fetch(`${DISCORD_API}${pathname}`, { signal: AbortSignal.timeout(20000), ...options, headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  let data = null; try { data = await response.json(); } catch { data = {}; }
  return { ok: response.ok, status: response.status, data, headers: response.headers };
}
async function manageableGuilds(user) {
  const token = await discordUserToken(user);
  if (!token) throw problem('انتهى ربط حساب Discord. أعد ربط الحساب للمتابعة.', 401);
  const response = await fetch(`${DISCORD_API}/users/@me/guilds`, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw problem(response.status === 401 ? 'انتهى ربط حساب Discord. أعد ربط الحساب للمتابعة.' : 'تعذر تحميل السيرفرات من Discord. أعد المحاولة بعد قليل.', response.status === 401 ? 401 : 502);
  return (await response.json()).filter(manageable);
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
    category.channels.forEach((name, channelIndex) => operations.push({ operation_key: `${categoryKey}:channel:${channelIndex}`, resource_type: "channel", name, type: category.name === 'VOICE LOUNGE' ? 2 : 0, parent_key: categoryKey }));
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
async function planCapacity(user, kind, db = pool) {
  const limits = entitlementsFor(user);
  if (kind === "servers") {
    const { rows } = await db.query("SELECT COUNT(DISTINCT guild_id)::int AS count FROM guild_connections WHERE user_id=$1 AND install_status='installed'", [user.id]);
    return { used: rows[0].count, limit: limits.servers };
  }
  if (kind === "customBots") {
    const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM custom_bots WHERE user_id=$1 AND status <> 'deleted'", [user.id]);
    return { used: rows[0].count, limit: limits.customBots };
  }
  if (kind === "customTemplates") {
    const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM custom_templates WHERE user_id=$1", [user.id]);
    return { used: rows[0].count, limit: limits.customTemplates };
  }
  if (kind === "scheduledMessages") {
    const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM scheduled_messages WHERE user_id=$1 AND status IN ('scheduled','sending')", [user.id]);
    return { used: rows[0].count, limit: limits.scheduledMessages };
  }
  if (kind === "changeSetsPerMonth") {
    const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM change_sets WHERE user_id=$1 AND created_at >= date_trunc('month', NOW())", [user.id]);
    return { used: rows[0].count, limit: limits.changeSetsPerMonth };
  }
  return { used: 0, limit: 0 };
}
async function requirePlanCapacity(user, kind, db = pool) {
  const subscription = (await db.query("SELECT status,grace_until FROM subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1", [user.id])).rows[0];
  const access = subscriptionAccess(subscription || { status: canonicalPlan(user.plan) === 'free' ? 'trial' : 'active' });
  if (access.mode !== 'full') {
    const error = new Error('اشتراكك في وضع القراءة فقط. حدّث وسيلة الدفع لاستئناف التغييرات، وبياناتك محفوظة.');
    error.status = 402; error.code = 'SUBSCRIPTION_READ_ONLY'; error.access = access; throw error;
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`diskoko:quota:${user.id}:${kind}`]);
  const capacity = await planCapacity(user, kind, db);
  if (capacity.used >= capacity.limit) {
    const error = new Error(`وصلت إلى حد باقة ${user.plan} لهذه الميزة`);
    error.status = 402;
    error.code = "PLAN_LIMIT_REACHED";
    error.capacity = capacity;
    throw error;
  }
  return capacity;
}
function verifyBillingSignature(req) {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  const signature = String(req.get("x-diskoko-signature") || "");
  if (!secret || !signature || !req.rawBody) return false;
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
function billingPayload(body) {
  const suppliedPlan = String(body?.plan || "");
  const plan = canonicalPlan(suppliedPlan);
  const status = String(body?.status || "");
  const userId = Number(body?.user_id);
  if (!Number.isSafeInteger(userId) || userId < 1 || !BILLING_PLANS.has(suppliedPlan) || !BILLING_STATUSES.has(status)) return null;
  const periodEnd = body.current_period_end ? new Date(body.current_period_end) : null;
  const periodStart = body.current_period_start ? new Date(body.current_period_start) : null;
  const graceUntil = body.grace_until ? new Date(body.grace_until) : (status === 'past_due' ? new Date(Date.now() + 7 * 86400000) : null);
  if (periodEnd && Number.isNaN(periodEnd.getTime())) return null;
  if (periodStart && Number.isNaN(periodStart.getTime())) return null;
  if (graceUntil && Number.isNaN(graceUntil.getTime())) return null;
  const interval = body.billing_interval === 'annual' ? 'annual' : 'monthly';
  return { userId, plan, status, provider: String(body.provider || "external").slice(0, 40), providerRef: String(body.provider_ref || "").slice(0, 200) || null, periodStart, periodEnd, graceUntil, interval, cancelAtPeriodEnd: body.cancel_at_period_end === true, amountSar: Number.isInteger(Number(body.amount_sar)) ? Math.max(0, Number(body.amount_sar)) : null };
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
async function requireWriteAccess(req, res, next) {
  try {
    const subscription = (await pool.query("SELECT status,grace_until FROM subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1", [req.user.id])).rows[0];
    const access = subscriptionAccess(subscription || { status: canonicalPlan(req.user.plan) === 'free' ? 'trial' : 'active' });
    if (access.mode !== 'full') return res.status(402).json({ error: 'اشتراكك في وضع القراءة فقط. حدّث وسيلة الدفع لاستئناف التغييرات، وبياناتك محفوظة.', code: 'SUBSCRIPTION_READ_ONLY', access });
    next();
  } catch (error) { next(error); }
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
    if (existing.rows[0]) await client.query("UPDATE subscriptions SET plan=$1,status=$2,current_period_start=$3,current_period_end=$4,grace_until=$5,billing_interval=$6,cancel_at_period_end=$7,amount_sar=$8,updated_at=NOW() WHERE id=$9", [payload.plan, payload.status, payload.periodStart, payload.periodEnd, payload.graceUntil, payload.interval, payload.cancelAtPeriodEnd, payload.amountSar, existing.rows[0].id]);
    else await client.query("INSERT INTO subscriptions(user_id,provider,provider_ref,plan,status,current_period_start,current_period_end,grace_until,billing_interval,cancel_at_period_end,amount_sar) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [payload.userId, payload.provider, payload.providerRef, payload.plan, payload.status, payload.periodStart, payload.periodEnd, payload.graceUntil, payload.interval, payload.cancelAtPeriodEnd, payload.amountSar]);
    // Account access and billing access are separate: expired billing must never delete or lock the account.
    await client.query("UPDATE users SET plan=$1,updated_at=NOW() WHERE id=$2", [["cancelled", "expired"].includes(payload.status) ? "free" : payload.plan, payload.userId]);
    await client.query("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES(NULL,$1,'user',$2,$3)", ["billing.subscription.updated", payload.userId, { event_id: eventId, provider: payload.provider, plan: payload.plan, status: payload.status }]);
    await client.query("COMMIT");
    res.json({ ok: true, eventId, plan: payload.plan, status: payload.status });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); next(error); } finally { client.release(); }
});
app.get("/api/billing/plans", (_req, res) => res.json({ currency: 'SAR', annualMonthsFree: 2, plans: publicPlanCatalog() }));
app.post("/api/billing/upgrade-requests", requireUser, async (req, res, next) => { try {
  const plan = canonicalPlan(req.body.plan); const interval = req.body.billing_interval === 'annual' ? 'annual' : 'monthly';
  if (!['starter','growth','business'].includes(plan)) return res.status(400).json({ error: 'اختر باقة مدفوعة صالحة.' });
  const { rows } = await pool.query("INSERT INTO billing_upgrade_requests(user_id,plan,billing_interval) VALUES($1,$2,$3) ON CONFLICT(user_id) WHERE status='pending' DO UPDATE SET plan=EXCLUDED.plan,billing_interval=EXCLUDED.billing_interval,updated_at=NOW() RETURNING id,plan,billing_interval,status,created_at,updated_at", [req.user.id, plan, interval]);
  await audit(req.user.id, 'billing.upgrade.requested', 'user', req.user.id, { plan, billing_interval: interval });
  res.status(201).json({ request: rows[0], message: 'استلمنا طلب الترقية. سنفتح الدفع فور ربط بوابة الدفع.' });
} catch (e) { next(e); } });
app.get("/api/account/overview", requireUser, async (req, res, next) => { try {
  const [subscriptionResult, guilds, connections, activity, customBots, customTemplates, scheduledMessages, changeSets, invoices, upgradeRequest, projects] = await Promise.all([
    pool.query("SELECT plan,status,billing_interval,current_period_start,current_period_end,grace_until,cancel_at_period_end,amount_sar,currency,provider,created_at,updated_at FROM subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1", [req.user.id]),
    manageableGuilds(req.user),
    pool.query("SELECT guild_id,guild_name,install_status,last_error,last_verified_at,updated_at FROM guild_connections WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]),
    pool.query("SELECT event_type,created_at,metadata FROM usage_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8", [req.user.id]),
    planCapacity(req.user, "customBots"), planCapacity(req.user, "customTemplates"), planCapacity(req.user, "scheduledMessages"), planCapacity(req.user, "changeSetsPerMonth"),
    pool.query("SELECT provider_ref,status,amount,currency,invoice_url,issued_at,paid_at FROM billing_invoices WHERE user_id=$1 ORDER BY issued_at DESC LIMIT 12", [req.user.id]),
    pool.query("SELECT id,plan,billing_interval,status,created_at,updated_at FROM billing_upgrade_requests WHERE user_id=$1 AND status='pending' ORDER BY updated_at DESC LIMIT 1", [req.user.id]),
    pool.query("SELECT id,name,guild_id,deployment_status,archived_at,created_at,updated_at FROM projects WHERE user_id=$1 ORDER BY archived_at NULLS FIRST,updated_at DESC", [req.user.id]),
  ]);
  const subscription = subscriptionResult.rows[0] || { plan: canonicalPlan(req.user.plan), status: canonicalPlan(req.user.plan) === 'free' ? 'trial' : 'active', current_period_end: null, billing_interval: null };
  const access = subscriptionAccess(subscription);
  const byGuild = new Map(connections.rows.map((row) => [String(row.guild_id), row]));
  const usage = { servers: await planCapacity(req.user, 'servers'), customBots, customTemplates, scheduledMessages, changeSetsPerMonth: changeSets };
  const alerts = Object.entries(usage).flatMap(([key, capacity]) => { const alert = usageAlert(capacity); return alert ? [{ key, ...alert }] : []; });
  res.json({ user: publicUser(req.user), plan: subscription, access, limits: entitlementsFor(req.user), usage, alerts, invoices: invoices.rows, upgradeRequest: upgradeRequest.rows[0] || null, plans: publicPlanCatalog(), projects: projects.rows, servers: guilds.map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon, owner: guild.owner, permissions: guild.permissions, connection: byGuild.get(String(guild.id)) || { guild_id: guild.id, guild_name: guild.name, install_status: "not_connected" } })), activity: activity.rows });
} catch (e) { next(e); } });
app.get("/api/account/subscription-events", requireUser, async (req, res, next) => { try { const { rows } = await pool.query("SELECT provider,event_id,event_type,provider_ref,payload,processed_at FROM subscription_events WHERE user_id=$1 ORDER BY processed_at DESC LIMIT 50", [req.user.id]); res.json({ events: rows }); } catch (e) { next(e); } });
app.get("/api/account/entitlements", requireUser, async (req, res, next) => { try { const [servers, customBots, customTemplates, scheduledMessages, changeSetsPerMonth] = await Promise.all([planCapacity(req.user, "servers"), planCapacity(req.user, "customBots"), planCapacity(req.user, "customTemplates"), planCapacity(req.user, "scheduledMessages"), planCapacity(req.user, "changeSetsPerMonth")]); res.json({ plan: canonicalPlan(req.user.plan), limits: entitlementsFor(req.user), usage: { servers, customBots, customTemplates, scheduledMessages, changeSetsPerMonth } }); } catch (e) { next(e); } });
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
    const connection = { ...(row || {}), guild_id: guild.id, guild_name: guild.name, bot_installed: botInstalled, install_status: connectionState(bot), required_permissions: REQUIRED_BOT_PERMISSIONS };
    await pool.query("INSERT INTO guild_connections(user_id,guild_id,guild_name,install_status,last_verified_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT(user_id,guild_id) DO UPDATE SET guild_name=EXCLUDED.guild_name,install_status=EXCLUDED.install_status,last_verified_at=NOW(),updated_at=NOW()", [req.user.id, guild.id, guild.name, connection.install_status]);
    res.json({ connection });
  } catch (e) { next(e); }
});
app.get("/api/guilds/:guildId/install-url", requireUser, requireWriteAccess, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.params.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    if (!process.env.DISCORD_CLIENT_ID) return res.status(503).json({ error: "لم يتم إعداد معرف تطبيق Discord على الخادم" });
    const existing = (await pool.query("SELECT install_status FROM guild_connections WHERE user_id=$1 AND guild_id=$2", [req.user.id, guild.id])).rows[0];
    if (existing?.install_status !== 'installed') await requirePlanCapacity(req.user, 'servers');
    const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID || "", scope: "bot applications.commands", permissions: REQUIRED_BOT_PERMISSIONS, guild_id: String(guild.id), disable_guild_select: "true" });
    res.json({ url: `https://discord.com/oauth2/authorize?${params.toString()}`, guild: { id: guild.id, name: guild.name }, permissions: REQUIRED_BOT_PERMISSIONS });
  } catch (e) { next(e); }
});
app.post("/api/guilds/:guildId/connection/verify", requireUser, async (req, res, next) => {
  try {
    const guild = await authorizedGuild(req.user, req.params.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const bot = await discordBotFetch(`/guilds/${encodeURIComponent(req.params.guildId)}`);
    const status = connectionState(bot); if (status === "unavailable") return res.status(502).json({ error: "تعذر التحقق من Discord الآن. أعد المحاولة دون إعادة تثبيت البوت." });
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
app.put("/api/guilds/:guildId/bot-settings", requireUser, requireWriteAccess, async (req, res, next) => { try { const guild = await authorizedGuild(req.user, req.params.guildId); if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" }); const commandKeys = Array.isArray(req.body.command_keys) ? [...new Set(req.body.command_keys.map((key) => String(key)).filter((key) => supportedCommands.includes(key)))].slice(0, 50) : DEFAULT_BOT_SETTINGS.command_keys; const locale = ["ar", "en"].includes(req.body.locale) ? req.body.locale : "ar"; const enabled = req.body.enabled !== false; const welcomeEnabled = req.body.welcome_enabled === true; const logChannelId = req.body.log_channel_id ? String(req.body.log_channel_id).slice(0, 30) : null; if (logChannelId) { const channel = await discordBotFetch(`/channels/${encodeURIComponent(logChannelId)}`); if (!channel.ok || channel.data.guild_id !== guild.id || ![0,5].includes(channel.data.type)) return res.status(400).json({ error: "اختر قناة نصية من هذا السيرفر لسجل البوت" }); } const { rows } = await pool.query("INSERT INTO bot_guild_settings(guild_id,enabled,command_keys,log_channel_id,locale,welcome_enabled,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT(guild_id) DO UPDATE SET enabled=EXCLUDED.enabled,command_keys=EXCLUDED.command_keys,log_channel_id=EXCLUDED.log_channel_id,locale=EXCLUDED.locale,welcome_enabled=EXCLUDED.welcome_enabled,updated_at=NOW() RETURNING guild_id,enabled,command_keys,log_channel_id,locale,welcome_enabled,updated_at", [guild.id, enabled, JSON.stringify(commandKeys), logChannelId, locale, welcomeEnabled]); await audit(req.user.id, "bot.settings.update", "guild", guild.id, { command_keys: commandKeys, enabled, log_channel_id: logChannelId, locale, welcome_enabled: welcomeEnabled }); res.json({ settings: rows[0] }); } catch (e) { next(e); } });
app.get("/api/bots/catalog", requireUser, (_req, res) => res.json({ bots: BOT_CATALOG }));
app.get("/api/bots/commands", requireUser, (_req, res) => res.json({ commands: COMMAND_CATALOG, groups: [...new Set(COMMAND_CATALOG.map((command) => command.group))] }));
app.get("/api/custom-templates", requireUser, async (req, res, next) => { try { const { rows } = await pool.query("SELECT id,name,description,definition,status,version,created_at,updated_at FROM custom_templates WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]); res.json({ templates: rows }); } catch (e) { next(e); } });
app.post("/api/custom-templates", requireUser, requireWriteAccess, async (req, res, next) => { try { await requirePlanCapacity(req.user, "customTemplates"); const name = String(req.body.name || "قالب جديد").trim().slice(0, 80); const description = String(req.body.description || "").trim().slice(0, 300); const definition = req.body.definition && typeof req.body.definition === "object" ? req.body.definition : { categories: [], channels: [], roles: [] }; const { rows } = await pool.query("INSERT INTO custom_templates(user_id,name,description,definition) VALUES($1,$2,$3,$4) RETURNING *", [req.user.id, name, description, definition]); await pool.query("INSERT INTO template_versions(template_id,version,definition) VALUES($1,1,$2)", [rows[0].id, definition]); await audit(req.user.id, "custom_template.create", "custom_template", rows[0].id, { name }); res.status(201).json({ template: rows[0] }); } catch (e) { next(e); } });
app.put("/api/custom-templates/:id", requireUser, requireWriteAccess, async (req, res, next) => { try { const current = (await pool.query("SELECT * FROM custom_templates WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0]; if (!current) return res.status(404).json({ error: "القالب غير موجود" }); const definition = req.body.definition && typeof req.body.definition === "object" ? req.body.definition : current.definition; const name = String(req.body.name || current.name).trim().slice(0, 80); const description = String(req.body.description ?? current.description).trim().slice(0, 300); const version = Number(current.version || 1) + 1; const { rows } = await pool.query("UPDATE custom_templates SET name=$1,description=$2,definition=$3,version=$4,updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING *", [name, description, definition, version, current.id, req.user.id]); await pool.query("INSERT INTO template_versions(template_id,version,definition) VALUES($1,$2,$3)", [current.id, version, definition]); await audit(req.user.id, "custom_template.update", "custom_template", current.id, { version }); res.json({ template: rows[0] }); } catch (e) { next(e); } });
app.delete("/api/custom-templates/:id", requireUser, requireWriteAccess, async (req, res, next) => { try { const result = await pool.query("DELETE FROM custom_templates WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]); if (!result.rowCount) return res.status(404).json({ error: "القالب غير موجود" }); await audit(req.user.id, "custom_template.delete", "custom_template", req.params.id); res.json({ ok: true }); } catch (e) { next(e); } });
app.get("/api/custom-bots", requireUser, async (req, res, next) => { try { const { rows } = await pool.query("SELECT id,name,slug,description,definition,status,version,created_at,updated_at FROM custom_bots WHERE user_id=$1 ORDER BY updated_at DESC", [req.user.id]); res.json({ bots: rows }); } catch (e) { next(e); } });
app.post("/api/custom-bots", requireUser, requireWriteAccess, async (req, res, next) => { try { await requirePlanCapacity(req.user, "customBots"); const name = String(req.body.name || "Bot جديد").trim().slice(0, 80); const slug = String(req.body.slug || name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || `bot-${Date.now()}`; const description = String(req.body.description || "").trim().slice(0, 300); const definition = req.body.definition && typeof req.body.definition === "object" ? req.body.definition : { personality: "مساعد هادئ ومفيد", commands: [], capabilities: [], approval_required: true }; const { rows } = await pool.query("INSERT INTO custom_bots(user_id,name,slug,description,definition) VALUES($1,$2,$3,$4,$5) RETURNING *", [req.user.id, name, slug, description, definition]); await audit(req.user.id, "custom_bot.create", "custom_bot", rows[0].id, { name, slug }); res.status(201).json({ bot: rows[0] }); } catch (e) { if (e.code === "23505") return res.status(409).json({ error: "اسم الـBot مستخدم مسبقًا" }); next(e); } });
app.put("/api/custom-bots/:id", requireUser, requireWriteAccess, async (req, res, next) => { try { const current = (await pool.query("SELECT * FROM custom_bots WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0]; if (!current) return res.status(404).json({ error: "البوت غير موجود" }); const definition = req.body.definition && typeof req.body.definition === "object" ? req.body.definition : current.definition; const name = String(req.body.name || current.name).trim().slice(0, 80); const description = String(req.body.description ?? current.description).trim().slice(0, 300); const version = Number(current.version || 1) + 1; const { rows } = await pool.query("UPDATE custom_bots SET name=$1,description=$2,definition=$3,version=$4,updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING *", [name, description, definition, version, current.id, req.user.id]); await audit(req.user.id, "custom_bot.update", "custom_bot", current.id, { version }); res.json({ bot: rows[0] }); } catch (e) { next(e); } });
app.patch("/api/guilds/:guildId/settings/name", requireUser, requireWriteAccess, async (req, res, next) => { try { const guild = await authorizedGuild(req.user, req.params.guildId); if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" }); const name = String(req.body.name || "").trim().slice(0, 100); if (name.length < 2) return res.status(400).json({ error: "اكتب اسمًا من حرفين على الأقل" }); const result = await discordBotFetch(`/guilds/${guild.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); if (!result.ok) return res.status(result.status === 403 ? 403 : 502).json({ error: "لم يسمح Discord بتغيير الاسم. تحقق من صلاحية إدارة السيرفر." }); await pool.query("UPDATE guild_connections SET guild_name=$1,updated_at=NOW() WHERE user_id=$2 AND guild_id=$3", [name, req.user.id, guild.id]); await audit(req.user.id, "guild.rename", "guild", guild.id, { from: guild.name, to: name }); res.json({ ok: true, guild: { id: guild.id, name: result.data.name } }); } catch (e) { next(e); } });
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
app.put("/api/guilds/:guildId/draft", requireUser, requireWriteAccess, async (req, res, next) => {
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
    const [connection, channels, roles, changes, events, draft, monthUsage] = await Promise.all([
      pool.query("SELECT guild_id,guild_name,install_status,last_error,last_verified_at FROM guild_connections WHERE user_id=$1 AND guild_id=$2", [req.user.id, guild.id]),
      discordBotFetch(`/guilds/${guild.id}/channels`),
      discordBotFetch(`/guilds/${guild.id}/roles`),
      pool.query("SELECT id,template_key,status,updated_at FROM change_sets WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 8", [req.user.id, guild.id]),
      pool.query("SELECT event_type,quantity,metadata,created_at FROM usage_events WHERE user_id=$1 AND guild_id=$2 ORDER BY created_at DESC LIMIT 20", [req.user.id, guild.id]),
      pool.query("SELECT id,name,design,deployment_status,created_at,updated_at FROM projects WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 1", [req.user.id, guild.id]),
      pool.query("SELECT COUNT(*)::int AS commands, COUNT(*) FILTER (WHERE event_type LIKE '%succeeded%')::int AS succeeded, COUNT(*) FILTER (WHERE event_type LIKE '%failed%')::int AS failed FROM usage_events WHERE user_id=$1 AND guild_id=$2 AND created_at >= date_trunc('month', NOW())", [req.user.id, guild.id]),
    ]);
    const channelRows = channels.ok && Array.isArray(channels.data) ? channels.data : [];
    const roleRows = roles.ok && Array.isArray(roles.data) ? roles.data : [];
    res.json({ guild: { id: guild.id, name: guild.name, icon: guild.icon, owner: guild.owner, permissions: guild.permissions, approximate_member_count: guild.approximate_member_count || null }, connection: connection.rows[0] || { install_status: "discovered" }, bot: { online: getDiscordBotStatus().online, installed: channels.ok, permissions: REQUIRED_BOT_PERMISSIONS }, counts: { channels: channelRows.filter((item) => item.type !== 4).length, categories: channelRows.filter((item) => item.type === 4).length, roles: roleRows.length, members: guild.approximate_member_count || null }, usage: monthUsage.rows[0] || { commands: 0, succeeded: 0, failed: 0 }, draft: draft.rows[0] || null, changeSets: changes.rows, activity: events.rows });
  } catch (e) { next(e); }
});
app.get("/api/guilds/:guildId/change-sets", requireUser, async (req, res, next) => { try { const guild = await authorizedGuild(req.user, req.params.guildId); if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" }); const rows = await pool.query("SELECT id,template_key,status,plan,created_at,updated_at FROM change_sets WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 30", [req.user.id, guild.id]); res.json({ changeSets: rows.rows }); } catch (e) { next(e); } });
app.get("/api/templates", requireUser, (_req, res) => res.json({ templates: Object.entries(TEMPLATES).map(([key, value]) => ({ key, name: value.name, categories: value.categories.length, roles: value.roles.length })) }));
app.post("/api/projects/:id/bind-guild", requireUser, requireWriteAccess, async (req, res, next) => {
  try {
    if (!req.body.guildId) {
      const current = (await pool.query("SELECT id,guild_id FROM projects WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0];
      if (!current) return res.status(404).json({ error: "المشروع غير موجود" });
      if (current.guild_id) await pool.query("UPDATE guild_connections SET project_id=NULL,updated_at=NOW() WHERE user_id=$1 AND guild_id=$2 AND project_id=$3", [req.user.id, current.guild_id, current.id]);
      const project = (await pool.query("UPDATE projects SET guild_id=NULL,updated_at=NOW() WHERE id=$1 RETURNING *", [current.id])).rows[0];
      await audit(req.user.id, "project.unbind_guild", "project", project.id, { guild_id: current.guild_id });
      return res.json({ project });
    }
    const guild = await authorizedGuild(req.user, req.body.guildId);
    if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
    const { rows } = await pool.query("UPDATE projects SET guild_id=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *", [guild.id, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "المشروع غير موجود" });
    await pool.query("UPDATE guild_connections SET project_id=$1,updated_at=NOW() WHERE user_id=$2 AND guild_id=$3", [rows[0].id, req.user.id, guild.id]);
    await audit(req.user.id, "project.bind_guild", "project", rows[0].id, { guild_id: guild.id });
    res.json({ project: rows[0] });
  } catch (e) { next(e); }
});
mountWorkspace(app, { pool, requireUser, requireWriteAccess, authorizedGuild, discordBotFetch, audit, requirePlanCapacity, entitlementsFor, templates: TEMPLATES, makeTemplatePlan, botStatus: getDiscordBotStatus });
app.get("/api/change-sets/:id", requireUser, async (req, res, next) => { try { const changeSet = (await pool.query("SELECT * FROM change_sets WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0]; if (!changeSet) return res.status(404).json({ error: "خطة التغيير غير موجودة" }); const operations = (await pool.query("SELECT * FROM change_operations WHERE change_set_id=$1 ORDER BY id", [changeSet.id])).rows; res.json({ changeSet, operations }); } catch (e) { next(e); } });
app.get("/api/projects", requireUser, async (req, res, next) => { try { const { rows } = await pool.query("SELECT id,name,guild_id,design,deployment_status,archived_at,created_at,updated_at FROM projects WHERE user_id=$1 ORDER BY archived_at NULLS FIRST,updated_at DESC", [req.user.id]); res.json({ projects: rows }); } catch (e) { next(e); } });
app.patch("/api/projects/:id", requireUser, requireWriteAccess, async (req, res, next) => { try { const name = String(req.body.name || '').trim().slice(0, 80); if (name.length < 2) return res.status(400).json({ error: 'اكتب اسمًا من حرفين على الأقل.' }); const { rows } = await pool.query("UPDATE projects SET name=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING id,name,guild_id,deployment_status,archived_at,created_at,updated_at", [name, req.params.id, req.user.id]); if (!rows[0]) return res.status(404).json({ error: 'المشروع غير موجود.' }); await audit(req.user.id, 'project.rename', 'project', rows[0].id, { name }); res.json({ project: rows[0] }); } catch (e) { next(e); } });
app.post("/api/projects/:id/duplicate", requireUser, requireWriteAccess, async (req, res, next) => { try { const source = (await pool.query("SELECT * FROM projects WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0]; if (!source) return res.status(404).json({ error: 'المشروع غير موجود.' }); const name = String(req.body.name || `نسخة من ${source.name}`).trim().slice(0, 80); const { rows } = await pool.query("INSERT INTO projects(user_id,name,design,deployment_status) VALUES($1,$2,$3,'draft') RETURNING id,name,guild_id,deployment_status,archived_at,created_at,updated_at", [req.user.id, name, source.design]); await audit(req.user.id, 'project.duplicate', 'project', rows[0].id, { source_project_id: source.id }); res.status(201).json({ project: rows[0] }); } catch (e) { next(e); } });
app.post("/api/projects/:id/archive", requireUser, requireWriteAccess, async (req, res, next) => { try { const archived = req.body.archived !== false; const { rows } = await pool.query("UPDATE projects SET archived_at=CASE WHEN $1 THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING id,name,guild_id,deployment_status,archived_at,created_at,updated_at", [archived, req.params.id, req.user.id]); if (!rows[0]) return res.status(404).json({ error: 'المشروع غير موجود.' }); await audit(req.user.id, archived ? 'project.archive' : 'project.restore', 'project', rows[0].id); res.json({ project: rows[0] }); } catch (e) { next(e); } });
app.get("/api/projects/:id/export", requireUser, async (req, res, next) => { try { const project = (await pool.query("SELECT id,name,guild_id,design,deployment_status,created_at,updated_at FROM projects WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id])).rows[0]; if (!project) return res.status(404).json({ error: "المشروع غير موجود" }); await audit(req.user.id, "project.export", "project", project.id); res.set("Content-Disposition", `attachment; filename=\"diskoko-project-${project.id}.json\"`); res.json({ exported_at: new Date().toISOString(), project }); } catch (e) { next(e); } });
app.post("/api/projects", requireUser, requireWriteAccess, async (req, res, next) => {
  try {
    const name = String(req.body.name || "عالمي الجديد").trim().slice(0, 80);
    if (name.length < 2) return res.status(400).json({ error: "اكتب اسمًا من حرفين على الأقل." });
    let guildId = null;
    if (req.body.guildId) {
      const guild = await authorizedGuild(req.user, req.body.guildId);
      if (!guild) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر" });
      guildId = guild.id;
    }
    const design = req.body.design && typeof req.body.design === "object" ? req.body.design : {};
    const { rows } = await pool.query("INSERT INTO projects(user_id,name,guild_id,design) VALUES($1,$2,$3,$4) RETURNING *", [req.user.id, name, guildId, design]);
    await audit(req.user.id, "project.create", "project", rows[0].id); res.status(201).json({ project: rows[0] });
  } catch (e) { next(e); }
});
app.put("/api/projects/:id", requireUser, requireWriteAccess, async (req, res, next) => {
  try {
    const { rows } = await pool.query("UPDATE projects SET name=COALESCE($1,name),guild_id=COALESCE($2,guild_id),design=COALESCE($3,design),updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *", [req.body.name?.slice(0,80) || null, req.body.guildId || null, req.body.design || null, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "المشروع غير موجود" });
    await audit(req.user.id, "project.update", "project", rows[0].id); res.json({ project: rows[0] });
  } catch (e) { next(e); }
});

app.get("/api/admin/stats", requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM users WHERE status='active') active,(SELECT COUNT(*) FROM users WHERE plan='starter') starter,(SELECT COUNT(*) FROM users WHERE plan='growth') growth,(SELECT COUNT(*) FROM users WHERE plan IN ('business','complete')) business,(SELECT COUNT(*) FROM users WHERE plan IN ('free','trial')) free,(SELECT COUNT(*) FROM projects WHERE archived_at IS NULL) projects,(SELECT COUNT(*) FROM guild_connections WHERE install_status='installed') connected_servers`);
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
    const plan = ["free","trial","starter","growth","business","complete"].includes(req.body.plan) ? req.body.plan : null;
    const status = ["active","suspended","cancelled"].includes(req.body.status) ? req.body.status : null;
    const { rows } = await pool.query("UPDATE users SET plan=COALESCE($1,plan),status=COALESCE($2,status),updated_at=NOW() WHERE id=$3 RETURNING *", [plan, status, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "المستخدم غير موجود" });
    await audit(req.user.id, "admin.user.update", "user", rows[0].id, { plan, status }); res.json({ user: publicUser(rows[0]) });
  } catch (e) { next(e); }
});
app.get("/api/admin/audit", requireAdmin, async (_req, res, next) => { try { const { rows } = await pool.query("SELECT a.*,u.username actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 100"); res.json({ logs: rows }); } catch (e) { next(e); } });

app.use((req, res, next) => {
  if (/^\/(?:server\.js|discord-bot\.js|package(?:-lock)?\.json|\.env(?:\..*)?|node_modules(?:\/|$)|docs(?:\/|$)|lib(?:\/|$)|tests(?:\/|$)|scripts(?:\/|$))/.test(req.path)) return res.status(404).end();
  next();
});
app.use((req, res, next) => {
  if (["/account.html", "/dashboard", "/account.js", "/dashboard.css", "/studio", "/studio.html", "/workspace.js", "/workspace.css", "/admin", "/admin.html", "/admin.js"].includes(req.path)) res.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  next();
});
app.use(express.static(__dirname, { extensions: ["html"], maxAge: IS_PRODUCTION ? "1h" : 0, dotfiles: "deny" }));
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "account.html")));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(__dirname, "account.html")));
app.get("/studio", (_req, res) => res.sendFile(path.join(__dirname, "studio.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.use((error, _req, res, _next) => { console.error(error); const status = Number(error.status) >= 400 && Number(error.status) < 500 ? Number(error.status) : 500; res.status(status).json({ error: status === 500 ? "حدث خطأ غير متوقع" : error.message, ...(error.code ? { code: error.code } : {}), ...(error.capacity ? { capacity: error.capacity } : {}) }); });

migrate().then(() => migrateWorkspace(pool)).then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`diskoko running on ${PORT}`));
  void startDiscordBot({ pool });
  startScheduleRunner({ pool, discordBotFetch, authorizedGuild });
}).catch((error) => { console.error("Database migration failed", error); process.exit(1); });





