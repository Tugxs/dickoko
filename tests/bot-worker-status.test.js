import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedBotMetadata } from '../lib/ai-bot-connections.js';

test('website reads a fresh customer bot worker heartbeat', async () => {
  const previous = process.env.BOT_GATEWAY_MODE;
  process.env.BOT_GATEWAY_MODE = 'external';
  const pool = { query: async () => ({ rows: [{ bot_user_id: '123', bot_name: 'Test', updated_at: new Date(), retry_at: null, member_joins: true, gateway_seen_at: new Date() }] }) };
  try {
    const status = await connectedBotMetadata(pool, '12345678901234567');
    assert.equal(status.online, true);
    assert.equal(status.memberJoins, true);
  } finally { if (previous === undefined) delete process.env.BOT_GATEWAY_MODE; else process.env.BOT_GATEWAY_MODE = previous; }
});

test('website marks an expired worker heartbeat offline', async () => {
  const previous = process.env.BOT_GATEWAY_MODE;
  process.env.BOT_GATEWAY_MODE = 'external';
  const pool = { query: async () => ({ rows: [{ bot_user_id: '123', bot_name: 'Test', updated_at: new Date(), retry_at: null, member_joins: true, gateway_seen_at: new Date(Date.now() - 60_000) }] }) };
  try { assert.equal((await connectedBotMetadata(pool, '12345678901234567')).online, false); }
  finally { if (previous === undefined) delete process.env.BOT_GATEWAY_MODE; else process.env.BOT_GATEWAY_MODE = previous; }
});
