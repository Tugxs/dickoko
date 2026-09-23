import test from 'node:test';
import assert from 'node:assert/strict';
import { alignAiProposalWithIntent, unsupportedAutomationRequest } from '../lib/ai-intent.js';

test('a request to build an unsupported bot or game never becomes another executable task', () => {
  assert.equal(unsupportedAutomationRequest([{ role: 'user', content: 'سوي لي بوت موسيقى' }, { role: 'user', content: 'نعم' }]), true);
  assert.equal(unsupportedAutomationRequest([{ role: 'user', content: 'ابن لي لعبة تفاعلية' }, { role: 'user', content: 'نفذ' }]), true);
  assert.equal(unsupportedAutomationRequest([{ role: 'user', content: 'ابن لي قنوات لسيرفر ألعاب' }]), false);
});

const channels = [{ name: '121', type: 0 }, { name: 'Voice', type: 2 }];

test('a support panel request becomes a ticket system rather than a plain post', () => {
  const proposal = { executeNow: true, message: { channel: '121', content: 'شكرًا لثقتك بـHAC' }, interactive: null };
  const context = [{ role: 'user', content: 'صمم لوحة دعم للعملاء في 121 بعنوان خدمة عملاء' }, { role: 'user', content: 'نعم انشر' }];
  assert.deepEqual(alignAiProposalWithIntent(proposal, context, channels), {
    executeNow: true, message: null,
    interactive: { kind: 'tickets', title: 'خدمة عملاء', description: 'تحتاج مساعدة؟ اضغط الزر لفتح تذكرة خاصة، وسيتابع معك فريق الدعم.', channel: '121' },
  });
});

test('explicit text-only requests stay text and missing channels can be proposed for creation', () => {
  const proposal = { executeNow: true, message: { channel: '121', content: 'صياغة' } };
  assert.equal(alignAiProposalWithIntent(proposal, [{ role: 'user', content: 'اكتب نص لوحة دعم فقط' }], channels), proposal);
  const missing = alignAiProposalWithIntent({ ...proposal, message: { channel: 'missing', content: 'صياغة' } }, [{ role: 'user', content: 'أنشئ لوحة دعم' }]);
  assert.equal(missing.message, null);
  assert.equal(missing.interactive.channel, 'missing');
});
