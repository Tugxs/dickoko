import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDiscordWrite } from '../lib/discord-preflight.js';

test('rejects malformed and oversized template messages before Discord', () => {
  const path = '/channels/123456789012345678/messages';
  assert.match(validateDiscordWrite(path, { method: 'POST', body: '{oops' }), /قراءة/);
  assert.match(validateDiscordWrite(path, { method: 'POST', body: JSON.stringify({ content: 'x'.repeat(2001) }) }), /2000/);
  assert.match(validateDiscordWrite(path, { method: 'POST', body: JSON.stringify({ embeds: [{ description: 'x'.repeat(4097) }] }) }), /حدود/);
  assert.equal(validateDiscordWrite(path, { method: 'POST', body: JSON.stringify({ embeds: [{ title: 'ترحيب', description: 'أهلًا' }] }) }), null);
});

test('rejects invalid channel and role names locally', () => {
  assert.match(validateDiscordWrite('/guilds/123456789012345678/channels', { method: 'POST', body: JSON.stringify({ name: '' }) }), /القناة/);
  assert.match(validateDiscordWrite('/guilds/123456789012345678/roles', { method: 'POST', body: JSON.stringify({ name: 'a'.repeat(101) }) }), /الرتبة/);
});
