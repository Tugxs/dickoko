import test from 'node:test';
import assert from 'node:assert/strict';
import { READY_TEMPLATES, normalizeReadyDefinition, readyTemplateDiff } from '../lib/ready-templates.js';

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
