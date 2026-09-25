import crypto from 'node:crypto';
import { createDiscordRequestGate } from './discord-rate-limit.js';

const API = 'https://discord.com/api/v10';
const gate = createDiscordRequestGate({ requestsPerSecond: 7, concurrency: 1, globalRequestsPerSecond: 20, globalConcurrency: 4, maxWaitMs: 25_000 });
const listeners = new Map();
let listenerClient;
let listenerStarting;

export async function startDiscordJobListener(pool) {
  if (listenerClient || listenerStarting) return listenerStarting;
  listenerStarting = (async () => {
    const client = await pool.connect();
    try {
      await client.query('LISTEN discord_jobs_done');
      client.on('notification', message => {
        const pending = listeners.get(message.payload);
        if (pending) for (const wake of pending) wake();
      });
      client.on('error', error => {
        console.error('Discord queue listener disconnected', error.message);
        if (listenerClient === client) listenerClient = null;
        client.release(true);
        setTimeout(() => void startDiscordJobListener(pool).catch(err => console.error('Discord queue listener reconnect failed', err.message)), 1_000).unref();
      });
      listenerClient = client;
    } catch (error) { client.release(true); throw error; }
  })().finally(() => { listenerStarting = null; });
  return listenerStarting;
}

function waitForJob(id, ms) {
  return new Promise(resolve => {
    const callbacks = listeners.get(id) || new Set();
    const wake = () => { clearTimeout(timer); callbacks.delete(wake); if (!callbacks.size) listeners.delete(id); resolve(); };
    callbacks.add(wake);
    listeners.set(id, callbacks);
    const timer = setTimeout(wake, ms);
  });
}

function key() { return crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || '').digest(); }
function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  return [iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()].map(part => part.toString('base64url')).join('.');
}
function open(value) {
  const [iv, body, final, tag] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.update(final), decipher.final()]).toString();
}

export async function migrateDiscordJobQueue(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS discord_job_lanes (
    bot_key TEXT PRIMARY KEY, last_served_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01'
  );
  CREATE TABLE IF NOT EXISTS discord_jobs (
    id UUID PRIMARY KEY, bot_key TEXT NOT NULL REFERENCES discord_job_lanes(bot_key),
    route TEXT NOT NULL, pathname TEXT NOT NULL, method TEXT NOT NULL,
    authorization TEXT NOT NULL, headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    body JSONB, status TEXT NOT NULL DEFAULT 'pending',
    response_status INTEGER, response_body TEXT, response_headers JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS discord_jobs_pending_idx ON discord_jobs(created_at) WHERE status='pending';
  CREATE INDEX IF NOT EXISTS discord_jobs_active_bot_idx ON discord_jobs(bot_key) WHERE status IN ('pending','running');
  CREATE UNIQUE INDEX IF NOT EXISTS discord_jobs_running_bot_idx ON discord_jobs(bot_key) WHERE status='running';`);
}

async function encodeBody(body) {
  if (body == null) return null;
  if (body instanceof FormData) {
    const parts = [];
    for (const [name, value] of body) {
      if (typeof value === 'string') parts.push({ name, value });
      else parts.push({ name, filename: value.name, type: value.type, base64: Buffer.from(await value.arrayBuffer()).toString('base64') });
    }
    return { type: 'form', parts };
  }
  return { type: 'text', value: String(body) };
}

function decodeBody(body) {
  if (!body) return undefined;
  if (body.type === 'text') return body.value;
  const form = new FormData();
  for (const part of body.parts || []) {
    if (part.base64 !== undefined) form.append(part.name, new Blob([Buffer.from(part.base64, 'base64')], { type: part.type || 'application/octet-stream' }), part.filename || 'file');
    else form.append(part.name, part.value);
  }
  return form;
}

export async function enqueueDiscordJob(pool, { botKey, route, pathname, authorization, options = {} }) {
  const body = await encodeBody(options.body);
  if (body && Buffer.byteLength(JSON.stringify(body)) > 36_000_000) return { ok: false, status: 413, data: { message: 'حجم الملفات أكبر من المسموح لهذا الطلب.' }, headers: new Headers() };
  const counts = (await pool.query("SELECT count(*)::int AS total,count(*) FILTER (WHERE bot_key=$1)::int AS bot FROM discord_jobs WHERE status IN ('pending','running')", [botKey])).rows[0];
  if (counts.total >= 800 || counts.bot >= 80) return { ok: false, status: 503, data: { message: 'طلبات البوت مشغولة الآن. انتظر قليلًا ثم حاول مجددًا.' }, headers: new Headers({ 'retry-after': '10' }) };
  const id = crypto.randomUUID();
  const headers = { ...options.headers };
  delete headers.Authorization;
  delete headers.authorization;
  await pool.query('INSERT INTO discord_job_lanes(bot_key) VALUES($1) ON CONFLICT DO NOTHING', [botKey]);
  await pool.query('INSERT INTO discord_jobs(id,bot_key,route,pathname,method,authorization,headers,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, botKey, route, pathname, String(options.method || 'GET').toUpperCase(), seal(authorization), headers, body ? JSON.stringify(body) : null]);
  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    const row = (await pool.query('SELECT status,response_status,response_body,response_headers FROM discord_jobs WHERE id=$1', [id])).rows[0];
    if (row?.status === 'done') return { ok: row.response_status >= 200 && row.response_status < 300, status: row.response_status, data: parseResponse(row.response_body), headers: new Headers(row.response_headers || {}) };
    if (row?.status === 'failed') return { ok: false, status: row.response_status || 503, data: { message: row.response_body || 'تعذر تنفيذ طلب Discord. تحقق من الحالة قبل إعادة المحاولة.' }, headers: new Headers() };
    await waitForJob(id, Math.min(2_000, Math.max(1, deadline - Date.now())));
  }
  const cancelled = await pool.query("UPDATE discord_jobs SET status='failed',response_status=503,response_body='انتظر الطلب طويلاً في الطابور ولم يُرسل إلى Discord.',completed_at=NOW() WHERE id=$1 AND status='pending'", [id]);
  return { ok: false, status: 503, data: { message: cancelled.rowCount ? 'الطابور مشغول حاليًا. لم يُرسل طلبك إلى Discord.' : 'بدأ تنفيذ الطلب ولم تصل نتيجته بعد. تحقق من القناة قبل إعادة المحاولة.', jobId: id }, headers: new Headers() };
}

function parseResponse(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }

export async function claimDiscordJob(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`SELECT j.* FROM discord_jobs j JOIN discord_job_lanes l ON l.bot_key=j.bot_key
      WHERE j.status='pending' AND NOT EXISTS (SELECT 1 FROM discord_jobs active WHERE active.bot_key=j.bot_key AND active.status='running')
      ORDER BY l.last_served_at,j.created_at LIMIT 1 FOR UPDATE OF j,l SKIP LOCKED`)).rows[0];
    if (!row) { await client.query('COMMIT'); return null; }
    await client.query("UPDATE discord_jobs SET status='running',started_at=NOW() WHERE id=$1", [row.id]);
    await client.query('UPDATE discord_job_lanes SET last_served_at=NOW() WHERE bot_key=$1', [row.bot_key]);
    await client.query('COMMIT');
    return row;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function executeDiscordJob(pool, job) {
  try {
    const body = decodeBody(job.body);
    const headers = { ...job.headers, Authorization: open(job.authorization) };
    if (body instanceof FormData) { delete headers['Content-Type']; delete headers['content-type']; }
    const response = await gate(job.bot_key, job.route, `${API}${job.pathname}`, { method: job.method, headers, body, signal: AbortSignal.timeout(25_000) });
    const text = await response.text();
    const responseHeaders = {};
    for (const name of ['retry-after', 'x-ratelimit-reset-after', 'x-ratelimit-scope']) if (response.headers.has(name)) responseHeaders[name] = response.headers.get(name);
    await pool.query("UPDATE discord_jobs SET status='done',response_status=$2,response_body=$3,response_headers=$4,completed_at=NOW() WHERE id=$1", [job.id, response.status, text, responseHeaders]);
    await pool.query("SELECT pg_notify('discord_jobs_done',$1)", [job.id]);
  } catch (error) {
    console.error('Discord queue execution failed', { jobId: job.id, message: error.message });
    await pool.query("UPDATE discord_jobs SET status='failed',response_status=503,response_body=$2,completed_at=NOW() WHERE id=$1", [job.id, 'انقطع الاتصال أثناء التنفيذ. تحقق من الحالة قبل إعادة المحاولة.']);
    await pool.query("SELECT pg_notify('discord_jobs_done',$1)", [job.id]);
  }
}

export async function recoverDiscordJobQueue(pool) {
  // Running jobs may have reached Discord before a deploy; never replay them.
  await pool.query("UPDATE discord_jobs SET status='failed',response_status=503,response_body='انقطع العامل أثناء التنفيذ. تحقق من النتيجة قبل إعادة المحاولة.',completed_at=NOW() WHERE status='running' AND started_at < NOW() - INTERVAL '90 seconds'");
  await pool.query("DELETE FROM discord_jobs WHERE status IN ('done','failed') AND completed_at < NOW() - INTERVAL '1 hour'");
}
