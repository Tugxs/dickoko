import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDownloadFile, migrateDownloadCards, mountDownloadCards } from '../lib/download-cards.js';
import { migrateInteractiveSystems } from '../lib/interactive-systems.js';

test('download file validation enforces size and actual file type', () => {
  const file = decodeDownloadFile({ name: 'guide.pdf', mime: 'application/pdf', base64: Buffer.from('%PDF-1.7\nhello').toString('base64') });
  assert.equal(file.name, 'guide.pdf');
  assert.throws(() => decodeDownloadFile({ name: 'fake.pdf', mime: 'application/pdf', base64: Buffer.from('not a pdf').toString('base64') }));
  assert.throws(() => decodeDownloadFile({ name: 'program.exe', mime: 'application/octet-stream', base64: 'YWJj' }));
});

test('published Discord systems survive deleting their AI conversations', async () => {
  const queries = [];
  const pool = { query: async sql => { queries.push(sql); return { rows: [] }; } };
  await migrateInteractiveSystems(pool); await migrateDownloadCards(pool);
  const sql = queries.join('\n');
  for (const table of ['diskoko_giveaways', 'diskoko_ticket_panels', 'diskoko_polls']) assert.match(sql, new RegExp(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_request_id_fkey`));
  assert.match(sql, /CREATE TABLE IF NOT EXISTS diskoko_download_cards/);
  assert.doesNotMatch(sql.match(/CREATE TABLE IF NOT EXISTS diskoko_download_cards[\s\S]*?\);/)?.[0] || '', /ON DELETE CASCADE/);
});

test('download button fetches a fresh signed URL from its Discord message', async () => {
  const routes = new Map();
  const app = { get: (path, handler) => routes.set(path, handler), post: () => {} };
  const pool = { query: async () => ({ rows: [{ storage_channel_id: 'storage', storage_message_id: 'message', attachment_id: 'attachment' }] }) };
  const calls = [];
  mountDownloadCards(app, { pool, requireUser: () => {}, requireWriteAccess: () => {}, authorizedGuild: () => {}, baseUrl: 'https://diskoko.com', discordBotFetch: async path => { calls.push(path); return { ok: true, data: { attachments: [{ id: 'attachment', url: 'https://cdn.discordapp.com/attachments/123/file.pdf?ex=new-signature' }] } }; } });
  const res = { statusCode: 200, set() { return this; }, redirect(code, url) { this.statusCode = code; this.url = url; return this; }, status(code) { this.statusCode = code; return this; }, end() { return this; } };
  await routes.get('/api/downloads/:id')({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } }, res, error => { throw error; });
  assert.deepEqual(calls, ['/channels/storage/messages/message']);
  assert.equal(res.statusCode, 302);
  assert.match(res.url, /ex=new-signature/);
});
