import pg from 'pg';
import { getDiscordBotStatus, startDiscordBot, stopDiscordBot } from './discord-bot.js';
import { migrateAiBotConnections, restoreAiBots, stopAllAiBots, syncAiBots } from './lib/ai-bot-connections.js';

const required = ['DATABASE_URL', 'ENCRYPTION_KEY', 'DISCORD_BOT_TOKEN'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing bot worker environment variables: ${missing.join(', ')}`);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
let stopping = false;
let running = false;
let interval;

async function heartbeat() {
  if (stopping || running) return;
  running = true;
  try {
    await syncAiBots(pool);
    await pool.query("INSERT INTO bot_runtime_state(id,status,seen_at) VALUES('original',$1,NOW()) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,seen_at=NOW()", [getDiscordBotStatus()]);
  } catch (error) { console.error('Bot worker heartbeat failed', error); }
  finally { running = false; }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  const timeout = setTimeout(() => process.exit(1), 25_000).unref();
  try {
    await Promise.all([stopDiscordBot(), stopAllAiBots()]);
    await pool.query("DELETE FROM bot_runtime_state WHERE id='original'");
    await pool.end();
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) { console.error('Bot worker shutdown failed', error); process.exit(1); }
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await migrateAiBotConnections(pool);
await startDiscordBot({ pool });
await restoreAiBots(pool);
await heartbeat();
interval = setInterval(() => void heartbeat(), 10_000);
console.info('Diskoko bot worker started');
