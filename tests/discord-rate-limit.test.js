import test from 'node:test';
import assert from 'node:assert/strict';
import { discordRetryAfterMs } from '../lib/discord-rate-limit.js';

test('Discord rate limit body controls the retry delay', () => {
  assert.equal(discordRetryAfterMs({ retry_after: 582 }, null), 582_000);
  assert.equal(discordRetryAfterMs({ retry_after: 0.5 }, null), 1_000);
  assert.equal(discordRetryAfterMs({ retry_after: 99999 }, null), 3_600_000);
});

test('rate limit header and safe fallback work without a JSON body', () => {
  assert.equal(discordRetryAfterMs(null, { get: () => '12' }), 12_000);
  assert.equal(discordRetryAfterMs(null, { get: () => null }), 30_000);
});
