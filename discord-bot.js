import { ActivityType, Client, GatewayIntentBits } from "discord.js";

const BOT_NAME = "diskoko | ديسكوكو";

let state = {
  configured: Boolean(process.env.DISCORD_BOT_TOKEN),
  online: false,
  username: null,
  guilds: 0,
  error: null,
};

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
    };

    readyClient.user.setPresence({
      activities: [{ name: "مجتمعاتكم • diskoko", type: ActivityType.Watching }],
      status: "online",
    });

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
