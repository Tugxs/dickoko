import test from 'node:test';
import assert from 'node:assert/strict';
import { manageable, normalizeOperations, resolveExisting, checkExistingAccess, checkConflict, operationBody, connectionState, normalizeSchedule } from '../lib/workspace-domain.js';
const snapshot = { guildId: 'guild', channels: [{ id: 'category', name: 'Welcome', type: 4 }, { id: 'one', name: 'chat', type: 0, parent_id: 'category' }, { id: 'two', name: 'chat', type: 0, parent_id: null }], roles: [{ id: 'guild', name: '@everyone' }, { id: 'managed', name: 'Bot', managed: true }, { id: 'role', name: 'Member', color: 123 }] };
test('owner, manager and administrator can manage; ordinary members cannot', () => {
  assert.equal(manageable({ owner: true }), true); assert.equal(manageable({ permissions: '8' }), true); assert.equal(manageable({ permissions: '32' }), true); assert.equal(manageable({ permissions: '1024' }), false);
});
test('upstream errors are not interpreted as uninstalled bot', () => {
  assert.equal(connectionState({ ok: false, status: 429 }), 'unavailable'); assert.equal(connectionState({ ok: false, status: 500 }), 'unavailable'); assert.equal(connectionState({ ok: false, status: 403 }), 'permissions_insufficient'); assert.equal(connectionState({ ok: false, status: 404 }), 'install_required');
});
test('reject cross-guild resources and unknown parent category', () => {
  assert.throws(() => normalizeOperations([{ action: 'update', resource_type: 'channel', name: 'new', resource_id: 'other' }], snapshot));
  assert.throws(() => normalizeOperations([{ resource_type: 'channel', name: 'new', parent_id: 'other' }], snapshot));
});
test('protected roles cannot be edited', () => {
  for (const resource_id of ['guild', 'managed']) assert.throws(() => normalizeOperations([{ action: 'update', resource_type: 'role', resource_id, name: 'new' }], snapshot));
});
test('only safe supported changes reach Discord', () => {
  const [op] = normalizeOperations([{ resource_type: 'role', name: 'Member', color: 0, permissions: '8', mentionable: true }], snapshot);
  assert.deepEqual(operationBody(op), { name: 'Member', mentionable: false, color: 0 });
  assert.throws(() => normalizeOperations([{ resource_type: 'channel', action: 'delete', name: 'chat' }], snapshot));
});
test('duplicate edits must be consolidated', () => {
  assert.throws(() => normalizeOperations(Array(2).fill({ resource_type: 'channel', action: 'update', resource_id: 'one', name: 'updated' }), snapshot));
});
test('matching channels uses exact category, including uncategorized channels', () => {
  const op = { resource_type: 'channel', name: 'chat' };
  assert.equal(resolveExisting(op, snapshot, 'category').id, 'one'); assert.equal(resolveExisting(op, snapshot).id, 'two');
});
test('voice templates create voice channels', () => {
  assert.equal(operationBody({ resource_type: 'channel', name: 'Lounge', type: 2 }).type, 2);
});
test('AI can build categories and place channels inside them in one reviewed plan', () => {
  const [category, channel] = normalizeOperations([{ resource_type: 'category', name: 'الدعم' }, { resource_type: 'channel', name: 'فتح-تذكرة', parent_name: 'الدعم' }], snapshot);
  assert.equal(channel.parent_key, category.operation_key);
  assert.equal(operationBody(channel, 'new-category').parent_id, 'new-category');
  const [existing] = normalizeOperations([{ resource_type: 'channel', name: 'hello', parent_name: 'Welcome' }], snapshot);
  assert.equal(existing.parent_id, 'category');
  assert.throws(() => normalizeOperations([{ resource_type: 'channel', name: 'bad', parent_name: 'غير موجود' }], snapshot));
});
test('new channel access uses narrow reviewed presets and never grants administrator', () => {
  const [readOnly] = normalizeOperations([{ resource_type: 'channel', name: 'announcements', access: 'read_only' }], snapshot);
  const body = operationBody(readOnly);
  assert.equal(body.permission_overwrites[0].id, 'guild');
  assert.equal(body.permission_overwrites[0].deny, '2048');
  assert.throws(() => checkExistingAccess(readOnly, { name: 'announcements', permission_overwrites: [] }));
  assert.doesNotThrow(() => checkExistingAccess(readOnly, { permission_overwrites: [{ id: 'guild', deny: '2048' }] }));
  const [staff] = normalizeOperations([{ resource_type: 'channel', name: 'staff', access: 'staff_only', staff_role_id: 'role' }], snapshot);
  assert.equal(operationBody(staff).permission_overwrites[1].id, 'role');
  assert.throws(() => normalizeOperations([{ resource_type: 'channel', name: 'staff', access: 'staff_only', staff_role_id: 'other' }], snapshot));
  assert.throws(() => normalizeOperations([{ resource_type: 'channel', name: 'staff', access: 'administrator' }], snapshot));
});
test('channel topics, forums and ordering are normalized for reviewed execution', () => {
  const [created] = normalizeOperations([{ resource_type: 'channel', name: 'المنتدى', type: 15, topic: 'ناقش أفكار المجتمع', position: 3 }], snapshot);
  assert.deepEqual(operationBody(created), { name: 'المنتدى', type: 15, topic: 'ناقش أفكار المجتمع' });
  const [updated] = normalizeOperations([{ action: 'update', resource_type: 'channel', resource_id: 'one', name: 'chat', topic: 'وصف جديد', position: 2 }], snapshot);
  assert.equal(updated.position, 2); assert.equal(updated.before.position, undefined); assert.equal(operationBody(updated).topic, 'وصف جديد');
  assert.throws(() => normalizeOperations([{ resource_type: 'channel', name: 'bad', type: 15, position: 999 }], snapshot));
});
test('stale changes are rejected but an already applied edit can be resumed', () => {
  const op = { action: 'update', resource_type: 'channel', name: 'after', before: { name: 'before' } };
  assert.throws(() => checkConflict(op, { name: 'someone-else' })); assert.doesNotThrow(() => checkConflict(op, { name: 'after' }));
});
test('invalid schedule time, size and timezone are rejected', () => {
  const valid = { content: 'Hello', run_at: '2030-01-01T12:00:00Z', repeat: 'once', timezone: 'Asia/Riyadh', channel_id: 'one' };
  assert.equal(normalizeSchedule(valid, 0).channel_id, 'one');
  assert.throws(() => normalizeSchedule({ ...valid, content: 'x'.repeat(2001) }, 0));
  assert.throws(() => normalizeSchedule({ ...valid, timezone: 'bad-zone' }, 0));
  assert.throws(() => normalizeSchedule({ ...valid, run_at: 'invalid' }, 0));
});

