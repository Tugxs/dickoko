import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiProposal } from '../lib/local-ai.js';

test('AI proposal only permits reviewed creation and bounded messages', () => {
  const result = normalizeAiProposal({
    operations: [
      { resource_type: 'role', name: 'New Member', permissions: '8', action: 'delete' },
      { resource_type: 'role', name: 'New Member' },
      { resource_type: 'role', name: 'Admin' },
      { resource_type: 'channel', name: 'general', type: 0 },
      { resource_type: 'ban', name: 'everyone' },
    ],
    message: { channel: 'general', content: 'مرحبًا في مجتمعنا!' },
  });
  assert.deepEqual(result, {
    operations: [
      { resource_type: 'role', action: 'create', name: 'New Member' },
      { resource_type: 'channel', action: 'create', name: 'general', type: 0 },
    ],
    message: { channel: 'general', content: 'مرحبًا في مجتمعنا!' },
  });
});
