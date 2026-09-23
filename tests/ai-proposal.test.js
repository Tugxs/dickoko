import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiProposal } from '../lib/local-ai.js';

test('AI proposal only permits reviewed creation and bounded messages', () => {
  const result = normalizeAiProposal({
    operations: [
      { resource_type: 'role', name: 'Do not create', permissions: '8', action: 'delete' },
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
  assert.equal(normalizeAiProposal({ message: { channel: 'الدعم', content: 'رسالة عامة' }, interactive: { kind: 'tickets', title: 'الدعم', description: 'افتح تذكرة للمساعدة', channel: 'الدعم' } }).message, null);
});

test('poll proposals require distinct bounded choices', () => {
  assert.deepEqual(normalizeAiProposal({ interactive: { kind: 'poll', question: 'متى نجتمع؟', channel: '#العام', options: ['الجمعة', 'السبت'] } }), { operations: [], message: null, interactive: { kind: 'poll', question: 'متى نجتمع؟', channel: 'العام', options: ['الجمعة', 'السبت'] } });
  assert.equal(normalizeAiProposal({ interactive: { kind: 'poll', question: 'متى نجتمع؟', channel: 'العام', options: ['الجمعة', 'الجمعة'] } }), null);
  assert.equal(normalizeAiProposal({ interactive: { kind: 'poll', question: 'متى نجتمع؟', channel: 'العام', options: ['الجمعة'] } }), null);
});

test('download cards require a title, description and publication channel', () => {
  assert.deepEqual(normalizeAiProposal({ interactive: { kind: 'download', title: 'دليل المجتمع', description: 'حمّل الدليل', channel: '#الملفات' } }), { operations: [], message: null, interactive: { kind: 'download', title: 'دليل المجتمع', description: 'حمّل الدليل', channel: 'الملفات' } });
  assert.equal(normalizeAiProposal({ interactive: { kind: 'download', title: 'دليل المجتمع', channel: 'الملفات' } }), null);
});

test('AI updates require an actual Discord resource ID and only safe fields', () => {
  assert.deepEqual(normalizeAiProposal({ operations: [{ resource_type: 'channel', action: 'update', resource_id: '1036300782972186686', name: 'الأخبار', topic: 'آخر أخبار المجتمع', permissions: '8' }] }), { operations: [{ resource_type: 'channel', action: 'update', resource_id: '1036300782972186686', name: 'الأخبار', topic: 'آخر أخبار المجتمع' }], message: null });
  assert.equal(normalizeAiProposal({ operations: [{ resource_type: 'channel', action: 'update', resource_id: 'not-real', name: 'الأخبار' }] }), null);
});
