import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { libraryDraftProposal, incompleteLibraryValue, validatedAiMedia } from '../lib/ai-library-draft.js';
import { presentAiRequest } from '../lib/local-ai.js';

test('executable library requests keep their action card even when the prompt mentions a plan', () => {
  const prompt = 'جهز لوحة تذاكر دعم في #[القناة] بعنوان [العنوان]، ووصفها [الوصف]. اعرض الخطة قبل النشر.';
  const proposal = libraryDraftProposal({ mode: 'execute', category: 'تذاكر الدعم', title: 'لوحة تذاكر الدعم', prompt });
  const shown = presentAiRequest({ prompt, library_mode: 'execute', proposal });
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
    ['بطاقات وملفات', 'بطاقة تحميل', 'جهز بطاقة تحميل في #[القناة] بعنوان [اسم الملف] ووصف [ما يحتويه].', 'download'],
  ];
  for (const [category, title, prompt, kind] of cases) {
    const draft = libraryDraftProposal({ mode: 'execute', category, title, prompt });
    assert.equal(draft.interactive.kind, kind);
    assert.equal(draft.draft, true);
    for (const value of Object.values(draft.interactive).flat()) assert.doesNotMatch(String(value), /\[[^\]]+\]/);
  }
});

test('message and structure templates create review cards rather than publishing brackets', () => {
  assert.deepEqual(libraryDraftProposal({ mode: 'execute', category: 'الرسائل', title: 'إعلان مع صورة', prompt: 'اكتب رسالة عن [الموضوع] في #[القناة]' }).message, { channel: '', content: '' });
  assert.equal(libraryDraftProposal({ mode: 'execute', category: 'القنوات', title: 'قناة صوتية', prompt: 'جهز قناة صوتية باسم [الاسم]' }).structure.kind, 'structure');
  assert.equal(incompleteLibraryValue('[العنوان]'), true);
  assert.equal(incompleteLibraryValue('خدمة العملاء'), false);
});

test('every executable library template has a typed review path when sent unchanged', () => {
  const source = fs.readFileSync(new URL('../workspace.js', import.meta.url), 'utf8');
  const start = source.indexOf('const aiSuggestionGroups = [');
  const end = source.indexOf('const aiPromptLibrary', start);
  const groups = vm.runInNewContext(`${source.slice(start, end).replace('const aiSuggestionGroups', 'var aiSuggestionGroups')}; aiSuggestionGroups`);
  const executable = groups.flatMap(group => group.prompts.filter(item => (item[2] || group.mode) === 'execute').map(([title, prompt]) => ({ mode: 'execute', category: group.name, title, prompt })));
  assert.ok(executable.length >= 25);
  for (const task of executable) assert.ok(libraryDraftProposal(task), `Missing review path: ${task.category} / ${task.title}`);
});

