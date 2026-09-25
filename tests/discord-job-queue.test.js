import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'test-only-queue-key';
const requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return new Response(JSON.stringify({ id: 'sent-message' }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const { enqueueDiscordJob, executeDiscordJob } = await import('../lib/discord-job-queue.js');

test('queued multipart request preserves files, encrypts bot token, and returns worker result', async () => {
  let inserted;
  const pool = { query: async (sql, args = []) => {
    if (sql.startsWith('SELECT count(')) return { rows: [{ total: 0, bot: 0 }] };
    if (sql.startsWith('INSERT INTO discord_jobs(')) { inserted = args; return { rows: [] }; }
    if (sql.startsWith('SELECT status,response_status')) return { rows: [{ status: 'done', response_status: 200, response_body: '{"id":"sent-message"}', response_headers: {} }] };
    return { rows: [] };
  } };
  const form = new FormData();
  form.append('payload_json', '{"content":"hello"}');
  form.append('files[0]', new Blob([Buffer.from('GIF89a')], { type: 'image/gif' }), 'design.gif');
  const result = await enqueueDiscordJob(pool, { botKey: 'bot-a', route: 'POST /channels/123/messages', pathname: '/channels/123/messages', authorization: 'Bot secret-test-token', options: { method: 'POST', body: form } });
  assert.equal(result.data.id, 'sent-message');
  assert.doesNotMatch(inserted[5], /secret-test-token/);
  assert.equal(JSON.parse(inserted[7]).parts[1].filename, 'design.gif');
  await executeDiscordJob(pool, { id: inserted[0], bot_key: 'bot-a', route: inserted[2], pathname: inserted[3], method: 'POST', authorization: inserted[5], headers: {}, body: JSON.parse(inserted[7]) });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Authorization, 'Bot secret-test-token');
  assert.equal((await requests[0].options.body.get('files[0]').arrayBuffer()).byteLength, 6);
});

test('full bot queue refuses a request before it reaches Discord', async () => {
  const pool = { query: async () => ({ rows: [{ total: 80, bot: 80 }] }) };
  const result = await enqueueDiscordJob(pool, { botKey: 'bot-a', route: 'GET /guilds/123', pathname: '/guilds/123', authorization: 'Bot token' });
  assert.equal(result.status, 503);
  assert.equal(requests.length, 1);
});
