import { ActivityType, Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import { BOT_COMMANDS, DEFAULT_BOT_COMMAND_KEYS, validBotCommandKeys } from './lib/bot-catalog.js';

const BOT_NAME = "diskoko | ديسكوكو";

let state = {
  configured: Boolean(process.env.DISCORD_BOT_TOKEN),
  online: false,
  username: null,
  guilds: 0,
  error: null,
  commands: { registered: 0, failed: 0 },
};

const COMMANDS = [
  BOT_COMMANDS.reduce((builder, item) => builder.addSubcommand(command => command.setName(item.key).setDescription(item.discordDescription)), new SlashCommandBuilder().setName('diskoko').setDescription('مساعد Diskoko لمجتمعك')),
];
const COMMAND_JSON = COMMANDS.map((command) => command.toJSON());
const DEFAULT_SETTINGS = { enabled: true, command_keys: [...DEFAULT_BOT_COMMAND_KEYS], log_channel_id: null, locale: "ar", welcome_enabled: false };
let databasePool = null;

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
  databasePool = pool || null;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn("DISCORD_BOT_TOKEN is missing; Discord bot will stay offline");
    return null;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

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
    state = {
      configured: true,
      online: true,
      username: readyClient.user.username,
      guilds: readyClient.guilds.cache.size,
      error: null,
      commands: { registered: 0, failed: 0 },
    };

    readyClient.user.setPresence({
      activities: [{ name: "مجتمعاتكم • diskoko", type: ActivityType.Watching }],
      status: "online",
    });

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
    if (!interaction.isChatInputCommand() || interaction.commandName !== "diskoko") return;
    const subcommand = interaction.options.getSubcommand();
    const settings = await guildSettings(interaction.guildId);
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
  client.on("shardDisconnect", () => { state.online = false; });
  client.on("shardResume", () => { state.online = true; state.error = null; });

  try {
    await client.login(token);
    return client;
  } catch (error) {
    console.error("Discord bot login failed", error);
    state = { ...state, online: false, error: "login_failed" };
    return null;
  }
}
