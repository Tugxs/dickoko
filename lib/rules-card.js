export const defaultServerRules = Object.freeze([
  'احترم جميع الأعضاء وتحدث بأدب، وتجنب الإساءة أو التمييز.',
  'امنع الإزعاج والرسائل المكررة والإشارات العشوائية.',
  'انشر المحتوى في القناة المناسبة والتزم بموضوعها.',
  'لا تنشر روابط دعائية أو محتوى غير مناسب دون إذن الإدارة.',
  'احفظ خصوصية الآخرين ولا تشارك معلوماتهم الشخصية.',
  'اتبع توجيهات فريق الإشراف، وأبلغ عن المخالفات عبر قناة الدعم.',
]);

export const rulesStyles = Object.freeze(['single', 'sections', 'cards']);

export function validateRulesCard({ title, description, rules, style }) {
  if (!String(title || '').trim() || String(title).length > 180) return 'اكتب عنوانًا للقوانين لا يتجاوز 180 حرفًا.';
  if (String(description || '').length > 500) return 'مقدمة القوانين يجب ألا تتجاوز 500 حرف.';
  if (!rulesStyles.includes(style)) return 'اختر طريقة عرض صحيحة للقوانين.';
  if (!Array.isArray(rules) || rules.length < 2 || rules.length > 8 || rules.some(rule => !String(rule || '').trim() || String(rule).length > 250)) return 'اكتب من قانونين إلى 8 قوانين، كل قانون في سطر ولا يتجاوز 250 حرفًا.';
  if (new Set(rules.map(rule => String(rule).trim().toLocaleLowerCase('ar'))).size !== rules.length) return 'احذف القوانين المكررة قبل النشر.';
  return null;
}

export function buildRulesCard({ title, description, rules, style, color }) {
  const error = validateRulesCard({ title, description, rules, style });
  if (error) throw Object.assign(new Error(error), { status: 400 });
  const heading = String(title).trim();
  const intro = String(description || '').trim();
  const lines = rules.map(rule => String(rule).trim());
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? Number.parseInt(color.slice(1), 16) : 0x8b5cf6;
  const notice = 'يرجى قراءة القوانين والالتزام بها.';
  let embeds;
  if (style === 'single') {
    embeds = [{ title: heading, description: [intro, ...lines.map((rule, index) => `**${index + 1}.** ${rule}`), notice].filter(Boolean).join('\n\n'), color: accent }];
  } else if (style === 'sections') {
    embeds = [{ title: heading, description: intro || notice, color: accent, fields: lines.map((rule, index) => ({ name: `القانون ${index + 1}`, value: rule, inline: false })) }];
  } else {
    embeds = [{ title: heading, description: intro || notice, color: accent }, ...lines.map((rule, index) => ({ title: `القانون ${index + 1}`, description: rule, color: accent }))];
  }
  return { embeds, allowed_mentions: { parse: [] } };
}
