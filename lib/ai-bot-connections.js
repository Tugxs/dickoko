import crypto from 'node:crypto';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleInteractiveButton, sendWelcomeCard } from './interactive-systems.js';

const api = 'https://discord.com/api/v10';
const clients = new Map();
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
  const response = await fetch(`${api}${pathname}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(12000) });
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
}
export async function migrateAiBotConnections(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_bot_connections (
    guild_id TEXT PRIMARY KEY, owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_user_id TEXT NOT NULL, bot_name TEXT NOT NULL, token_encrypted TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS publishing_bot_id TEXT;
  ALTER TABLE diskoko_giveaways ADD COLUMN IF NOT EXISTS publishing_bot_id TEXT;`);
}
export async function connectedBot(pool, guildId) {
  const row = (await pool.query('SELECT bot_user_id,bot_name,token_encrypted FROM ai_bot_connections WHERE guild_id=$1', [guildId])).rows[0];
  return row ? { id: row.bot_user_id, name: row.bot_name, token: open(row.token_encrypted) } : null;
}
export async function connectedBotMetadata(pool, guildId) {
  const row = (await pool.query('SELECT bot_user_id,bot_name,updated_at FROM ai_bot_connections WHERE guild_id=$1', [guildId])).rows[0];
  const client = clients.get(guildId);
  return row ? { id: row.bot_user_id, name: row.bot_name, updatedAt: row.updated_at, online: Boolean(client?.isReady() && client.guilds.cache.has(guildId)), memberJoins: client?._diskokoMemberJoins || false } : null;
}
export async function botTokenForPublication(pool, guildId) {
  const bot = await connectedBot(pool, guildId);
  if (!bot) return null;
  if (!clients.get(guildId)?.isReady() || !clients.get(guildId).guilds.cache.has(guildId)) throw Object.assign(new Error('بوتك الخاص غير متصل الآن. أعد الربط أو انتظر عودة الاتصال قبل النشر.'), { status: 503 });
  return { ...bot, memberJoins: clients.get(guildId)?._diskokoMemberJoins || false };
}
export async function startAiBot(pool, guildId, token, botId, memberJoins = false) {
  const old = clients.get(guildId);
  const client = new Client({ intents: [GatewayIntentBits.Guilds, ...(memberJoins ? [GatewayIntentBits.GuildMembers] : [])] });
  client._diskokoMemberJoins = memberJoins;
  client.on(Events.InteractionCreate, async interaction => {
    if (clients.get(guildId) !== client || interaction.guildId !== guildId || !interaction.isButton() || !interaction.customId.startsWith('diskoko:')) return;
    try { await handleInteractiveButton(interaction, pool); }
    catch (error) { console.error('Connected AI bot interaction failed', { guildId, error: error.message }); if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'تعذر تنفيذ العملية الآن.', ephemeral: true }).catch(() => {}); }
  });
  client.on(Events.GuildMemberAdd, member => { if (clients.get(guildId) === client && member.guild.id === guildId) void sendWelcomeCard(member, pool).catch(error => console.error('Connected AI bot welcome failed', { guildId, error: error.message })); });
  client.on(Events.Error, error => console.error('Connected AI bot gateway error', { guildId, error: error.message }));
  try {
    await client.login(token);
    if (client.user?.id !== botId || !client.guilds.cache.has(guildId)) throw Error('Bot is no longer in the selected guild');
    clients.set(guildId, client);
    if (old) await old.destroy();
  } catch (error) { await client.destroy(); throw error; }
}
export async function stopAiBot(guildId) {
  const client = clients.get(guildId);
  clients.delete(guildId);
  if (client) await client.destroy();
}
export async function restoreAiBots(pool) {
  const rows = (await pool.query('SELECT guild_id,bot_user_id,token_encrypted FROM ai_bot_connections')).rows;
  for (const row of rows) {
    try { const token = open(row.token_encrypted); const application = await discord(token, '/oauth2/applications/@me'); const flags = Number(application.data?.flags || 0); await startAiBot(pool, row.guild_id, token, row.bot_user_id, application.ok && Boolean(flags & ((1 << 14) | (1 << 15)))); }
    catch (error) { console.error('Connected AI bot could not start', { guildId: row.guild_id, error: error.message }); }
  }
}
export function mountAiBotConnections(app, { pool, requireUser, requireWriteAccess, authorizedGuild, audit }) {
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
    const identity = await discord(token, '/users/@me');
    if (!identity.ok || identity.data.bot !== true) return res.status(400).json({ error: 'تعذر التحقق من رمز البوت في Discord.' });
    const application = await discord(token, '/oauth2/applications/@me');
    if (!application.ok || String(application.data.bot?.id || application.data.id) !== identity.data.id) return res.status(400).json({ error: 'تعذر التحقق من تطبيق البوت.' });
    const membership = await discord(token, `/guilds/${encodeURIComponent(guild.id)}`);
    if (!membership.ok) {
      const invite = new URL('https://discord.com/oauth2/authorize');
      invite.search = new URLSearchParams({ client_id: identity.data.id, scope: 'bot', permissions: '117776', guild_id: guild.id, disable_guild_select: 'true' }).toString();
      return res.status(409).json({ error: 'بوتك غير مضاف لهذا السيرفر. أضفه عبر الرابط ثم اضغط تحقق واربط مرة أخرى.', inviteUrl: invite.toString() });
    }
    const name = String(identity.data.global_name || identity.data.username).slice(0, 80);
    const flags = Number(application.data.flags || 0);
    await startAiBot(pool, guild.id, token, identity.data.id, Boolean(flags & ((1 << 14) | (1 << 15))));
    await pool.query(`INSERT INTO ai_bot_connections(guild_id,owner_id,bot_user_id,bot_name,token_encrypted) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(guild_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,bot_user_id=EXCLUDED.bot_user_id,bot_name=EXCLUDED.bot_name,token_encrypted=EXCLUDED.token_encrypted,updated_at=NOW()`, [guild.id, req.user.id, identity.data.id, name, seal(token)]);
    await audit(req.user.id, 'ai.bot.connect', 'guild', guild.id, { botId: identity.data.id });
    res.json({ bot: await connectedBotMetadata(pool, guild.id) });
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
