import test from 'node:test';
import assert from 'node:assert/strict';
import { alignAiProposalWithIntent, unsupportedAutomationRequest, workflowBlueprintRequest, ideaSelectionRequest } from '../lib/ai-intent.js';

test('a member journey blueprint cannot turn into a single publishable message', () => {
  const request = 'صمم رحلة بسيطة للعضو الجديد من لحظة دخوله حتى أول مشاركة مفيدة';
  assert.equal(workflowBlueprintRequest(request), true);
  const result = alignAiProposalWithIntent({ executeNow: true, operations: [{ resource_type: 'channel', name: 'ابدأ هنا' }], message: { channel: 'العام', content: 'خطوات الرحلة كاملة' } }, [{ role: 'user', content: request }]);
  assert.equal(result.executeNow, false);
  assert.deepEqual(result.operations, []);
  assert.equal(result.message, null);
  assert.equal(workflowBlueprintRequest('صمم لوحة دعم العملاء مع زر فتح تذكرة'), false);
  assert.equal(workflowBlueprintRequest('اكتب رسالة ترحيب وانشرها'), false);
});

test('multiple community ideas stay choices until the customer selects one', () => {
  const prompt = 'اقترح 10 أفكار عملية لتنشيط أعضاء السيرفر';
  assert.equal(ideaSelectionRequest(prompt), true);
  const result = alignAiProposalWithIntent({ executeNow: true, message: { channel: 'العام', content: 'عشر أفكار' } }, [{ role: 'user', content: prompt }]);
  assert.equal(result.executeNow, false);
  assert.equal(result.message, null);
});

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

test('giveaway confirmation does not invent categories or channels', () => {
  const proposal = { executeNow: true, operations: [{ resource_type: 'category', name: 'الأنشطة التفاعلية' }, { resource_type: 'channel', name: 'العروض والأنشطة' }], interactive: { kind: 'giveaway', prize: 'جائزة', channel: 'العام', durationMinutes: 60, winnerCount: 3 } };
  const result = alignAiProposalWithIntent(proposal, [{ role: 'user', content: 'جهز جيف آواي في العام لجائزة لمدة ساعة مع 3 فائزين' }, { role: 'user', content: 'اعرض التفاصيل' }]);
  assert.deepEqual(result.operations, []);
  assert.equal(result.interactive.kind, 'giveaway');
});
