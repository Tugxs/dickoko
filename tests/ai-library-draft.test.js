import test from 'node:test';
import assert from 'node:assert/strict';
import { aiPromptLibrary, readyAiTemplate } from '../ai-library-catalog.js';
import { libraryDraftProposal, incompleteLibraryValue, validatedAiMedia } from '../lib/ai-library-draft.js';
import { migrateLocalAi, presentAiRequest } from '../lib/local-ai.js';

test('executable library requests keep their action card even when the prompt mentions a plan', () => {
  const prompt = 'جهز لوحة تذاكر دعم في #[القناة] بعنوان [العنوان]، ووصفها [الوصف]. اعرض الخطة قبل النشر.';
  const proposal = libraryDraftProposal({ mode: 'execute', category: 'تذاكر الدعم', title: 'لوحة تذاكر الدعم', prompt });
  const shown = presentAiRequest({ prompt, library_mode: 'execute', library_category: 'تذاكر الدعم', library_title: 'لوحة تذاكر الدعم', proposal });
  assert.equal(shown.can_select_step, false);
  assert.equal(shown.can_publish_answer, false);
  assert.equal(shown.proposal.interactive.kind, 'tickets');
});

test('animated GIF and MP4 retain their original bytes while unsupported media is rejected', () => {
  const gif = Buffer.from('GIF89a\0\0\0\0');
  const mp4 = Buffer.from('\0\0\0\x18ftypisom');
  assert.equal(validatedAiMedia({ mime: 'image/gif', base64: gif.toString('base64') }).base64, gif.toString('base64'));
  assert.equal(validatedAiMedia({ mime: 'video/mp4', base64: mp4.toString('base64') }).base64, mp4.toString('base64'));
  assert.throws(() => validatedAiMedia({ mime: 'video/mp4', base64: gif.toString('base64') }));
});

test('untouched library templates open editable task-specific drafts', () => {
  const cases = [
    ['تذاكر الدعم', 'لوحة تذاكر الدعم', 'جهز لوحة تذاكر دعم في #[القناة] بعنوان [العنوان]، ووصفها [الوصف].', 'tickets'],
    ['الجيف آواي', 'جيف آواي سريع', 'جهز جيف آواي في #[القناة] لجائزة [الجائزة] لمدة [المدة] دقيقة.', 'giveaway'],
    ['إدارة المجتمع', 'استطلاع رأي', 'جهز استطلاعًا تفاعليًا في #[القناة] عن [السؤال] بخيارات [الخيار الأول] و[الخيار الثاني].', 'poll'],
    ['الرسائل', 'إعلان فعالية', 'جهز إعلان فعالية [الاسم] في #[القناة]', 'event'],
    ['إدارة المجتمع', 'حدث Discord مجدول', 'أنشئ حدث Discord بعنوان [اسم الحدث]', 'scheduled_event'],
    ['الرسائل', 'رسالة ترحيب تلقائية', 'جهز ترحيبًا تلقائيًا في #[القناة]', 'welcome'],
  ];
  for (const [category, title, prompt, kind] of cases) {
    const draft = libraryDraftProposal({ mode: 'execute', category, title, prompt });
    assert.equal(draft.interactive.kind, kind);
    assert.equal(draft.draft, true);
    for (const value of Object.values(draft.interactive).flat()) assert.doesNotMatch(String(value), /\[[^\]]+\]/);
  }
});

test('message templates create review cards while retired templates cannot create drafts', () => {
  const message = libraryDraftProposal({ mode: 'execute', category: 'الرسائل', title: 'إعلان مع صورة', prompt: 'اكتب رسالة عن [الموضوع] في #[القناة]' }).message;
  assert.equal(message.channel, '');
  assert.match(message.content, /إعلان لمجتمعنا/);
  assert.doesNotMatch(message.content, /\[[^\]]+\]/);
  assert.equal(libraryDraftProposal({ mode: 'execute', category: 'القنوات', title: 'قناة صوتية', prompt: 'جهز قناة صوتية باسم [الاسم]' }), null);
  assert.equal(libraryDraftProposal({ mode: 'execute', category: 'بطاقات وملفات', title: 'بطاقة تحميل', prompt: 'جهز بطاقة تحميل في #[القناة]' }), null);
  assert.equal(readyAiTemplate('الرتب', 'رتبة فريق الدعم'), null);
  const retired = presentAiRequest({ library_mode: 'execute', library_category: 'الرتب', library_title: 'رتبة فريق الدعم', prompt: 'جهز رتبة دعم', proposal: { operations: [{ resource_type: 'role', name: 'الدعم' }] } });
  assert.equal(retired.proposal, null);
  assert.match(retired.answer, /أُزيل من المكتبة/);
  assert.equal(incompleteLibraryValue('[العنوان]'), true);
  assert.equal(incompleteLibraryValue('خدمة العملاء'), false);
  assert.equal(incompleteLibraryValue('اقرأ [الدليل](https://example.com/guide)'), false);
});

test('every executable library template has a typed review path when sent unchanged', () => {
  assert.equal(aiPromptLibrary.length, 11);
  assert.equal(new Set(aiPromptLibrary.map(item => `${item.category}/${item.title}`)).size, aiPromptLibrary.length);
  for (const task of aiPromptLibrary) {
    const draft = libraryDraftProposal({ ...task, mode: 'execute' });
    assert.ok(draft, `Missing review path: ${task.category} / ${task.title}`);
    if (task.kind === 'message') assert.ok(draft.message, `${task.title} must open a message editor`);
    else assert.equal(draft.interactive?.kind, task.kind, `${task.title} must open its own action card`);
    const visible = presentAiRequest({ status: 'completed', prompt: task.prompt, library_mode: 'execute', library_category: task.category, library_title: task.title, proposal: draft });
    if (task.kind === 'message') assert.ok(visible.proposal?.message, `${task.title} must remain visible in the conversation`);
    else assert.equal(visible.proposal?.interactive?.kind, task.kind, `${task.title} must remain visible in the conversation`);
    assert.equal(draft.draft, true);
    if (draft.message) { assert.ok(draft.message.content.trim()); assert.doesNotMatch(draft.message.content, /\[[^\]]+\]/); }
  }
});

test('startup removes saved retired library drafts using the same catalog as the UI', async () => {
  const calls = [];
  await migrateLocalAi({ query: async (...args) => { calls.push(args); return { rows: [] }; } });
  const cleanup = calls.find(([sql]) => sql.includes('DELETE FROM ai_requests AS request'));
  assert.ok(cleanup);
  assert.equal(cleanup[1].length, aiPromptLibrary.length * 2);
  assert.equal(cleanup[1].includes('رتبة فريق الدعم'), false);
  assert.ok(calls.some(([sql]) => sql.includes("proposal->'interactive'->>'kind'='download'")));
  assert.ok(calls.some(([sql]) => sql.includes('DROP TABLE IF EXISTS diskoko_download_cards')));
});

