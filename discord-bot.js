import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ActivityType, Client, Events, GatewayIntentBits, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import { BOT_COMMANDS, DEFAULT_BOT_COMMAND_KEYS, validBotCommandKeys } from './lib/bot-catalog.js';
import { canonicalPlan, subscriptionAccess } from './lib/billing.js';
import { claimSupportTicket, handleInteractiveButton, reopenSupportTicket, repairLegacyTicketControls, sendWelcomeCard } from './lib/interactive-systems.js';

const BOT_NAME = "diskoko | ديسكوكو";

let state = {
  configured: Boolean(process.env.DISCORD_BOT_TOKEN),
  online: false,
  username: null,
  guilds: 0,
  memberJoins: false,
  error: null,
  commands: { registered: 0, failed: 0 },
};
let botClient = null;
let retryTimer = null;
let retryCount = 0;
let starting = false;
let memberIntentAllowed = true;

const COMMANDS = [
  BOT_COMMANDS.reduce((builder, item) => builder.addSubcommand(command => command.setName(item.key).setDescription(item.discordDescription)), new SlashCommandBuilder().setName('diskoko').setDescription('مساعد Diskoko لمجتمعك'))
    .addSubcommand(command => command.setName('ai').setDescription('اسأل AI ديسكوكو عن تنظيم سيرفرك').addStringOption(option => option.setName('prompt').setDescription('ما الذي تريد تنظيمه؟').setRequired(true).setMaxLength(1000)))
    .addSubcommand(command => command.setName('claim').setDescription('استلام تذكرة الدعم الحالية — لفريق الدعم فقط'))
    .addSubcommand(command => command.setName('reopen').setDescription('إعادة فتح تذكرة الدعم الحالية — لفريق الدعم فقط')),
];
const COMMAND_JSON = COMMANDS.map((command) => command.toJSON());
const DEFAULT_SETTINGS = { enabled: true, command_keys: [...DEFAULT_BOT_COMMAND_KEYS], log_channel_id: null, locale: "ar", welcome_enabled: false };
let databasePool = null;
const AI_LIMITS = { free: 0, starter: 20, growth: 100, business: 300 };

async function answerAiInteraction(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!databasePool || !process.env.AI_WORKER_TOKEN) return interaction.editReply('AI ديسكوكو غير متصل حاليًا. حاول لاحقًا.');
  if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.editReply('هذا الأمر لمديري السيرفر فقط.');
  const user = (await databasePool.query(`SELECT u.id,u.plan FROM users u JOIN guild_connections g ON g.user_id=u.id AND g.guild_id=$1
    WHERE u.discord_id=$2 AND u.status='active' AND g.install_status='installed' LIMIT 1`, [interaction.guildId, interaction.user.id])).rows[0];
  if (!user) return interaction.editReply('اربط حساب Discord وسيرفرك في diskoko.com أولًا.');
  const plan = canonicalPlan(user.plan);
  const limit = AI_LIMITS[plan] || 0;
  if (!limit) return interaction.editReply('AI ديسكوكو متاح من باقة Starter. طوّر باقتك من الموقع أولًا.');
  const subscription = (await databasePool.query('SELECT status,grace_until FROM subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1', [user.id])).rows[0];
  if (subscriptionAccess(subscription || { status: 'active' }).mode !== 'full') return interaction.editReply('اشتراكك في وضع القراءة فقط. حدّث وسيلة الدفع من الموقع لاستئناف AI ديسكوكو.');
  const online = (await databasePool.query("SELECT last_seen_at FROM ai_worker_state WHERE id=1 AND last_seen_at > NOW()-INTERVAL '1 minute'")).rows[0];
  if (!online) return interaction.editReply('جهاز AI ديسكوكو غير متصل حاليًا. حاول لاحقًا.');
  const prompt = interaction.options.getString('prompt', true).trim();
  const client = await databasePool.connect();
  let id;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::int,$2::int)', [Number(user.id) % 2147483647, 791]);
    const daily = (await client.query("SELECT COUNT(*)::int AS total FROM ai_requests WHERE user_id=$1 AND created_at > NOW()-INTERVAL '24 hours'", [user.id])).rows[0].total;
    if (daily >= limit) { await client.query('ROLLBACK'); return interaction.editReply('وصلت إلى حد طلبات AI ديسكوكو اليومية لهذه الباقة.'); }
    const active = (await client.query("SELECT id FROM ai_requests WHERE user_id=$1 AND status IN ('pending','processing') LIMIT 1", [user.id])).rows[0];
    if (active) { await client.query('ROLLBACK'); return interaction.editReply('لديك طلب قيد المعالجة. انتظر نتيجته أولًا.'); }
    id = crypto.randomUUID();
    await client.query('INSERT INTO ai_requests(id,user_id,guild_id,prompt) VALUES($1,$2,$3,$4)', [id, user.id, interaction.guildId, prompt]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(3000);
    const result = (await databasePool.query('SELECT status,answer,error FROM ai_requests WHERE id=$1 AND user_id=$2', [id, user.id])).rows[0];
    if (result?.status === 'completed') return interaction.editReply(String(result.answer).slice(0, 1900));
    if (result?.status === 'failed') return interaction.editReply(result.error || 'تعذر توليد الرد. حاول مجددًا.');
  }
  return interaction.editReply('الطلب ما زال قيد المعالجة. افتح AI ديسكوكو في الموقع للمتابعة.');
}

async function guildSettings(guildId) {
  if (!databasePool) return DEFAULT_SETTINGS;
  try {
    const { rows } = await databasePool.query("SELECT enabled,command_keys,log_channel_id,locale,welcome_enabled FROM bot_guild_settings WHERE guild_id=$1", [guildId]);
    return rows[0] ? { ...DEFAULT_SETTINGS, ...rows[0], command_keys: validBotCommandKeys(rows[0].command_keys) } : DEFAULT_SETTINGS;
  } catch (error) {
    console.error("Could not read bot guild settings", error);
    return DEFAULT_SETTINGS;
  }
}

async function recordCommand(guildId, commandKey, success) {
  if (!databasePool || !guildId) return;
  try {
    await databasePool.query(`INSERT INTO bot_command_daily(guild_id,day,command_key,total,failed)
      VALUES($1,(NOW() AT TIME ZONE 'UTC')::date,$2,1,$3)
      ON CONFLICT(guild_id,day,command_key) DO UPDATE SET total=bot_command_daily.total+1,failed=bot_command_daily.failed+EXCLUDED.failed`,
    [guildId, commandKey, success ? 0 : 1]);
  } catch (error) { console.error('Could not record bot command', error.message); }
}

async function registerGuildCommands(rest, applicationId, guildId, token) {
  try {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: COMMAND_JSON });
    return true;
  } catch (error) {
    console.error(`Could not register commands for guild ${guildId}`, error);
    return false;
  }
}

export function getDiscordBotStatus() {
  return { ...state };
}

export async function startDiscordBot({ pool } = {}) {
  if (starting || botClient?.isReady()) return botClient;
  starting = true;
  databasePool = pool || null;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn("DISCORD_BOT_TOKEN is missing; Discord bot will stay offline");
    starting = false;
    return null;
  }

  // The intent is enabled in the Discord Developer Portal. Do not make a REST
  // request (or change application flags) before every gateway connection.
  const memberJoins = memberIntentAllowed;
  state.memberJoins = memberJoins;
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, ...(memberJoins ? [GatewayIntentBits.GuildMembers] : [])] });

  client.on(Events.GuildMemberAdd, member => {
    if (databasePool) void (async () => {
      const linked = (await databasePool.query('SELECT 1 FROM ai_bot_connections WHERE guild_id=$1', [member.guild.id])).rowCount;
      if (!linked) await sendWelcomeCard(member, databasePool);
    })().catch(error => console.error('Welcome card delivery failed', member.guild.id, error.message));
  });

  // Count events only after an administrator opts in. Never read or store message content.
  client.on(Events.MessageCreate, async (message) => {
    if (!databasePool || !message.guildId || message.author.bot) return;
    try {
      await databasePool.query(`INSERT INTO community_activity(guild_id,day,user_id,channel_id,display_name,messages)
        SELECT $1,(NOW() AT TIME ZONE 'UTC')::date,$2,$3,$4,1 FROM workspace_preferences WHERE guild_id=$1 AND analytics_enabled=TRUE
        ON CONFLICT(guild_id,day,user_id,channel_id) DO UPDATE SET messages=community_activity.messages+1,display_name=EXCLUDED.display_name`,
      [message.guildId, message.author.id, message.channelId, (message.member?.displayName || message.author.globalName || message.author.username).slice(0, 100)]);
    } catch (error) { console.error('Activity count failed', error.message); }
  });

  client.once("ready", async (readyClient) => {
    botClient = readyClient;
    retryCount = 0;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    state = {
      configured: true,
      online: true,
      username: readyClient.user.username,
      guilds: readyClient.guilds.cache.size,
      memberJoins,
      error: null,
      commands: { registered: 0, failed: 0 },
    };

    readyClient.user.setPresence({
      activities: [{ name: "مجتمعاتكم • diskoko", type: ActivityType.Watching }],
      status: "online",
    });

    if (databasePool) void repairLegacyTicketControls(readyClient, databasePool).catch(error => console.error('Ticket controls repair failed', error.message));

    const rest = new REST({ version: "10" }).setToken(token);
    for (const guild of readyClient.guilds.cache.values()) {
      if (await registerGuildCommands(rest, readyClient.user.id, guild.id, token)) state.commands.registered += COMMAND_JSON.length;
      else state.commands.failed += COMMAND_JSON.length;
    }

    if (readyClient.user.username !== BOT_NAME) {
      try {
        await readyClient.user.setUsername(BOT_NAME);
        state.username = BOT_NAME;
        console.log(`Discord bot renamed to ${BOT_NAME}`);
      } catch (error) {
        console.error("Could not rename Discord bot", error);
        state.error = "rename_failed";
      }
    }

    console.log(`Discord bot online as ${readyClient.user.tag} in ${state.guilds} guild(s)`);
  });

  client.on("guildCreate", async (guild) => { state.guilds = client.guilds.cache.size; const rest = new REST({ version: "10" }).setToken(token); if (await registerGuildCommands(rest, client.user.id, guild.id, token)) state.commands.registered += COMMAND_JSON.length; else state.commands.failed += COMMAND_JSON.length; });
  client.on("guildDelete", () => { state.guilds = client.guilds.cache.size; });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('diskoko:')) {
      try { await handleInteractiveButton(interaction, databasePool); }
      catch (error) { console.error('Interactive button failed:', error); if (interaction.deferred || interaction.replied) await interaction.editReply('تعذر إكمال العملية الآن. حاول مرة أخرى.').catch(() => {}); else await interaction.reply({ content: 'تعذر إكمال العملية الآن.', ephemeral: true }).catch(() => {}); }
      return;
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== "diskoko") return;
    const subcommand = interaction.options.getSubcommand();
    const settings = await guildSettings(interaction.guildId);
    if (subcommand === 'claim') {
      if (!settings.enabled) return interaction.reply({ content: 'البوت غير مفعّل لهذا السيرفر.', ephemeral: true });
      try { await interaction.deferReply({ ephemeral: true }); await claimSupportTicket(interaction, databasePool); }
      catch (error) { console.error('Ticket claim command failed', error); if (interaction.deferred || interaction.replied) await interaction.editReply('تعذر استلام التذكرة الآن. حاول مجددًا.').catch(() => {}); }
      return;
    }
    if (subcommand === 'reopen') {
      if (!settings.enabled) return interaction.reply({ content: 'البوت غير مفعّل لهذا السيرفر.', ephemeral: true });
      try { await interaction.deferReply({ ephemeral: true }); await reopenSupportTicket(interaction, databasePool); }
      catch (error) { console.error('Ticket reopen command failed', error); if (interaction.deferred || interaction.replied) await interaction.editReply('تعذرت إعادة فتح التذكرة الآن. حاول مجددًا.').catch(() => {}); }
      return;
    }
    if (subcommand === 'ai') {
      if (!settings.enabled) return interaction.reply({ content: 'البوت غير مفعّل لهذا السيرفر.', ephemeral: true });
      try { await answerAiInteraction(interaction); void recordCommand(interaction.guildId, 'ai', true); }
      catch (error) { console.error('AI command failed', error); void recordCommand(interaction.guildId, 'ai', false); if (interaction.deferred || interaction.replied) await interaction.editReply('تعذر تشغيل AI ديسكوكو الآن. حاول مجددًا.').catch(() => {}); else await interaction.reply({ content: 'تعذر تشغيل AI ديسكوكو الآن.', ephemeral: true }).catch(() => {}); }
      return;
    }
    if (!settings.enabled || !settings.command_keys.includes(subcommand)) return interaction.reply({ content: settings.locale === "en" ? "This command is disabled for this server." : "هذا الأمر غير مفعّل لهذا السيرفر.", ephemeral: true });
    const replies = settings.locale === 'en' ? {
      help: `Available commands: ${settings.command_keys.map(key => '`/diskoko ' + key + '`').join(', ')}`,
      ping: `Pong — ${Date.now() - interaction.createdTimestamp}ms.`,
      about: 'Diskoko helps you manage your community with reviewed changes, scheduled announcements and activity insights.',
    } : {
      help: `الأوامر المفعلة: ${settings.command_keys.map(key => '`/diskoko ' + key + '`').join('، ')}`,
      ping: `Pong — ${Date.now() - interaction.createdTimestamp}ms.`,
      about: "Diskoko يساعدك على تصميم وإدارة مجتمع Discord مع مراجعة بشرية قبل التغييرات الحساسة.",
    };
    try {
      await interaction.reply({ content: replies[subcommand] || replies.help, ephemeral: true });
      void recordCommand(interaction.guildId, subcommand, true);
      if (settings.log_channel_id) { const channel = await client.channels.fetch(settings.log_channel_id).catch(() => null); if (channel?.guildId === interaction.guildId && channel?.isTextBased()) await channel.send({ content: `Diskoko command executed: /diskoko ${subcommand}`, allowedMentions: { parse: [] } }).catch(() => {}); }
    } catch (error) { void recordCommand(interaction.guildId, subcommand, false); console.error("Discord interaction reply failed", error); }
  });
  client.on("error", (error) => {
    console.error("Discord client error", error);
    state.error = "client_error";
  });
  client.on("shardDisconnect", () => {
    state.online = false;
    const disconnected = client;
    setTimeout(() => {
      if (botClient !== disconnected || disconnected.isReady()) return;
      console.warn('Discord gateway did not recover; reconnecting bot');
      botClient = null;
      void disconnected.destroy().catch(() => {});
      void startDiscordBot({ pool: databasePool });
    }, 90_000).unref();
  });
  client.on("shardResume", () => { state.online = true; state.error = null; });

  let timeout;
  try {
    await Promise.race([
      client.login(token),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Discord gateway connection timed out')), 60_000); }),
    ]);
    botClient = client;
    starting = false;
    return client;
  } catch (error) {
    console.error("Discord bot login failed", error);
    await client.destroy().catch(() => {});
    if (Number(error.code) === 4014 || /disallowed intents|4014/i.test(error.message || '')) memberIntentAllowed = false;
    state = { ...state, online: false, memberJoins: false, error: "login_failed" };
    retryCount++;
    const retryMs = Math.min(300_000, 30_000 * 2 ** Math.min(retryCount - 1, 4));
    if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; void startDiscordBot({ pool: databasePool }); }, retryMs).unref();
    starting = false;
    return null;
  } finally { clearTimeout(timeout); }
}


