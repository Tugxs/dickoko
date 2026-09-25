import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordRequestGate, discordRetryAfterMs } from '../lib/discord-rate-limit.js';

test('Discord rate limit body controls the retry delay', () => {
  assert.equal(discordRetryAfterMs({ retry_after: 582 }, null), 582_000);
  assert.equal(discordRetryAfterMs({ retry_after: 0.5 }, null), 1_000);
  assert.equal(discordRetryAfterMs({ retry_after: 99999 }, null), 99_999_000);
});

test('simultaneous requests for one bot are bounded by the gate concurrency', async () => {
  let active = 0;
  let peak = 0;
  const gate = createDiscordRequestGate({ requestsPerSecond: 1_000, globalRequestsPerSecond: 1_000, concurrency: 2, request: async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return Response.json({ ok: true });
  } });
  const responses = await Promise.all(Array.from({ length: 8 }, () => gate('bot-a', 'POST /channels/1/messages', 'https://example.test', {})));
  assert.equal(peak, 2);
  assert.ok(responses.every(response => response.ok));
});

test('a Discord 429 prevents another request to that route before retry-after', async () => {
  let calls = 0;
  const gate = createDiscordRequestGate({ requestsPerSecond: 1_000, maxWaitMs: 100, request: async () => {
    calls++;
    return new Response(JSON.stringify({ retry_after: 60 }), { status: 429, headers: { 'content-type': 'application/json' } });
  } });
  const first = await gate('bot-a', 'POST /channels/1/messages', 'https://example.test', {});
  const second = await gate('bot-a', 'POST /channels/1/messages', 'https://example.test', {});
  assert.equal(first.status, 429);
  assert.equal(second.status, 429);
  assert.equal(calls, 1);
});

test('rate limit header and safe fallback work without a JSON body', () => {
  assert.equal(discordRetryAfterMs(null, { get: () => '12' }), 12_000);
  assert.equal(discordRetryAfterMs(null, { get: () => null }), 30_000);
});

test('different customer bots share a conservative host dispatch pace', async () => {
  const started = [];
  const gate = createDiscordRequestGate({ requestsPerSecond: 1_000, globalRequestsPerSecond: 20, request: async () => {
    started.push(Date.now());
    return Response.json({ ok: true });
  } });
  await Promise.all(['one', 'two', 'three'].map(bot => gate(bot, 'POST /channels/1/messages', 'https://example.test', {})));
  assert.equal(started.length, 3);
  assert.ok(started[2] - started[0] >= 80);
});

test('repeated permission failures are stopped before another Discord call', async () => {
  let calls = 0;
  const gate = createDiscordRequestGate({ requestsPerSecond: 1_000, globalRequestsPerSecond: 1_000, request: async () => { calls++; return new Response('{}', { status: 403 }); } });
  for (let index = 0; index < 4; index++) await gate('bot', 'POST /channels/1/messages', 'https://example.test', {});
  assert.equal(calls, 3);
});

test('repeated malformed requests are also stopped at the site', async () => {
  let calls = 0;
  const gate = createDiscordRequestGate({ requestsPerSecond: 1_000, globalRequestsPerSecond: 1_000, request: async () => { calls++; return new Response('{}', { status: 400 }); } });
  const responses = [];
  for (let index = 0; index < 4; index++) responses.push(await gate('bot', 'POST /channels/1/messages', 'https://example.test', {}));
  assert.equal(calls, 3);
  assert.equal(responses[3].status, 403);
});
