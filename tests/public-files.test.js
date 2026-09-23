import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicStaticPath } from '../lib/public-files.js';

test('site serves its pages and assets without exposing source or internal documents', () => {
  for (const path of ['/', '/index.html', '/plans', '/account.html', '/studio', '/workspace.js', '/ai-library-catalog.js', '/assets/diskoko-logo.png']) assert.equal(isPublicStaticPath(path), true, path);
  for (const path of ['/server.js', '/discord-bot.js', '/lib/local-ai.js', '/scripts/local-ai-worker.mjs', '/tests/api.test.js', '/docs/api-contracts-ar.md', '/.env', '/admin-console', '/admin-console.html', '/admin-login.html', '/admin-console.20260921.js']) assert.equal(isPublicStaticPath(path), false, path);
});

