import assert from 'node:assert/strict';
import test from 'node:test';
import { createGatewayLoginGate } from '../lib/gateway-login-gate.js';

test('simultaneous bot startups receive spaced gateway login slots', async () => {
  const slot = createGatewayLoginGate({ minimumSpacingMs: 25 });
  const started = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    await slot();
    started.push(Date.now());
  }));
  for (let index = 1; index < started.length; index++) {
    assert.ok(started[index] - started[index - 1] >= 18);
  }
});

