const ticketRequest = text => /(?:لوحة|نظام|زر|بطاقة)\s*(?:ال)?(?:دعم|تذاكر|تيكت)|(?:فتح|إنشاء|انشاء)\s*(?:تذكرة|تيكت)/i.test(text);
const textOnly = text => /(?:نص|صياغة|وصف)[^\n]{0,60}?(?:فقط|بس)|(?:لا|بدون)\s*(?:تنفيذ|نشر|زر|تذاكر)/i.test(text);

// A workflow blueprint is advice about several steps, never one Discord message.
export function workflowBlueprintRequest(value) {
  const text = String(value || '');
  return /(?:صمم|صمّم|اقترح|خطط|خطة|تصميم|كيف|طريقة|رتب|رتّب|ابن|جهز|سو[يّي])[^\n]{0,120}(?:رحلة|تجربة|مسار|خطوات|استراتيجية|خطة|قياس|تهيئة|انضمام)|(?:رحلة|تجربة|مسار)\s+(?:العضو|الأعضاء|المستخدم|العميل|الجدد|الجديد)/i.test(text)
    && !/(?:اكتب|صغ|انشر|أرسل|ارسل)\s+(?:رسالة|إعلان|اعلان|نص)/i.test(text);
}

export function ideaSelectionRequest(value) {
  const text = String(value || '');
  return /(?:اقترح|اعطني|أعطني|هات|ولد|ولّد|قدم|قدّم)[^\n]{0,90}(?:أفكار|افكار|اقتراحات|مبادرات|أنشطة|انشطة|فعاليات)|(?:أفكار|افكار)\s+(?:عملية|لتنشيط|لزيادة|لتحسين)/i.test(text);
}

export const planningRequest = value => workflowBlueprintRequest(value) || ideaSelectionRequest(value);

export function unsupportedAutomationRequest(context) {
  const users = [...context].reverse().filter(item => item.role === 'user').map(item => String(item.content || ''));
  const latest = users.find(text => !/^(?:نعم|ايه|أيوه|يلا|نفذ|انشر|تمام|موافق)[\s.!؟]*$/i.test(text.trim())) || users[0] || '';
  return /(?:بوت\s+(?:خاص|مستقل|موسيقى|ألعاب|العاب)|(?:أنشئ|انشئ|ابن|جهز|سوي|اصنع|ركب|شغل|أبغى|ابغى)\s*(?:لي\s*)?(?:بوت|لعبة)(?:\s|$))/i.test(latest);
}

export function alignAiProposalWithIntent(parsed, context) {
  if (!parsed || parsed.executeNow !== true) return parsed;
  const recentUsers = [...context].reverse().filter(item => item.role === 'user');
  if (planningRequest(recentUsers[0]?.content)) return { ...parsed, executeNow: false, operations: [], message: null, interactive: null };
  if (parsed.interactive && Array.isArray(parsed.operations) && parsed.operations.length) {
    const requestedStructure = recentUsers.some(item => /(?:أنشئ|انشئ|سوي|جهز|ابن|أضف|اضف)\s*(?:لي\s*)?(?:قناة|روم|تصنيف|رتبة)|(?:قناة|روم|تصنيف|رتبة)\s+جديد/i.test(String(item.content || '')));
    if (!requestedStructure) parsed = { ...parsed, operations: [] };
  }
  const intent = recentUsers.slice(0, 4).find(item => ticketRequest(String(item.content || '')));
  if (!intent || textOnly(String(intent.content || ''))) return parsed;
  if (parsed.interactive?.kind === 'tickets') return { ...parsed, message: null };
  if (parsed.interactive || !parsed.message) return parsed;
  const channelName = String(parsed.message.channel || '').replace(/^#/, '').trim();
  const titleMatch = String(intent.content).match(/بعنوان\s+["«]?([^\n،.\"»]{2,80})/i);
  const title = titleMatch?.[1]?.trim() || 'خدمة العملاء';
  const description = 'تحتاج مساعدة؟ اضغط الزر لفتح تذكرة خاصة، وسيتابع معك فريق الدعم.';
  return { ...parsed, message: null, interactive: { kind: 'tickets', title, description, channel: channelName || 'الدعم' } };
}
