import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRulesMessages, validateRulesCard } from '../lib/rules-card.js';

test('freeform single card keeps line breaks and customer numbering', () => {
  const pages = buildRulesMessages({ title: 'القوانين', description: 'اقرأ أولًا', singleText: 'الاحترام\nسطر ثانٍ\n\n02. الإعلانات', style: 'single' });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].embeds[0].description, 'اقرأ أولًا\n\nالاحترام\nسطر ثانٍ\n\n02. الإعلانات');
  assert.deepEqual(pages[0].allowed_mentions, { parse: [] });
});

test('sections and cards retain optional titles and multiline bodies without numbering', () => {
  const input = { title: 'القوانين', description: '', rules: [{ title: 'الاحترام', body: 'كن محترمًا\nحتى عند الاختلاف' }, { title: '', body: 'لا تنشر الإعلانات' }], color: '#8147cc' };
  const sections = buildRulesMessages({ ...input, style: 'sections' });
  assert.deepEqual(sections[0].embeds[0].fields.map(field => field.name), ['الاحترام', '\u200b']);
  assert.equal(sections[0].embeds[0].fields[0].value, 'كن محترمًا\nحتى عند الاختلاف');
  const cards = buildRulesMessages({ ...input, style: 'cards' });
  assert.equal(cards[0].embeds.length, 3);
  assert.equal(cards[0].embeds[1].title, 'الاحترام');
  assert.equal(cards[0].embeds[2].title, undefined);
  assert.equal(cards[0].embeds[1].color, 0x8147cc);
});

test('one hundred entries split into safe sequential Discord messages', () => {
  const rules = Array.from({ length: 100 }, (_, index) => ({ title: `عنوان ${index + 1}`, body: `قانون ${index + 1}\nتفصيله` }));
  for (const style of ['sections', 'cards']) {
    const pages = buildRulesMessages({ title: 'القوانين', description: 'مقدمة', rules, style });
    assert.equal(pages.length, 13);
    assert.ok(pages.every(page => page.embeds.length <= 9));
    assert.equal(pages[0].embeds[0].description, 'مقدمة');
    assert.equal(pages[1].embeds[0].description, undefined);
  }
});

test('rules template rejects empty entries and over one hundred before publication', () => {
  const base = { title: 'قوانين', description: '', rules: [{ title: '', body: 'الاحترام' }], style: 'sections' };
  assert.equal(validateRulesCard(base), null);
  assert.match(validateRulesCard({ ...base, rules: [{ title: '', body: '' }] }), /نص/);
  assert.match(validateRulesCard({ ...base, rules: Array.from({ length: 101 }, () => ({ title: '', body: 'نص' })) }), /100/);
  assert.match(validateRulesCard({ ...base, style: 'unknown' }), /طريقة عرض/);
});
