import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_COMMANDS, BOT_COMMAND_KEYS, validBotCommandKeys } from '../lib/bot-catalog.js';

test('registered bot commands have one unique catalog entry', () => {
  assert.deepEqual(BOT_COMMAND_KEYS, ['help', 'ping', 'about']);
  assert.equal(new Set(BOT_COMMANDS.map(command => command.key)).size, BOT_COMMANDS.length);
  for (const command of BOT_COMMANDS) assert.ok(command.title && command.description && command.discordDescription);
});

test('settings discard unsupported commands while preserving valid order', () => {
  assert.deepEqual(validBotCommandKeys(['help', 'backup', 'ping', 'help']), ['help', 'ping']);
  assert.deepEqual(validBotCommandKeys(null), BOT_COMMAND_KEYS);
});
