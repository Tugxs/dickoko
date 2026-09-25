import crypto from 'node:crypto';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleInteractiveButton, sendWelcomeCard } from './interactive-systems.js';
import { waitForGatewayLoginSlot } from './gateway-login-gate.js';
import { createDiscordRequestGate } from './discord-rate-limit.js';

const api = 'https://discord.com/api/v10';
const clients = new Map();
const reconnectTimers = new Map();
const connectionRequestGate = createDiscordRequestGate({ requestsPerSecond: 4, concurrency: 1, maxPending: 200 });
const gatewayRetryMs = error => Math.max(60_000, Math.min(2_147_000_000, Number(error?.retryAfter) || 300_000) + 1_000);
const key = () => crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || '').digest();
function seal(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  return [iv, cipher.update(token, 'utf8'), cipher.final(), cipher.getAuthTag()].map(part => part.toString('base64url')).join('.');
}
function open(value) {
  const [iv, first, last, tag] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(first), decipher.update(last), decipher.final()]).toString();
}
async function discord(token, pathname) {
  const tokenKey = crypto.createHash('sha256').update(token).digest('hex');
  const response = await connectionRequestGate(tokenKey, `GET ${pathname}`, `${api}${pathname}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(12000) });
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
}
export async function migrateAiBotConnections(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_bot_connections (
    guild_id TEXT PRIMARY KEY, owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_user_id TEXT NOT NULL, bot_name TEXT NOT NULL, token_encrypted TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retry_at TIMESTAMPTZ, member_joins BOOLEAN
  );
  ALTER TABLE ai_bot_connections ADD COLUMN IF NOT EXISTS retry_at TIMESTAMPTZ;
  ALTER TABLE ai_bot_connections ADD COLUMN IF NOT EXISTS member_joins BOOLEAN;
  ALTER TABLE ai_bot_connections ADD COLUMN IF NOT EXISTS gateway_seen_at TIMESTAMPTZ;
  CREATE TABLE IF NOT EXISTS bot_gateway_cooldown (id SMALLINT PRIMARY KEY CHECK (id=1), retry_at TIMESTAMPTZ NOT NULL);
  CREATE TABLE IF NOT EXISTS bot_runtime_state (id TEXT PRIMARY KEY, status JSONB NOT NULL, seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS publishing_bot_id TEXT;
  ALTER TABLE diskoko_giveaways ADD COLUMN IF NOT EXISTS publishing_bot_id TEXT;`);
}
async function sharedGatewayRetryAt(pool) {
  const row = (await pool.query('SELECT retry_at FROM bot_gateway_cooldown WHERE id=1')).rows[0];
  return row?.retry_at ? new Date(row.retry_at).getTime() : 0;
}
async function saveSharedGatewayCooldown(pool, retryAt) {
  await pool.query('INSERT INTO bot_gateway_cooldown(id,retry_at) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET retry_at=GREATEST(bot_gateway_cooldown.retry_at,EXCLUDED.retry_at)', [retryAt]);
}
export async function connectedBot(pool, guildId) {
  const row = (await pool.query('SELECT bot_user_id,bot_name,token_encrypted FROM ai_bot_connections WHERE guild_id=$1', [guildId])).rows[0];
  return row ? { id: row.bot_user_id, name: row.bot_name, token: open(row.token_encrypted) } : null;
}
export async function connectedBotMetadata(pool, guildId) {
  const row = (await pool.query('SELECT bot_user_id,bot_name,updated_at,retry_at,member_joins,gateway_seen_at FROM ai_bot_connections WHERE guild_id=$1', [guildId])).rows[0];
  const client = clients.get(guildId);
  const localOnline = Boolean(client?.isReady() && client.guilds.cache.has(guildId));
  const workerOnline = process.env.BOT_GATEWAY_MODE === 'external' && Date.now() - new Date(row?.gateway_seen_at || 0).getTime() < 35_000;
  return row ? { id: row.bot_user_id, name: row.bot_name, updatedAt: row.updated_at, online: localOnline || workerOnline, memberJoins: client?._diskokoMemberJoins ?? row.member_joins ?? false, retryAt: row.retry_at } : null;
}
export async function botTokenForPublication(pool, guildId) {
  const bot = await connectedBot(pool, guildId);
  if (!bot) return null;
  const status = await connectedBotMetadata(pool, guildId);
  if (!status?.online) throw Object.assign(new Error('بوتك الخاص غير متصل الآن. أعد الربط أو انتظر عودة الاتصال قبل النشر.'), { status: 503 });
  return { ...bot, memberJoins: status.memberJoins };
}
export async function startAiBot(pool, guildId, token, botId, memberJoins = false) {
  const old = clients.get(guildId);
  const client = new Client({ intents: [GatewayIntentBits.Guilds, ...(memberJoins ? [GatewayIntentBits.GuildMembers] : [])], rest: { rejectOnRateLimit: () => true } });
  client._diskokoMemberJoins = memberJoins;
  client.on(Events.InteractionCreate, async interaction => {
    if (clients.get(guildId) !== client || interaction.guildId !== guildId || !interaction.isButton() || !interaction.customId.startsWith('diskoko:')) return;
    try { await handleInteractiveButton(interaction, pool); }
    catch (error) { console.error('Connected AI bot interaction failed', { guildId, error: error.message }); if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'تعذر تنفيذ العملية الآن.', ephemeral: true }).catch(() => {}); }
  });
  client.on(Events.GuildMemberAdd, member => { if (clients.get(guildId) === client && member.guild.id === guildId) void sendWelcomeCard(member, pool).catch(error => console.error('Connected AI bot welcome failed', { guildId, error: error.message })); });
  client.on(Events.Error, error => console.error('Connected AI bot gateway error', { guildId, error: error.message }));
  client.on('shardDisconnect', () => {
    setTimeout(() => {
      if (clients.get(guildId) !== client || client.isReady()) return;
      clients.delete(guildId);
      void client.destroy().catch(() => {});
      scheduleAiBotRestore(pool, { guild_id: guildId }, 0);
    }, 90_000).unref();
  });
  let timeout;
  try {
    await waitForGatewayLoginSlot();
    await Promise.race([
      client.login(token),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Connected bot gateway connection timed out')), 30_000); }),
    ]);
    if (client.user?.id !== botId || !client.guilds.cache.has(guildId)) throw Error('Bot is no longer in the selected guild');
    clients.set(guildId, client);
    if (old) await old.destroy();
    await pool.query('UPDATE ai_bot_connections SET retry_at=NULL WHERE guild_id=$1', [guildId]);
    const timer = reconnectTimers.get(guildId);
    if (timer) clearTimeout(timer);
    reconnectTimers.delete(guildId);
  } catch (error) { await client.destroy(); throw error; }
  finally { clearTimeout(timeout); }
}
export async function stopAiBot(guildId) {
  const timer = reconnectTimers.get(guildId);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(guildId);
  const client = clients.get(guildId);
  clients.delete(guildId);
  if (client) await client.destroy();
}
export async function stopAllAiBots() {
  for (const guildId of new Set([...clients.keys(), ...reconnectTimers.keys()])) await stopAiBot(guildId);
}
export async function restoreAiBots(pool) {
  const rows = (await pool.query('SELECT guild_id,bot_user_id,token_encrypted,retry_at,updated_at FROM ai_bot_connections')).rows;
  const sharedUntil = await sharedGatewayRetryAt(pool);
  for (const [index, row] of rows.entries()) scheduleAiBotRestore(pool, row, Math.max(index * 4_000, sharedUntil - Date.now(), new Date(row.retry_at || 0).getTime() - Date.now()));
}
export async function syncAiBots(pool) {
  const rows = (await pool.query('SELECT guild_id,bot_user_id,token_encrypted,retry_at FROM ai_bot_connections')).rows;
  const currentGuilds = new Set(rows.map(row => row.guild_id));
  for (const guildId of clients.keys()) if (!currentGuilds.has(guildId)) await stopAiBot(guildId);
  for (const row of rows) {
    let client = clients.get(row.guild_id);
    if (client && client._diskokoConnectionVersion !== new Date(row.updated_at).getTime()) { await stopAiBot(row.guild_id); client = null; }
    if (!client?.isReady() && !reconnectTimers.has(row.guild_id)) scheduleAiBotRestore(pool, row, Math.max(0, new Date(row.retry_at || 0).getTime() - Date.now()));
    if (client?.isReady() && client.guilds.cache.has(row.guild_id)) await pool.query('UPDATE ai_bot_connections SET gateway_seen_at=NOW() WHERE guild_id=$1 AND bot_user_id=$2', [row.guild_id, row.bot_user_id]);
  }
}
function scheduleAiBotRestore(pool, row, delayMs) {
  const guildId = row.guild_id;
  const prior = reconnectTimers.get(guildId);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(() => { reconnectTimers.delete(guildId); void (async () => {
    try {
      const current = (await pool.query('SELECT guild_id,bot_user_id,token_encrypted,member_joins,updated_at FROM ai_bot_connections WHERE guild_id=$1', [guildId])).rows[0];
      if (!current) return;
      const sharedRemaining = await sharedGatewayRetryAt(pool) - Date.now();
      if (sharedRemaining > 0) { scheduleAiBotRestore(pool, row, sharedRemaining); return; }
      const token = open(current.token_encrypted);
      let memberJoins = current.member_joins;
      if (memberJoins == null) {
        const application = await discord(token, '/oauth2/applications/@me');
        if (!application.ok) throw Error(`Discord application lookup failed (${application.status})`);
        const flags = Number(application.data?.flags || 0);
        memberJoins = Boolean(flags & ((1 << 14) | (1 << 15)));
        await pool.query('UPDATE ai_bot_connections SET member_joins=$2 WHERE guild_id=$1', [guildId, memberJoins]);
      }
      await startAiBot(pool, guildId, token, current.bot_user_id, memberJoins);
      const activeClient = clients.get(guildId);
      if (activeClient) activeClient._diskokoConnectionVersion = new Date(current.updated_at).getTime();
      console.info('Connected AI bot ready', { guildId });
    } catch (error) {
      const rateLimited = String(error.name || '').startsWith('RateLimitError');
      const permanent = /TokenInvalid|TOKEN_INVALID|Bot is no longer in the selected guild|\((?:401|403|404)\)/i.test(String(error.name || '') + ' ' + String(error.message || ''));
      const retryMs = rateLimited ? gatewayRetryMs(error) : 300_000;
      console.error('Connected AI bot could not start', { guildId, error: error.message, retryAfterMs: rateLimited ? retryMs : undefined });
      if (permanent) return;
      if (rateLimited) {
        const retryAt = new Date(Date.now() + retryMs);
        await Promise.all([pool.query('UPDATE ai_bot_connections SET retry_at=$2 WHERE guild_id=$1', [guildId, retryAt]), saveSharedGatewayCooldown(pool, retryAt)]).catch(saveError => console.error('Could not save connected bot cooldown', saveError.message));
      }
      scheduleAiBotRestore(pool, row, retryMs);
    }
  })(); }, Math.min(2_147_000_000, Math.max(0, delayMs)));
  reconnectTimers.set(guildId, timer);
}
export function mountAiBotConnections(app, { pool, requireUser, requireWriteAccess, authorizedGuild, requirePlanCapacity, audit }) {
  app.get('/api/ai/bot-connection', requireUser, async (req, res, next) => { try {
    const guild = await authorizedGuild(req.user, String(req.query.guildId || ''));
    if (!guild) return res.status(403).json({ error: 'لا تملك صلاحية إدارة هذا السيرفر.' });
    res.json({ bot: await connectedBotMetadata(pool, guild.id) });
  } catch (error) { next(error); } });
  app.post('/api/ai/bot-connection', requireUser, requireWriteAccess, async (req, res, next) => { try {
    const guild = await authorizedGuild(req.user, String(req.body.guildId || ''));
    if (!guild) return res.status(403).json({ error: 'لا تملك صلاحية إدارة هذا السيرفر.' });
    const token = String(req.body.token || '').trim();
    if (!/^[A-Za-z0-9._-]{40,200}$/.test(token)) return res.status(400).json({ error: 'رمز البوت غير صالح. انسخه من Discord Developer Portal.' });
    const existing = (await pool.query('SELECT install_status FROM guild_connections WHERE user_id=$1 AND guild_id=$2', [req.user.id, guild.id])).rows[0];
    if (existing?.install_status !== 'installed') await requirePlanCapacity(req.user, 'servers');
    const identity = await discord(token, '/users/@me');
    if (identity.status === 429 || identity.status === 503) return res.status(503).json({ error: 'Discord مشغول مؤقتًا. انتظر المهلة ثم أعد محاولة الربط.' });
    if (!identity.ok || identity.data.bot !== true) return res.status(400).json({ error: 'تعذر التحقق من رمز البوت في Discord.' });
    const application = await discord(token, '/oauth2/applications/@me');
    if (application.status === 429 || application.status === 503) return res.status(503).json({ error: 'Discord مشغول مؤقتًا. انتظر المهلة ثم أعد محاولة الربط.' });
    if (!application.ok || String(application.data.bot?.id || application.data.id) !== identity.data.id) return res.status(400).json({ error: 'تعذر التحقق من تطبيق البوت.' });
    const membership = await discord(token, `/guilds/${encodeURIComponent(guild.id)}`);
    if (membership.status === 429 || membership.status === 503) return res.status(503).json({ error: 'تعذر التحقق من السيرفر مؤقتًا بسبب حد Discord. أعد المحاولة لاحقًا.' });
    if (!membership.ok) {
      const invite = new URL('https://discord.com/oauth2/authorize');
      invite.search = new URLSearchParams({ client_id: identity.data.id, scope: 'bot', permissions: '17592186162192', guild_id: guild.id, disable_guild_select: 'true' }).toString();
      return res.status(409).json({ error: 'بوتك غير مضاف لهذا السيرفر. أضفه عبر الرابط ثم اضغط تحقق واربط مرة أخرى.', inviteUrl: invite.toString() });
    }
    const name = String(identity.data.global_name || identity.data.username).slice(0, 80);
    const flags = Number(application.data.flags || 0);
    const sharedRemaining = await sharedGatewayRetryAt(pool) - Date.now();
    let retryAt = sharedRemaining > 0 ? new Date(Date.now() + sharedRemaining) : null;
    if (!retryAt && process.env.BOT_GATEWAY_MODE !== 'external') {
      try { await startAiBot(pool, guild.id, token, identity.data.id, Boolean(flags & ((1 << 14) | (1 << 15)))); }
      catch (error) {
        if (!String(error.name || '').startsWith('RateLimitError')) throw error;
        retryAt = new Date(Date.now() + gatewayRetryMs(error));
        await saveSharedGatewayCooldown(pool, retryAt);
      }
    }
    await pool.query(`INSERT INTO ai_bot_connections(guild_id,owner_id,bot_user_id,bot_name,token_encrypted,retry_at,member_joins) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(guild_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,bot_user_id=EXCLUDED.bot_user_id,bot_name=EXCLUDED.bot_name,token_encrypted=EXCLUDED.token_encrypted,retry_at=EXCLUDED.retry_at,member_joins=EXCLUDED.member_joins,updated_at=NOW()`, [guild.id, req.user.id, identity.data.id, name, seal(token), retryAt, Boolean(flags & ((1 << 14) | (1 << 15)))]);
    await pool.query("INSERT INTO guild_connections(user_id,guild_id,guild_name,install_status,last_verified_at,updated_at) VALUES($1,$2,$3,'installed',NOW(),NOW()) ON CONFLICT(user_id,guild_id) DO UPDATE SET guild_name=EXCLUDED.guild_name,install_status='installed',last_verified_at=NOW(),updated_at=NOW()", [req.user.id, guild.id, guild.name]);
    if (retryAt && process.env.BOT_GATEWAY_MODE !== 'external') { await stopAiBot(guild.id); scheduleAiBotRestore(pool, { guild_id: guild.id }, retryAt.getTime() - Date.now()); }
    await audit(req.user.id, 'ai.bot.connect', 'guild', guild.id, { botId: identity.data.id });
    res.status(retryAt || process.env.BOT_GATEWAY_MODE === 'external' ? 202 : 200).json({ bot: await connectedBotMetadata(pool, guild.id), pending: Boolean(retryAt || process.env.BOT_GATEWAY_MODE === 'external') });
  } catch (error) { next(error); } });
  app.delete('/api/ai/bot-connection', requireUser, requireWriteAccess, async (req, res, next) => { try {
    const guild = await authorizedGuild(req.user, String(req.body.guildId || ''));
    if (!guild) return res.status(403).json({ error: 'لا تملك صلاحية إدارة هذا السيرفر.' });
    await pool.query('DELETE FROM ai_bot_connections WHERE guild_id=$1', [guild.id]);
    await stopAiBot(guild.id);
    await audit(req.user.id, 'ai.bot.disconnect', 'guild', guild.id, {});
    res.json({ bot: null });
  } catch (error) { next(error); } });
}
