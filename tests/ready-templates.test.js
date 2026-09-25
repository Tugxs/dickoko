import test from 'node:test';
import assert from 'node:assert/strict';
import { READY_TEMPLATES, normalizeReadyDefinition, readyTemplateDiff, readyUsageUnits } from '../lib/ready-templates.js';

test('ready template usage counts categories, channels and enabled systems without counting roles', () => {
  const arabic = normalizeReadyDefinition(READY_TEMPLATES[0].definition);
  assert.equal(arabic.categories.length, 7);
  assert.equal(arabic.categories.flatMap(group => group.channels).length, 23);
  assert.equal(readyUsageUnits(arabic), 33);
  const extraRole = structuredClone(arabic); extraRole.roles.push({ key: 'extra-role', name: 'Extra', preset: 'member', color: 0 });
  assert.equal(readyUsageUnits(extraRole), 33);
  const streamer = normalizeReadyDefinition(READY_TEMPLATES[1].definition);
  assert.equal(readyUsageUnits(streamer), 44);
});

test('welcome composite and support artwork are retained only with valid settings', () => {
  const definition = structuredClone(READY_TEMPLATES[0].definition);
  definition.features.welcome.composite = true;
  definition.features.welcome.avatarPosition = 'center';
  assert.throws(() => normalizeReadyDefinition(definition), /ارفع تصميم الترحيب/);
  definition.features.welcome.composite = false;
  definition.features.ticket.color = '#12aabb';
  definition.features.ticket.buttonLabel = 'اطلب المساعدة';
  assert.equal(normalizeReadyDefinition(definition).features.ticket.buttonLabel, 'اطلب المساعدة');
  definition.features.ticket.imageStyle = 'design';
  assert.throws(() => normalizeReadyDefinition(definition), /ادمج شعار الدعم/);
});

test('the two catalog templates have valid editable structure and no administrator grants', () => {
  assert.equal(READY_TEMPLATES.length, 2);
  for (const template of READY_TEMPLATES) {
    const definition = normalizeReadyDefinition(template.definition);
    assert.ok(definition.categories.length > 0);
    assert.ok(definition.categories.flatMap(group => group.channels).length > 0);
    assert.ok(definition.roles.every(role => (BigInt(role.permissions) & 8n) === 0n));
  }
  const streamer = normalizeReadyDefinition(READY_TEMPLATES[1].definition);
  assert.equal(streamer.categories.flatMap(group => group.channels).length, 33);
});

test('replacement removes every old channel and unmanaged role, while installation keeps them', () => {
  const definition = normalizeReadyDefinition(READY_TEMPLATES[0].definition);
  const snapshot = { guildId: 'guild', channels: [
    { id: 'a', name: 'قديم', type: 4 },
    { id: 'b', name: 'رسائل-قديمة', type: 0, parent_id: 'a' },
  ], roles: [
    { id: 'guild', name: '@everyone', permissions: '0' },
    { id: 'r1', name: 'قديم', managed: false, position: 1, permissions: '0' },
    { id: 'r2', name: 'بوت', managed: true, position: 2, permissions: '0' },
  ] };
  const install = readyTemplateDiff(definition, snapshot, 'add');
  assert.equal(install.deletions.channels.length, 0);
  assert.equal(install.deletions.roles.length, 0);
  const replacement = readyTemplateDiff(definition, snapshot, 'replace');
  assert.deepEqual(replacement.deletions.channels.map(row => row.id), ['a', 'b']);
  assert.deepEqual(replacement.deletions.roles.map(row => row.id), ['r1']);
  assert.ok(replacement.createOrReuse.every(row => row.action === 'create'));
});

test('installation rejects a same-name channel that would silently retain different access', () => {
  const definition = normalizeReadyDefinition(READY_TEMPLATES[0].definition);
  const category = definition.categories[0], channel = category.channels[0];
  const snapshot = { guildId: 'guild', channels: [
    { id: 'cat', name: category.name, type: 4 },
    { id: 'channel', name: channel.name, type: 0, parent_id: 'cat', permission_overwrites: [] },
  ], roles: [] };
  assert.throws(() => readyTemplateDiff(definition, snapshot, 'add'), /صلاحياتها مختلفة/);
  assert.doesNotThrow(() => readyTemplateDiff(definition, snapshot, 'replace'));
});

test('private channels cannot refer to removed roles', () => {
  const definition = structuredClone(READY_TEMPLATES[0].definition);
  definition.roles = definition.roles.filter(role => role.key !== 'vip');
  assert.throws(() => normalizeReadyDefinition(definition), /رتبة موجودة/);
});
test('welcome artwork is checked before a review can reach Discord', () => {
  const definition = structuredClone(READY_TEMPLATES[0].definition);
  definition.features.welcome.banner = { mime: 'image/gif', base64: Buffer.from('not a gif').toString('base64') };
  assert.throws(() => normalizeReadyDefinition(definition), /تعذر قراءة الصورة/);
  definition.features.welcome.banner = { mime: 'image/gif', base64: Buffer.from('GIF89a').toString('base64') };
  assert.equal(normalizeReadyDefinition(definition).features.welcome.banner.mime, 'image/gif');
});
test('installation exposes an existing Administrator role instead of claiming to change it', () => {
  const definition = normalizeReadyDefinition(READY_TEMPLATES[0].definition);
  const existing = readyTemplateDiff(definition, { guildId: 'guild', channels: [], roles: [{ id: 'r1', name: definition.roles[0].name, permissions: '8', color: 0, managed: false }] }, 'add');
  const role = existing.createOrReuse.find(item => item.kind === 'role' && item.name === definition.roles[0].name);
  assert.equal(role.action, 'reuse');
  assert.equal(role.hasAdministrator, true);
});
test('multiple log rules accept shared destinations and count one unit per rule', () => {
  const definition = structuredClone(READY_TEMPLATES[0].definition);
  const channels = definition.categories.flatMap(group => group.channels).filter(channel => channel.type === 0);
  definition.features.logs = { enabled: true, mode: 'routed', events: ['message_create', 'message_delete'], routes: [
    { key: 'chat-logs', sourceKeys: [channels[0].key, channels[1].key], targetKey: channels[2].key },
    { key: 'other-logs', sourceKeys: [channels[3].key], targetKey: channels[2].key },
  ] };
  const normalized = normalizeReadyDefinition(definition);
  assert.equal(normalized.features.logs.routes.length, 2);
  assert.equal(readyUsageUnits(normalized), 34);
  definition.features.logs.routes[1].sourceKeys = [channels[2].key];
  assert.throws(() => normalizeReadyDefinition(definition), /مصادر اللوق/);
});
