import pg from 'pg';
import { getDiscordBotStatus, startDiscordBot, stopDiscordBot } from './discord-bot.js';
import { migrateAiBotConnections, restoreAiBots, stopAllAiBots, syncAiBots } from './lib/ai-bot-connections.js';
import { claimDiscordJob, executeDiscordJob, migrateDiscordJobQueue, recoverDiscordJobQueue } from './lib/discord-job-queue.js';
import { migrateGuildActivityLogs } from './lib/guild-activity-logs.js';

const required = ['DATABASE_URL', 'ENCRYPTION_KEY', 'DISCORD_BOT_TOKEN'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing bot worker environment variables: ${missing.join(', ')}`);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
let stopping = false;
let running = false;
let interval;
let queueTimer;
const activeJobs = new Set();

async function pumpQueue() {
  if (stopping) return;
  try {
    while (activeJobs.size < 3) {
      const job = await claimDiscordJob(pool);
      if (!job) break;
      const task = executeDiscordJob(pool, job).catch(error => console.error('Discord queue task failed', error)).finally(() => activeJobs.delete(task));
      activeJobs.add(task);
    }
  } catch (error) { console.error('Discord queue poll failed', error); }
  finally { if (!stopping) queueTimer = setTimeout(() => void pumpQueue(), activeJobs.size ? 200 : 800); }
}

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
  clearTimeout(queueTimer);
  const timeout = setTimeout(() => process.exit(1), 25_000).unref();
  try {
    await Promise.allSettled([...activeJobs]);
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
await migrateDiscordJobQueue(pool);
await migrateGuildActivityLogs(pool);
await recoverDiscordJobQueue(pool);
await startDiscordBot({ pool });
await restoreAiBots(pool);
await heartbeat();
interval = setInterval(() => void heartbeat(), 10_000);
setInterval(() => void recoverDiscordJobQueue(pool).catch(error => console.error('Discord queue recovery failed', error.message)), 60_000).unref();
void pumpQueue();
console.info('Diskoko bot worker started');
