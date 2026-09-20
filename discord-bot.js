import { ActivityType, Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";

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
  new SlashCommandBuilder().setName("diskoko").setDescription("مساعد Diskoko لمجتمعك").addSubcommand((command) => command.setName("help").setDescription("عرض المساعدة")).addSubcommand((command) => command.setName("ping").setDescription("فحص سرعة الاستجابة")).addSubcommand((command) => command.setName("about").setDescription("عرض معلومات Diskoko")),
];
const COMMAND_JSON = COMMANDS.map((command) => command.toJSON());

export function getDiscordBotStatus() {
  return { ...state };
}

export async function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn("DISCORD_BOT_TOKEN is missing; Discord bot will stay offline");
    return null;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
      try {
        await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guild.id), { body: COMMAND_JSON });
        state.commands.registered += COMMAND_JSON.length;
      } catch (error) {
        state.commands.failed += COMMAND_JSON.length;
        console.error(`Could not register commands for guild ${guild.id}`, error);
      }
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

  client.on("guildCreate", () => { state.guilds = client.guilds.cache.size; });
  client.on("guildDelete", () => { state.guilds = client.guilds.cache.size; });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "diskoko") return;
    const subcommand = interaction.options.getSubcommand();
    const replies = {
      help: "الأوامر المتاحة: `/diskoko ping` لفحص الاستجابة، و`/diskoko about` لمعرفة حالة Diskoko.",
      ping: `Pong — ${Date.now() - interaction.createdTimestamp}ms.`,
      about: "Diskoko يساعدك على تصميم وإدارة مجتمع Discord مع مراجعة بشرية قبل التغييرات الحساسة.",
    };
    try { await interaction.reply({ content: replies[subcommand] || replies.help, ephemeral: true }); } catch (error) { console.error("Discord interaction reply failed", error); }
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
