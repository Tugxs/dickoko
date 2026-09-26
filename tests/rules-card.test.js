import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRulesCard, defaultServerRules, validateRulesCard } from '../lib/rules-card.js';

test('rules template builds three Discord-safe card layouts', () => {
  const input = { title: '📜 قوانين السيرفر', description: 'اقرأ قبل المشاركة', rules: [...defaultServerRules], color: '#8147cc' };
  const single = buildRulesCard({ ...input, style: 'single' });
  const sections = buildRulesCard({ ...input, style: 'sections' });
  const cards = buildRulesCard({ ...input, style: 'cards' });
  assert.equal(single.embeds.length, 1);
  assert.match(single.embeds[0].description, /\*\*1\.\*\*/);
  assert.equal(sections.embeds[0].fields.length, input.rules.length);
  assert.equal(cards.embeds.length, input.rules.length + 1);
  assert.equal(cards.embeds[0].color, 0x8147cc);
  for (const payload of [single, sections, cards]) {
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.ok(payload.embeds.length <= 9);
    assert.ok(JSON.stringify(payload).length < 6000);
  }
});

test('rules template rejects duplicates and Discord-sized overflow before publication', () => {
  const base = { title: 'قوانين', description: '', rules: ['الاحترام', 'تجنب الإزعاج'], style: 'single' };
  assert.equal(validateRulesCard(base), null);
  assert.match(validateRulesCard({ ...base, rules: ['الاحترام', 'الاحترام'] }), /المكررة/);
  assert.match(validateRulesCard({ ...base, rules: ['x'.repeat(251), 'آخر'] }), /250/);
  assert.match(validateRulesCard({ ...base, style: 'unknown' }), /طريقة عرض/);
});
