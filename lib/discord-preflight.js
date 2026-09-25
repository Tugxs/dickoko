// Reject malformed Discord writes locally, before resolving a bot or making
// any upstream request. Permission and resource existence still need Discord
// to verify; these checks cover fields the site already knows.
export function validateDiscordWrite(pathname, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return null;
  let payload;
  try {
    const raw = options.body instanceof FormData ? options.body.get('payload_json') : options.body;
    if (typeof raw !== 'string') return null;
    payload = JSON.parse(raw);
  } catch { return 'تعذر قراءة بيانات الطلب. راجع القالب قبل التنفيذ.'; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'بيانات الطلب غير صالحة.';

  if (/^\/channels\/\d{17,22}\/messages(?:\/\d{17,22})?$/.test(pathname)) {
    if (typeof payload.content === 'string' && payload.content.length > 2_000) return 'نص الرسالة أطول من حد Discord (2000 حرف).';
    if (payload.embeds !== undefined) {
      if (!Array.isArray(payload.embeds) || payload.embeds.length > 10) return 'الرسالة تدعم عشر بطاقات عرض كحد أقصى.';
      let total = 0;
      for (const embed of payload.embeds) {
        if (!embed || typeof embed !== 'object') return 'بطاقة العرض غير صالحة.';
        const title = String(embed.title || ''), description = String(embed.description || ''), footer = String(embed.footer?.text || ''), author = String(embed.author?.name || '');
        if (title.length > 256 || description.length > 4_096 || footer.length > 2_048 || author.length > 256) return 'نص بطاقة العرض يتجاوز حدود Discord.';
        if (embed.fields !== undefined && (!Array.isArray(embed.fields) || embed.fields.length > 25)) return 'بطاقة العرض تدعم 25 حقلًا كحد أقصى.';
        total += title.length + description.length + footer.length + author.length;
        for (const field of embed.fields || []) {
          if (String(field.name || '').length > 256 || String(field.value || '').length > 1_024) return 'حقل في البطاقة يتجاوز حدود Discord.';
          total += String(field.name || '').length + String(field.value || '').length;
        }
      }
      if (total > 6_000) return 'مجموع نصوص بطاقات الرسالة يتجاوز حد Discord (6000 حرف).';
    }
    if (payload.components !== undefined && (!Array.isArray(payload.components) || payload.components.length > 5)) return 'الرسالة تدعم خمسة صفوف من الأزرار كحد أقصى.';
  }

  if (method === 'POST' && /^\/guilds\/\d{17,22}\/channels$/.test(pathname) && (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 100)) return 'اسم القناة يجب أن يكون بين 1 و100 حرف.';
  if (method === 'POST' && /^\/guilds\/\d{17,22}\/roles$/.test(pathname) && typeof payload.name === 'string' && payload.name.length > 100) return 'اسم الرتبة يتجاوز 100 حرف.';
  return null;
}
