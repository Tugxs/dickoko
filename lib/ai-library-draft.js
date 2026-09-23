const placeholder = value => /\[[^\]]+\]/.test(String(value || ''));

export function cleanLibraryValue(value) {
  const text = String(value || '').trim();
  return placeholder(text) ? '' : text;
}

export function incompleteLibraryValue(value) {
  const text = String(value || '').trim();
  return !text || placeholder(text) || /^(?:اختر|أدخل|ادخل|اكتب|حدد)\s+(?:القناة|العنوان|النص|الوصف|الجائزة|السؤال|الخيار|المدة)/i.test(text);
}

export function validatedAiImage(image) {
  if (!image) return null;
  const mime = String(image.mime || '');
  const base64 = String(image.base64 || '');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 470000) throw Object.assign(new Error('الصورة غير صالحة أو كبيرة جدًا.'), { status: 400 });
  const bytes = Buffer.from(base64, 'base64');
  const valid = mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid || bytes.length > 350000) throw Object.assign(new Error('نوع الصورة أو حجمها غير صالح.'), { status: 400 });
  return { mime, base64 };
}

export function validatedAiMedia(media) {
  if (!media) return null;
  const mime = String(media.mime || '');
  const base64 = String(media.base64 || '');
  if (!['image/gif', 'video/mp4', 'video/quicktime'].includes(mime) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 28_000_000) throw Object.assign(new Error('الملف المتحرك غير صالح أو يتجاوز 20 ميجابايت.'), { status: 400 });
  const bytes = Buffer.from(base64, 'base64');
  const signature = bytes.toString('ascii', 0, 6);
  const valid = mime === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(signature) : bytes.toString('ascii', 4, 8) === 'ftyp';
  if (!valid || !bytes.length || bytes.length > 20 * 1024 * 1024) throw Object.assign(new Error('نوع GIF أو الفيديو غير صالح، أو حجمه يتجاوز 20 ميجابايت.'), { status: 400 });
  return { mime, base64 };
}

// The library describes a task; unanswered fields belong in its review card, not in a Discord post.
export function libraryDraftProposal({ mode, category, title, prompt }) {
  if (mode !== 'execute') return null;
  const name = String(title || '');
  const group = String(category || '');
  const channel = cleanLibraryValue(String(prompt).match(/في\s+(?:قناة\s+)?#?([^\s،.]+)/u)?.[1] || '');
  const namedTitle = cleanLibraryValue(String(prompt).match(/بعنوان\s+([^\n،.]{2,100})/u)?.[1] || '');
  let interactive = null;
  if (/جيف آواي/.test(group) || /جيف آواي/.test(name)) interactive = { kind: 'giveaway', prize: cleanLibraryValue(String(prompt).match(/لجائزة\s+([^\n،.]+?)(?=\s+لمدة|\s+في\s+#|،|\.|$)/u)?.[1] || ''), channel, durationMinutes: '', winnerCount: 1 };
  else if (/تذاكر الدعم/.test(group) || /لوحة دعم/.test(name)) interactive = { kind: 'tickets', title: namedTitle, description: cleanLibraryValue(String(prompt).match(/وصفها\s+([^\n.]+)/u)?.[1] || ''), channel };
  else if (/استطلاع/.test(name)) interactive = { kind: 'poll', question: cleanLibraryValue(String(prompt).match(/عن\s+([^\n،.]+?)(?=\s+بخيارات|$)/u)?.[1] || ''), channel, options: ['', ''] };
  else if (/تحميل|دليل قابل/.test(name)) interactive = { kind: 'download', title: namedTitle, description: '', channel };
  if (interactive) return { operations: [], message: null, interactive, review_request: prompt, draft: true };
  if (/الرسائل/.test(group)) return { operations: [], message: { channel, content: '' }, review_request: prompt, draft: true };
  if (/بناء السيرفر|القنوات|الرتب/.test(group)) return { operations: [], message: null, structure: { kind: 'structure', title: name }, review_request: prompt, draft: true };
  return null;
}

