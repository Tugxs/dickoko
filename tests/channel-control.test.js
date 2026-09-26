import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelControlPatch, mountChannelControl, validateChannelControl } from '../lib/channel-control.js';

const guildId = '123456789012345678';
const roleId = '123456789012345679';
const channelId = '123456789012345680';

test('channel control validates mode, selected roles, and Discord field limits', () => {
  const base = { channelId, mode: 'roles', roleIds: [roleId], name: 'القوانين', topic: 'اقرأ قبل الكتابة', slowmode: 10, nsfw: false };
  assert.equal(validateChannelControl(base), null);
  assert.match(validateChannelControl({ ...base, roleIds: [] }), /رتبة/);
  assert.match(validateChannelControl({ ...base, slowmode: 21601 }), /21600/);
  assert.match(validateChannelControl({ ...base, topic: 'x'.repeat(1025) }), /1024/);
});

test('role-only writing preserves unrelated bits while removing direct member write exceptions', () => {
  const memberId = '123456789012345681';
  const channel = { permission_overwrites: [
    { id: guildId, type: 0, allow: '1024', deny: '0' },
    { id: roleId, type: 0, allow: '0', deny: '2048' },
    { id: memberId, type: 1, allow: '2048', deny: '0' },
  ] };
  const patch = buildChannelControlPatch(channel, guildId, { mode: 'roles', roleIds: [roleId], name: 'القوانين', topic: 'وصف', slowmode: 5, nsfw: false });
  assert.deepEqual(patch.permission_overwrites, [
    { id: guildId, type: 0, allow: '1024', deny: '2048' },
    { id: roleId, type: 0, allow: '2048', deny: '0' },
    { id: memberId, type: 1, allow: '0', deny: '0' },
  ]);
  assert.equal(patch.rate_limit_per_user, 5);
});

test('channel control checks the live channel and roles before one reviewed edit', async () => {
  let handle, result; const calls = [];
  const item = { id: 'request', guild_id: guildId, proposal: { interactive: { kind: 'channel_control' } } };
  const client = { async query(sql) { if (sql.startsWith('SELECT id,guild_id')) return { rows: [item] }; return { rows: [] }; }, release() {} };
  const app = { post(path, ...handlers) { if (path.endsWith('/control-channel')) handle = handlers.at(-1); } };
  const discordBotFetch = async (path, options) => {
    calls.push({ path, options });
    if (path === `/channels/${channelId}` && !options) return { ok: true, data: { id: channelId, guild_id: guildId, type: 0, permission_overwrites: [] } };
    if (path.endsWith('/roles')) return { ok: true, data: [{ id: roleId, managed: false }] };
    return { ok: true, data: { id: channelId } };
  };
  mountChannelControl(app, { pool: { connect: async () => client }, requireUser() {}, requireWriteAccess() {}, authorizedGuild: async () => true, discordBotFetch, requirePlanCapacity: async () => {} });
  const res = { status(code) { this.code = code; return this; }, json(value) { result = value; } };
  await handle({ params: { id: 'request' }, user: { id: 'user' }, body: { confirmed: true, channelId, mode: 'roles', roleIds: [roleId], name: 'قوانين', topic: '', slowmode: 0, nsfw: false } }, res, error => { throw error; });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.method, 'PATCH');
  assert.equal(JSON.parse(calls[2].options.body).permission_overwrites.length, 2);
});
