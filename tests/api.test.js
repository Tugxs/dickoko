import test from 'node:test';
import assert from 'node:assert/strict';
import { mountWorkspace } from '../lib/workspace-api.js';
function setup({ locked = true, confirmed = true, authorized = true } = {}) {
  const handlers = new Map(); const calls = []; const writes = [];
  const app = Object.fromEntries(['get', 'post', 'put'].map(method => [method, (path, ...fns) => handlers.set(`${method} ${path}`, fns.at(-1))]));
  const plan = { id: '7', user_id: 1, guild_id: 'g', status: 'failed', plan: { operations: [{ operation_key: 'cat', resource_type: 'category', name: 'Group' }, { operation_key: 'room', resource_type: 'channel', parent_key: 'cat', name: 'new-room' }] } };
  const operations = [{ id: '1', operation_key: 'cat', resource_type: 'category', status: 'succeeded', resource_id: 'category-id', result: {} }, { id: '2', operation_key: 'room', resource_type: 'channel', status: 'failed', result: { message: 'old Discord error' } }];
  const pool = {
    query: async (sql, params) => { writes.push({ sql, params }); if (sql.startsWith('SELECT * FROM change_sets')) return { rows: [plan] }; if (sql.startsWith('SELECT * FROM change_operations')) return { rows: operations }; return { rows: [], rowCount: 1 }; },
    connect: async () => ({ query: async sql => { writes.push({ sql }); return { rows: [{ locked }] }; }, release() {} }),
  };
  mountWorkspace(app, { pool, requireUser: () => {}, authorizedGuild: async () => authorized ? { id: 'g' } : null, requirePlanCapacity: async () => {}, audit: async () => {}, templates: {}, makeTemplatePlan: () => {}, botStatus: () => ({}), discordBotFetch: async (url, options) => {
    calls.push({ url, options });
    if (options) return { ok: true, data: { id: 'new-id', ...JSON.parse(options.body) } };
    return { ok: true, data: url.endsWith('/channels') ? [{ id: 'category-id', type: 4, name: 'Group' }] : [] };
  } });
  const req = { params: { id: '7' }, user: { id: 1 }, body: { confirmed, guildId: 'g' } };
  const result = { body: null, error: null }; const res = { json: body => { result.body = body; } };
  return { run: async () => handlers.get('post /api/change-sets/:id/apply')(req, res, error => { result.error = error; }), calls, writes, result };
}
test('retry preserves the completed parent and original failed operation payload', async () => {
  const task = setup(); await task.run(); assert.equal(task.result.error, null); const mutations = task.calls.filter(call => call.options);
  assert.equal(mutations.length, 1); assert.deepEqual(JSON.parse(mutations[0].options.body), { name: 'new-room', type: 0, parent_id: 'category-id' }); assert.equal(task.result.body.status, 'succeeded');
});
test('a locked guild cannot run a concurrent plan or mark the other job failed', async () => {
  const task = setup({ locked: false }); await task.run(); assert.equal(task.result.error.status, 409); assert.equal(task.calls.length, 0); assert.equal(task.writes.filter(item => item.sql.startsWith('UPDATE')).length, 0);
});
test('apply requires explicit confirmation and matching guild context', async () => {
  const task = setup({ confirmed: false }); await task.run(); assert.equal(task.result.error.status, 400); assert.equal(task.calls.length, 0);
});
test('revoked management access prevents any Discord write', async () => {
  const task = setup({ authorized: false }); await task.run(); assert.equal(task.result.error.status, 403); assert.equal(task.calls.length, 0);
});
