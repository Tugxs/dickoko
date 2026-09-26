export const defaultServerRules = Object.freeze([
  'احترم جميع الأعضاء وتحدث بأدب، وتجنب الإساءة أو التمييز.',
  'امنع الإزعاج والرسائل المكررة والإشارات العشوائية.',
  'انشر المحتوى في القناة المناسبة والتزم بموضوعها.',
  'لا تنشر روابط دعائية أو محتوى غير مناسب دون إذن الإدارة.',
  'احفظ خصوصية الآخرين ولا تشارك معلوماتهم الشخصية.',
  'اتبع توجيهات فريق الإشراف، وأبلغ عن المخالفات عبر قناة الدعم.',
]);

export const rulesStyles = Object.freeze(['single', 'sections', 'cards']);
export const maxRuleEntries = 100;

export function normalizeRuleEntries(rules) {
  return Array.isArray(rules) ? rules.map(rule => typeof rule === 'string'
    ? { title: '', body: rule }
    : { title: String(rule?.title || ''), body: String(rule?.body || '') }) : [];
}

export function validateRulesCard({ title, description, rules, singleText, style }) {
  if (!String(title || '').trim() || String(title).length > 180) return 'اكتب عنوانًا للقوانين لا يتجاوز 180 حرفًا.';
  if (String(description || '').length > 500) return 'مقدمة القوانين يجب ألا تتجاوز 500 حرف.';
  if (!rulesStyles.includes(style)) return 'اختر طريقة عرض صحيحة للقوانين.';
  if (style === 'single') {
    if (!String(singleText || '').trim() || String(singleText).length > 3500) return 'اكتب نص البطاقة الواحدة، بحد أقصى 3500 حرف. يمكنك ترقيمه وتنسيقه بنفسك.';
    return null;
  }
  const entries = normalizeRuleEntries(rules);
  if (entries.length < 1 || entries.length > maxRuleEntries) return 'أضف من قسم واحد إلى 100 قسم أو قانون.';
  if (entries.some(entry => !entry.body.trim() || entry.body.length > 1000 || entry.title.length > 200)) return 'كل مربع يحتاج نصًا، بحد 1000 حرف للنص و200 حرف للعنوان الاختياري.';
  return null;
}

export function buildRulesMessages({ title, description, rules, singleText, style, color }) {
  const error = validateRulesCard({ title, description, rules, singleText, style });
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const heading = String(title).trim();
  const intro = String(description || '').trim();
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? Number.parseInt(color.slice(1), 16) : 0x8b5cf6;
  const safe = embeds => ({ embeds, allowed_mentions: { parse: [] } });
  if (style === 'single') return [safe([{ title: heading, description: [intro, String(singleText).trim()].filter(Boolean).join('\n\n'), color: accent }])];

  const entries = normalizeRuleEntries(rules).map(entry => ({ title: entry.title.trim(), body: entry.body.trim() }));
  const groups = [];
  let current = [], length = heading.length + intro.length;
  for (const entry of entries) {
    const cost = entry.title.length + entry.body.length;
    if (current.length && (current.length >= 8 || length + cost > 5000)) {
      groups.push(current);
      current = [];
      length = heading.length;
    }
    current.push(entry);
    length += cost;
  }
  if (current.length) groups.push(current);
  return groups.map((group, index) => {
    if (style === 'sections') return safe([{ title: heading, ...(index === 0 && intro ? { description: intro } : {}), color: accent, fields: group.map(entry => ({ name: entry.title || '\u200b', value: entry.body, inline: false })) }]);
    return safe([{ title: heading, ...(index === 0 && intro ? { description: intro } : {}), color: accent }, ...group.map(entry => ({ ...(entry.title ? { title: entry.title } : {}), description: entry.body, color: accent }))]);
  });
}
