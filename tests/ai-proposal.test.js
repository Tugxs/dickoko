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

test('interactive proposals accept bounded giveaways and ticket panels', () => {
  assert.deepEqual(normalizeAiProposal({ interactive: { kind: 'giveaway', prize: 'اشتراك شهر', channel: '#فعاليات', durationMinutes: 60, winnerCount: 2 } }), { operations: [], message: null, interactive: { kind: 'giveaway', prize: 'اشتراك شهر', channel: 'فعاليات', durationMinutes: 60, winnerCount: 2 } });
  assert.equal(normalizeAiProposal({ interactive: { kind: 'giveaway', prize: 'جائزة', channel: 'عام', durationMinutes: 0, winnerCount: 2 } }), null);
  assert.deepEqual(normalizeAiProposal({ interactive: { kind: 'tickets', title: 'الدعم', description: 'افتح تذكرة للمساعدة', channel: 'الدعم' } }), { operations: [], message: null, interactive: { kind: 'tickets', title: 'الدعم', description: 'افتح تذكرة للمساعدة', channel: 'الدعم' } });
});

