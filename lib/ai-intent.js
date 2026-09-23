const ticketRequest = text => /(?:لوحة|نظام|زر|بطاقة)\s*(?:ال)?(?:دعم|تذاكر|تيكت)|(?:فتح|إنشاء|انشاء)\s*(?:تذكرة|تيكت)/i.test(text);
const textOnly = text => /(?:نص|صياغة|وصف)[^\n]{0,60}?(?:فقط|بس)|(?:لا|بدون)\s*(?:تنفيذ|نشر|زر|تذاكر)/i.test(text);

export function alignAiProposalWithIntent(parsed, context, channels = []) {
  if (!parsed || parsed.executeNow !== true) return parsed;
  const recentUsers = [...context].reverse().filter(item => item.role === 'user');
  const intent = recentUsers.slice(0, 4).find(item => ticketRequest(String(item.content || '')));
  if (!intent || textOnly(String(intent.content || ''))) return parsed;
  if (parsed.interactive?.kind === 'tickets') return { ...parsed, message: null };
  if (parsed.interactive || !parsed.message) return parsed;
  const channelName = String(parsed.message.channel || '').replace(/^#/, '').trim();
  if (!channels.some(channel => channel.name?.toLowerCase() === channelName.toLowerCase() && [0, 5].includes(channel.type))) return { ...parsed, message: null };
  const titleMatch = String(intent.content).match(/بعنوان\s+["«]?([^\n،.\"»]{2,80})/i);
  const title = titleMatch?.[1]?.trim() || 'خدمة العملاء';
  const description = 'تحتاج مساعدة؟ اضغط الزر لفتح تذكرة خاصة، وسيتابع معك فريق الدعم.';
  return { ...parsed, message: null, interactive: { kind: 'tickets', title, description, channel: channelName } };
}

