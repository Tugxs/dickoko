import { aiPromptLibrary } from './ai-library-catalog.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function discordMarkdownPreview(value) {
  return esc(value).split('\n').map(line => {
    let rendered = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<u>$1</u>').replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/\|\|(.+?)\|\|/g, '<span class="ai-preview-spoiler">$1</span>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '<u>$1</u>');
    if (/^#{1,3} /.test(rendered)) rendered = `<strong class="ai-preview-heading">${rendered.replace(/^#{1,3} /, '')}</strong>`;
    if (/^&gt; /.test(rendered)) rendered = `<span class="ai-preview-quote">${rendered.slice(5)}</span>`;
    return renderGuildEmojiMarkup(rendered);
  }).join('<br>');
}
const basicEmojiGroups = {
  'وجوه': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 🙃 😉 😍 🥰 😘 😎 🤩 🥳 😢 😭 😡 🤔 🤗 😴 🤯 🥺 😇 😋 😏 😬 🫡',
  'أشخاص': '👋 🤚 ✋ 🖐️ 👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 🫶 🤝 💪 🙏 👀 👤 🧑 👩 👨 👶 👑',
  'احتفال': '🎉 🎊 🎁 🎂 🎈 🎆 🎇 ✨ 🎮 🎯 🏆 🥇 🥈 🥉 🎟️ 🎫 🎵 🎶 🎤 🎧 🎬 📸',
  'قلوب': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💕 💞 💖 💗 💓 💘 💝 💔 ❤️‍🔥',
  'رموز': '✅ ❌ ❗ ❓ ⚠️ 💯 🔥 ⭐ 🌟 💡 📌 📢 🔔 🔕 🔒 🔓 🛡️ ⚙️ 📅 ⏰ ⏳ ➕ ➖ ➡️ ⬅️ ⬆️ ⬇️',
  'طبيعة': '🌸 🌹 🌻 🌷 🍀 🌿 🌈 ☀️ 🌙 🌍 🌊 ❄️ ☁️ ⚡ 🐱 🐶 🦊 🦁 🐼 🐸 🐧 🦋',
  'طعام': '🍎 🍓 🍉 🍋 🍕 🍔 🍟 🌮 🍣 🍰 🍪 🍫 🍿 ☕ 🧃 🥤',
};
function renderGuildEmojiMarkup(value) {
  const known = new Set((state.data?.emojis || []).map(emoji => String(emoji.id)));
  return value.replace(/&lt;(a?):([A-Za-z0-9_]{2,32}):(\d{15,22})&gt;/g, (match, animated, name, id) => known.has(id) ? `<img class="ai-emoji-inline" src="https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=48" alt=":${name}:" title=":${name}:">` : match);
}
const emojiPreviewText = value => renderGuildEmojiMarkup(esc(value));
function installAiEmojiPickers() {
  if (screen() !== 'assistant') return;
  const body = $('#dialogContent .dialog-body');
  const existing = body.querySelector('.ai-emoji-picker');
  if (existing?.emojiBind) { existing.emojiBind(); return; }
  const fields = [...body.querySelectorAll('input:not([type]),input[type="text"],input[type="url"],textarea')].filter(field => !field.disabled && !field.readOnly && field.closest('label'));
  if (!fields.length) return;
  const picker = document.createElement('div'); picker.className = 'ai-emoji-picker'; picker.hidden = true;
  picker.innerHTML = '<div class="ai-emoji-picker-head"><b>اختر إيموجي</b><button type="button" class="btn small secondary" data-emoji-close>إغلاق</button></div><div class="ai-emoji-tabs"><button type="button" data-emoji-tab="basic" class="active">إيموجيات Discord</button><button type="button" data-emoji-tab="server">إيموجيات السيرفر</button></div><label class="ai-emoji-search">بحث<input type="search" placeholder="ابحث عن إيموجي السيرفر"></label><div class="ai-emoji-results"></div>';
  body.append(picker);
  let target = null, start = 0, end = 0, tab = 'basic';
  const search = picker.querySelector('input[type="search"]'), results = picker.querySelector('.ai-emoji-results');
  const render = () => {
    const query = search.value.trim().toLocaleLowerCase('ar');
    if (tab === 'server') {
      const emojis = (state.data?.emojis || []).filter(emoji => !query || emoji.name.toLocaleLowerCase().includes(query));
      results.innerHTML = emojis.length ? `<div class="ai-emoji-grid">${emojis.map(emoji => `<button type="button" data-emoji-value="${esc(`<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`)}" title=":${esc(emoji.name)}:"><img src="https://cdn.discordapp.com/emojis/${esc(emoji.id)}.${emoji.animated ? 'gif' : 'webp'}?size=48" alt=":${esc(emoji.name)}:"></button>`).join('')}</div>` : '<p class="form-note">لا توجد إيموجيات متاحة لهذا السيرفر أو لا تطابق البحث.</p>';
    } else results.innerHTML = Object.entries(basicEmojiGroups).filter(([name]) => !query || name.includes(query)).map(([name, values]) => `<b class="ai-emoji-group">${name}</b><div class="ai-emoji-grid">${values.split(' ').map(value => `<button type="button" data-emoji-value="${esc(value)}" title="${esc(name)}">${value}</button>`).join('')}</div>`).join('') || '<p class="form-note">لا توجد نتائج. اختر تصنيفًا أو امسح البحث.</p>';
  };
  const bindFields = () => [...body.querySelectorAll('input:not([type]),input[type="text"],input[type="url"],textarea')].filter(field => !field.disabled && !field.readOnly && field.closest('label') && !field.nextElementSibling?.classList.contains('ai-emoji-trigger')).forEach(field => {
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'ai-emoji-trigger'; trigger.textContent = '😀'; trigger.title = 'أضف إيموجي عند المؤشر'; trigger.setAttribute('aria-label', `إيموجي: ${field.closest('label').textContent.trim()}`);
    field.after(trigger);
    trigger.onclick = event => { event.preventDefault(); target = field; start = field.selectionStart ?? field.value.length; end = field.selectionEnd ?? start; picker.hidden = false; render(); };
  });
  picker.emojiBind = bindFields;
  bindFields();
  picker.querySelector('[data-emoji-close]').onclick = () => { picker.hidden = true; target?.focus(); };
  picker.querySelectorAll('[data-emoji-tab]').forEach(button => button.onclick = () => { tab = button.dataset.emojiTab; picker.querySelectorAll('[data-emoji-tab]').forEach(item => item.classList.toggle('active', item === button)); search.value = ''; render(); });
  search.oninput = render;
  results.onclick = event => {
    const button = event.target.closest('[data-emoji-value]'); if (!button || !target) return;
    const emoji = button.dataset.emojiValue, next = target.value.slice(0, start) + emoji + target.value.slice(end);
    if (target.maxLength > 0 && next.length > target.maxLength) { toast('هذا الحقل وصل إلى الحد الأقصى من الأحرف.'); return; }
    target.setRangeText(emoji, start, end, 'end'); target.dispatchEvent(new Event('input', { bubbles: true })); target.focus();
    start = end = target.selectionStart; picker.hidden = true;
  };
}
const fmt = value => new Intl.NumberFormat('ar-SA').format(value ?? 0);
const date = value => value ? new Date(value).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : 'لم يتم بعد';
const state = { account: null, guild: new URLSearchParams(location.search).get('guild'), data: null, loading: true, error: null, tab: 'channels', draft: [], templates: null, readyCatalog: null, readyRuns: [], readyDraft: null, readyKey: null, readyMode: 'add', epoch: 0, days: 7 };
const sections = [ ['overview', '⌂', 'نظرة عامة'], ['alerts', '⚠', 'التنبيهات'], ['builder', '▤', 'القنوات والرتب'], ['ready-templates', '▣', 'قوالب جاهزة'], ['bots', '◈', 'تصاميم بوتاتي'], ['commands', '⌘', 'الأوامر'], ['assistant', '✦', 'AI ديسكوكو'], ['automation', '◷', 'الرسائل المجدولة'], ['analytics', '⌁', 'النشاط والتحليلات'], ['safety', '◇', 'الأمان والصلاحيات'], ['activity', '≡', 'سجل التغييرات'], ['settings', '⚙', 'إعدادات السيرفر'] ];
const aliases = { dashboard: 'overview', 'bot-settings': 'commands', 'custom-bot': 'bots', 'server-detail': 'builder', preview: 'builder', 'custom-template': 'builder', newserver: 'builder' };
function screen() { const hash = location.hash.slice(1); return aliases[hash] || (sections.some(([key]) => key === hash) || hash === 'servers' ? hash : 'overview'); }
let csrfPromise;
async function api(url, options = {}) {
  const method = options.method || 'GET'; const headers = { 'Content-Type': 'application/json' };
  if (method !== 'GET') {
    csrfPromise ||= fetch('/api/csrf-token', { credentials: 'include', cache: 'no-store' }).then(async response => { if (!response.ok) throw Error('تعذر التحقق من الجلسة.'); return (await response.json()).token; }).catch(error => { csrfPromise = null; throw error; });
    headers['X-CSRF-Token'] = await csrfPromise;
  }
  const response = await fetch(url, { ...options, method, headers, credentials: 'include', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'تعذر إكمال الطلب. أعد المحاولة.'), { status: response.status, inviteUrl: body.inviteUrl });
  return body;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
function run(fn) { return async event => { try { await fn(event); } catch (error) { toast(error.message); } }; }
function badge(text, tone = 'neutral') { return `<span class="badge ${tone}">${esc(text)}</span>`; }
const statuses = { installed: ['متصل بالسيرفر', 'good'], install_required: ['يحتاج ربطًا', 'warn'], permissions_insufficient: ['تحقق من الصلاحيات', 'warn'], unavailable: ['تعذر التحقق', 'bad'], draft: ['بانتظار المراجعة', 'purple'], pending: ['لم يُنفذ', 'neutral'], running: ['جارٍ التنفيذ', 'warn'], succeeded: ['مكتمل', 'good'], failed: ['يحتاج مراجعة', 'bad'], scheduled: ['مجدولة', 'purple'], sending: ['جارٍ الإرسال', 'warn'], sent: ['تم الإرسال', 'good'], cancelled: ['ملغاة', 'neutral'] };
function status(value) { return badge(...(statuses[value] || ['لم يتم التحقق', 'neutral'])); }
function action(label, target, style = 'secondary') { return `<a class="btn ${style}" href="${url(target)}">${label}</a>`; }
function url(target, guild = state.guild) { return `/studio${guild ? `?guild=${encodeURIComponent(guild)}` : ''}#${target}`; }
function head(title, description, controls = '') { return `<div class="page-head"><div><span class="eyebrow">${esc(state.data?.guild.name || 'مساحة مجتمعك')}</span><h1>${title}</h1><p>${description}</p></div>${controls}</div>`; }
function metric(label, value, detail, icon) { return `<article class="metric"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><b>${value === null || value === undefined ? '—' : fmt(value)}</b><small>${detail}</small></article>`; }
function empty(title, description, control = '') { return `<div class="empty"><div class="empty-symbol">◇</div><h3>${title}</h3><p>${description}</p>${control}</div>`; }
function panel(title, body, control = '') { return `<section class="panel"><div class="panel-head"><h3>${title}</h3>${control}</div>${body}</section>`; }
function draftKey() { return `diskoko:review:${state.account?.user.id}:${state.guild}`; }
function readDraft() { try { const value = JSON.parse(localStorage.getItem(draftKey()) || '[]'); state.draft = Array.isArray(value) ? value.slice(0, 100) : []; } catch { state.draft = []; } }
function saveDraft() { try { localStorage.setItem(draftKey(), JSON.stringify(state.draft)); } catch { toast('تعذر حفظ قائمة التغييرات على هذا الجهاز. احتفظ بالصفحة مفتوحة.'); } draftBar(); }
function draftBar() {
  const node = $('#draftBar'); node.hidden = !state.draft.length || !state.data || state.loading;
  node.innerHTML = `<div><b>${fmt(state.draft.length)} تغييرات قيد المراجعة</b><small>لم تُطبّق على Discord · ${esc(state.data?.guild.name)}</small></div><div class="actions"><button class="btn secondary" id="discardDraft">تجاهل التغييرات</button><button class="btn primary" id="reviewDraft">مراجعة التغييرات ←</button></div>`;
  $('#reviewDraft').onclick = () => reviewLocal();
  $('#discardDraft').onclick = () => confirmDialog('تجاهل التغييرات؟', 'ستُزال قائمة التغييرات من هذا الجهاز. لن يتغير سيرفرك في Discord.', 'تجاهل التغييرات', () => { state.draft = []; saveDraft(); closeDialog(); render(); });
}
function modal(title, body, footer = '') {
  const dialog = $('#dialog'); $('#dialogContent').innerHTML = `<div class="dialog-head"><h2 id="dialogTitle">${title}</h2><button class="icon-btn" id="closeDialog" aria-label="إغلاق">×</button></div><div class="dialog-body"><div class="dialog-error" id="dialogError" role="alert" hidden></div>${body}</div>${footer ? `<div class="dialog-foot">${footer}</div>` : ''}`;
  $('#dialogContent').querySelectorAll('.ai-discord-bot-name').forEach(node => { node.innerHTML = `◈ ${esc(state.aiBotName || 'ديسكوكو')} <small>BOT</small>`; });
  if (state.aiBotName) $('#dialogContent').querySelectorAll('.form-note').forEach(node => { node.textContent = node.textContent.replace('بواسطة بوت ديسكوكو', `بواسطة بوت ${state.aiBotName}`); });
  $('#closeDialog').onclick = closeDialog;
  installAiEmojiPickers();
  if (!dialog.open) dialog.showModal();
}
function closeDialog() { $('#dialog').querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; }); $('#dialog').close(); }
function modalError(error) { $('#dialogError').hidden = false; $('#dialogError').textContent = error.message; }
function confirmDialog(title, description, label, callback) { modal(title, `<p>${esc(description)}</p>`, `<button class="btn secondary" id="cancelConfirm">إلغاء</button><button class="btn primary" id="confirmAction">${label}</button>`); $('#cancelConfirm').onclick = closeDialog; $('#confirmAction').onclick = async event => { event.currentTarget.disabled = true; try { await callback(); } catch (error) { modalError(error); $('#confirmAction').disabled = false; } }; }
function shell() {
  $('#navigation').innerHTML = `<div class="nav-label">إدارة مجتمعك</div>${sections.map(([key, icon, label]) => `<a class="nav-link ${screen() === key ? 'active' : ''}" href="${url(key)}" ${screen() === key ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span>${label}${key === 'alerts' && state.data?.alerts?.length ? `<span class="badge bad">${fmt(state.data.alerts.length)}</span>` : ''}</a>`).join('')}`;
  const servers = state.account?.servers || [];
  $('#guildSelect').innerHTML = `<option value="">اختر سيرفرًا</option>${servers.map(guild => `<option value="${esc(guild.id)}" ${guild.id === state.guild ? 'selected' : ''}>${esc(guild.name)}</option>`).join('')}`;
  $('#guildSelect').disabled = !servers.length;
  $('#breadcrumb').textContent = sections.find(([key]) => key === screen())?.[2] || 'سيرفراتي';
  $('#connectionStatus').outerHTML = `<span id="connectionStatus" class="badge ${state.loading ? 'neutral' : statuses[state.data?.connection.status]?.[1] || 'neutral'}">${state.loading ? 'جارٍ التحقق' : statuses[state.data?.connection.status]?.[0] || 'اختر سيرفرًا'}</span>`;
  $('#lastSync').textContent = state.data ? `آخر تحقق: ${date(state.data.connection.checked_at)}` : '';
  document.title = `${$('#breadcrumb').textContent} — ${state.data?.guild.name || 'ديسكوكو'}`;
}
async function loadGuild() {
  const epoch = ++state.epoch; state.loading = true; state.error = null; state.data = null; render();
  try {
    if (!state.guild) { state.loading = false; render(); return; }
    if (!state.account.servers.some(guild => guild.id === state.guild)) throw Object.assign(Error('هذا السيرفر غير متاح لحسابك. اختر سيرفرًا من القائمة.'), { status: 403 });
    const data = await api(`/api/workspace/${encodeURIComponent(state.guild)}`);
    if (epoch !== state.epoch) return;
    state.data = data; readDraft();
    const guild = state.account.servers.find(item => item.id === state.guild); guild.name = data.guild.name; guild.connection = { install_status: data.connection.status };
  } catch (error) { if (epoch !== state.epoch) return; state.error = error; }
  if (epoch === state.epoch) { state.loading = false; render(); }
}
function render() {
  shell(); draftBar(); const area = $('#workspace');
  if (state.loading) { area.innerHTML = '<div class="loading" role="status">نحمّل بيانات سيرفرك…</div>'; return; }
  if (state.error) { area.innerHTML = head('تعذر فتح مساحة العمل', 'لم نغيّر حالة الربط أو بيانات سيرفرك.') + `<div class="panel">${empty('نحتاج خطوة للمتابعة', esc(state.error.message), `<div class="actions"><button class="btn primary" id="retry">إعادة المحاولة</button><a class="btn secondary" href="/account.html#servers">اختيار سيرفر آخر</a>${state.error.status === 401 ? `<a class="btn secondary" href="/auth/discord?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}">إعادة ربط الحساب</a>` : ''}</div>`)}</div>`; $('#retry').onclick = run(() => state.account ? loadGuild() : start()); return; }
  if (!state.guild || screen() === 'servers') { renderServers(); return; }
  const selected = screen();
  const pages = { overview: overview, alerts: alertsPage, builder: builder, 'ready-templates': readyTemplatesPage, bots: bots, commands: commands, assistant: assistant, automation: automation, analytics: analytics, activity: activity, settings: settings, safety: safety };
  Promise.resolve(pages[selected]?.()).catch(error => { if (screen() === selected) area.innerHTML = head('تعذر تحميل القسم', 'حاول مرة أخرى دون تغيير إعداداتك.') + `<div class="panel">${empty('البيانات غير متاحة الآن', esc(error.message), '<button class="btn primary" id="retrySection">إعادة المحاولة</button>')}</div>`; $('#retrySection')?.addEventListener('click', render); });
}
function renderServers() {
  $('#workspace').innerHTML = head('كل مجتمع يبدأ من هنا', 'اختر سيرفرك، وكل أدواته ستكون في مكان واحد.', '<a class="btn primary" href="/account.html#create">＋ تجهيز سيرفر جديد</a>') + `<div class="server-grid">${(state.account?.servers || []).map(guild => `<article class="server-card"><div class="server-title"><span class="server-image">${guild.icon ? `<img src="https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=96" alt="">` : esc(guild.name.slice(0, 1))}</span><div><h3>${esc(guild.name)}</h3><small>${guild.owner ? 'أنت مالك السيرفر' : 'لديك صلاحية الإدارة'}</small></div></div>${status(guild.connection?.install_status)}<br><a class="btn primary" href="${url(guild.connection?.install_status === 'installed' ? 'overview' : 'settings', guild.id)}">${guild.connection?.install_status === 'installed' ? 'فتح لوحة السيرفر' : 'إكمال الربط'} ←</a></article>`).join('') || empty('لا توجد سيرفرات قابلة للإدارة', 'أنشئ سيرفرًا في Discord أو تأكد من صلاحية إدارة السيرفر في حسابك.')}</div>`;
}
function connectionNotice() {
  const d = state.data; if (d.connection.status === 'installed' && d.connection.readable) return '';
  const messages = { install_required: 'اربط بوت ديسكوكو أو بوتك الخاص لتظهر القنوات والرتب وتبدأ إدارة سيرفرك.', permissions_insufficient: 'لم يتمكن البوت المختار من الوصول إلى السيرفر. راجع الربط والصلاحيات.', unavailable: 'تعذر الاتصال بـ Discord الآن. هذا لا يعني أن البوت غير مثبت.' };
  return `<div class="notice"><div><b>${messages[d.connection.status] || 'تعذر قراءة بعض بيانات السيرفر.'}</b><p>لن تتاح التعديلات حتى يكتمل التحقق من السيرفر.</p></div>${action('مراجعة الاتصال', 'settings')}</div>`;
}
function changeName(change) { return change.plan?.name || ({ gaming: 'قالب مجتمع ألعاب', support: 'قالب مركز دعم', study: 'قالب مساحة دراسة', custom: 'تعديلات القنوات والرتب' }[change.template_key]) || 'خطة تغييرات'; }
function changeRows(changes) { return changes.length ? `<div class="rows">${changes.map(change => `<div class="row"><span class="row-icon">≡</span><div class="row-main"><b>${esc(changeName(change))}</b><small>${date(change.updated_at)}</small></div>${status(change.status)}<button class="btn text" data-plan="${esc(change.id)}">عرض ←</button></div>`).join('')}</div>` : empty('لم تبدأ أي تغييرات بعد', 'عدّل القنوات أو اختر قالبًا، وستجد المراجعة والنتيجة هنا.', action('استكشف القنوات والرتب', 'builder')); }
function alertRows(items) {
  return `<div class="rows">${items.map(item => `<div class="row"><span class="row-icon">⚠</span><div class="row-main"><b>${esc(item.title)}</b><small>${esc(item.detail)}</small></div><div class="actions">${item.target ? action(item.target === 'automation' ? 'عرض الرسائل' : 'افتح الإعدادات', item.target, 'secondary') : ''}${item.channelId ? `<a class="btn secondary" href="https://discord.com/channels/${encodeURIComponent(state.guild)}/${encodeURIComponent(item.channelId)}" target="_blank" rel="noopener">افتح القناة ↗</a>` : ''}${item.kind === 'giveaway' && item.retryable ? `<button class="btn secondary" data-alert-retry="${esc(item.id)}">محاولة واحدة</button>` : ''}${item.kind === 'giveaway' && item.stoppable ? `<button class="btn danger" data-alert-pause="${esc(item.id)}">إيقاف المحاولات</button>` : ''}${item.kind === 'schedule' ? `<button class="btn secondary" data-alert-cancel="${esc(item.id)}">إلغاء المهمة</button>` : ''}${item.id && !item.stoppable ? `<button class="btn text" data-alert-dismiss="${esc(item.kind)}:${esc(item.id)}">إخفاء التنبيه</button>` : !item.id ? `<button class="btn text" data-alert-refresh>إعادة التحقق</button>` : ''}</div></div>`).join('')}</div>`;
}
function bindAlertActions() {
  document.querySelectorAll('[data-alert-dismiss]').forEach(button => { button.onclick = run(async () => { const [kind, id] = button.dataset.alertDismiss.split(':'); await api(`/api/workspace/${encodeURIComponent(state.guild)}/alerts/${kind}/${encodeURIComponent(id)}/dismiss`, { method: 'POST' }); await loadGuild(); }); });
  document.querySelectorAll('[data-alert-retry]').forEach(button => { button.onclick = () => confirmDialog('محاولة إعلان الجيف أوي؟', 'ستجرى محاولة واحدة فقط. إذا فشلت سيتوقف البوت مجددًا لحماية حسابه من التكرار.', 'محاولة واحدة', async () => { await api(`/api/workspace/${encodeURIComponent(state.guild)}/alerts/giveaway/${encodeURIComponent(button.dataset.alertRetry)}/retry`, { method: 'POST' }); closeDialog(); await loadGuild(); }); });
  document.querySelectorAll('[data-alert-pause]').forEach(button => { button.onclick = () => confirmDialog('إيقاف محاولات الجيف أوي؟', 'لن يحاول البوت تعديل رسالة هذا الجيف أوي تلقائيًا بعد الآن. ستبقى نتيجة السحب محفوظة.', 'إيقاف المحاولات', async () => { await api(`/api/workspace/${encodeURIComponent(state.guild)}/alerts/giveaway/${encodeURIComponent(button.dataset.alertPause)}/pause`, { method: 'POST' }); closeDialog(); await loadGuild(); }); });
  document.querySelectorAll('[data-alert-cancel]').forEach(button => { button.onclick = () => confirmDialog('إلغاء الرسالة المجدولة؟', 'لن تُرسل هذه المهمة لاحقًا. يمكنك إنشاء رسالة جديدة بعد مراجعة القناة.', 'إلغاء المهمة', async () => { await api(`/api/workspace/${encodeURIComponent(state.guild)}/schedules/${encodeURIComponent(button.dataset.alertCancel)}/cancel`, { method: 'POST' }); closeDialog(); await loadGuild(); }); });
  document.querySelectorAll('[data-alert-refresh]').forEach(button => { button.onclick = run(() => loadGuild()); });
}
function alertSummary() { const items = state.data.alerts || []; return items.length ? panel('تنبيهات تحتاج إجراء', alertRows(items.slice(0, 3)), action('عرض كل التنبيهات', 'alerts', 'text')) : ''; }
function alertsPage() {
  const items = state.data.alerts || [];
  $('#workspace').innerHTML = head('تنبيهات مجتمعك', 'المشاكل التي تحتاج متابعة، مع الإجراء المناسب لكل واحدة.', '<button class="btn secondary" id="refreshAlerts">تحديث الحالة ↻</button>') + (items.length ? panel(`${fmt(items.length)} تنبيهات تحتاج متابعة`, alertRows(items)) : panel('الحالة الحالية', empty('لا توجد تنبيهات نشطة', 'الاتصال والمهام التي نفحصها الآن لا تحتاج إجراءً.')));
  $('#refreshAlerts').onclick = run(() => loadGuild()); bindAlertActions();
}
function bindPlans() { document.querySelectorAll('[data-plan]').forEach(button => { button.onclick = run(() => showPlan(button.dataset.plan)); }); }
function overview() {
  const d = state.data; const channels = d.channels?.filter(channel => channel.type !== 4); const pending = d.changeSets.filter(change => change.status !== 'succeeded');
  $('#workspace').innerHTML = head('مجتمعك، تحت نظرك.', 'كل ما تحتاجه لتبني، تنظّم، وتتابع مجتمعك من مكان واحد.', `<a class="btn secondary" href="https://discord.com/channels/${encodeURIComponent(state.guild)}" target="_blank" rel="noopener">فتح Discord ↗</a>`) + connectionNotice() + `<section class="hero"><div><span class="eyebrow">مساحة ${esc(d.guild.name)}</span><h2>${pending.length ? 'لديك تغييرات تستحق المراجعة.' : 'خطوتك القادمة تصنع الفرق.'}</h2><p>${pending.length ? 'راجع ما جهزته لسيرفرك، وشاهد تفاصيل كل تغيير قبل تطبيقه.' : 'ابدأ بتنظيم قنواتك ورتبك، أو أضف قالبًا يناسب مجتمعك. كل تغيير يمر بمراجعتك أولًا.'}</p><div class="actions">${action(pending.length ? 'مراجعة التغييرات ←' : 'تنظيم السيرفر ←', pending.length ? 'activity' : 'builder', 'primary')}${action('إعداد البوت', 'bots')}</div></div><div class="hero-art" aria-hidden="true"><span>◈</span></div></section><div class="metrics">${metric('أعضاء المجتمع', d.members, 'العدد التقريبي من Discord', '♧')}${metric('القنوات', channels?.length, `${fmt(d.channels?.filter(channel => channel.type === 4).length)} تصنيفات`, '▤')}${metric('الرتب', d.roles?.length, 'بنية السيرفر الحالية', '◇')}${metric('بانتظار المراجعة', pending.length, 'مسودات وعمليات تحتاج متابعة', '≡')}</div><div class="section-title"><h3>ماذا تريد أن تنجز؟</h3><small>اختصارات ليوم أسهل</small></div><div class="quick-actions">${[['builder', '＋', 'رتّب مساحة مجتمعك', 'القنوات، الرتب، والقوالب'], ['automation', '◷', 'جهّز إعلانك القادم', 'رسالة تصل في الوقت المناسب'], ['analytics', '⌁', 'تعرّف على النشيطين', 'مؤشرات واضحة من مجتمعك']].map(([key, icon, title, sub]) => `<a class="quick-action" href="${url(key)}"><span class="quick-icon">${icon}</span><span><strong>${title}</strong><small>${sub}</small></span><em>←</em></a>`).join('')}</div><div class="grid-2">${panel('آخر التغييرات', changeRows(d.changeSets.slice(0, 4)), action('عرض الكل', 'activity', 'text'))}${panel('جاهزية مجتمعك', `<div class="rows"><div class="row"><span class="row-icon">◈</span><div class="row-main"><b>ربط السيرفر</b><small>آخر تحقق مباشر من Discord</small></div>${status(d.connection.status)}</div><div class="row"><span class="row-icon">⌁</span><div class="row-main"><b>تشغيل البوت</b><small>اتصال البوت بخدمة Discord</small></div>${badge(d.bot.online ? 'متصل' : 'غير متصل', d.bot.online ? 'good' : 'warn')}</div><div class="row"><span class="row-icon">▥</span><div class="row-main"><b>جمع إحصاءات النشاط</b><small>أعداد الرسائل دون محتواها</small></div>${badge(d.preferences.analytics_enabled ? 'مفعّل' : 'غير مفعّل', d.preferences.analytics_enabled ? 'good' : 'neutral')}</div></div><div class="panel-body">${action('إدارة الاتصال والإعدادات', 'settings', 'secondary')}</div>`)}</div>`;
  const summary = alertSummary();
  if (summary) $('#workspace .page-head')?.insertAdjacentHTML('afterend', summary);
  bindPlans(); bindAlertActions();
}
function builder() {
  const d = state.data; const labels = { channels: 'القنوات والتصنيفات', roles: 'الرتب' };
  $('#workspace').innerHTML = head('مساحة مرتبة. مجتمع أوضح.', 'ابدأ من البنية الموجودة، واحفظ تعديلاتك للمراجعة قبل تطبيقها.') + connectionNotice() + `<div class="tabs" role="tablist" aria-label="بنية السيرفر">${Object.entries(labels).map(([key, label]) => `<button role="tab" aria-selected="${state.tab === key}" class="tab ${state.tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}</div><div id="builderContent"></div>`;
  document.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => { state.tab = button.dataset.tab; builder(); }; });
  if (!d.connection.readable) { $('#builderContent').innerHTML = empty('ننتظر اكتمال الاتصال', 'بعد التحقق من الربط، ستظهر البنية الفعلية لسيرفرك.', action('إكمال الربط', 'settings', 'primary')); return; }
  const roles = state.tab === 'roles';
  $('#builderContent').innerHTML = `<div class="toolbar"><input class="search" id="resourceSearch" aria-label="بحث في العناصر" placeholder="ابحث بالاسم…"><div class="actions">${!roles ? '<button class="btn secondary" id="newCategory">＋ تصنيف</button>' : ''}<button class="btn primary" id="newResource">＋ ${roles ? 'رتبة جديدة' : 'قناة جديدة'}</button></div></div><section class="panel" id="resourceList"></section>`;
  function rows(term = '') {
    let html = '';
    if (roles) html = [...d.roles].sort((a, b) => b.position - a.position).filter(role => role.name.toLowerCase().includes(term)).map(role => `<div class="row"><span class="role-dot" style="--role-color:#${Number(role.color || 0xa8b0c8).toString(16).padStart(6, '0')}"></span><div class="row-main"><b>${esc(role.name)}</b><small>${role.managed ? 'يديرها تطبيق' : role.id === state.guild ? 'الرتبة العامة' : 'رتبة مخصصة'}</small></div>${role.managed || role.id === state.guild ? badge('رتبة نظام') : `<button class="btn small secondary" data-edit="${esc(role.id)}" data-kind="role">تعديل</button>`}</div>`).join('');
    else {
      const groups = [{ id: null, name: 'قنوات دون تصنيف' }, ...d.channels.filter(channel => channel.type === 4).sort((a, b) => a.position - b.position)];
      for (const group of groups) {
        const children = d.channels.filter(channel => channel.type !== 4 && (channel.parent_id || null) === group.id).sort((a, b) => a.position - b.position).filter(channel => `${channel.name} ${group.name}`.toLowerCase().includes(term));
        if (group.id === null && !children.length) continue;
        if (!children.length && term && !group.name.toLowerCase().includes(term)) continue;
        html += `<div class="tree-category"><span>⌄ ${esc(group.name)} <small>· ${fmt(children.length)}</small></span>${group.id ? `<button class="btn text" data-edit="${esc(group.id)}" data-kind="category">تعديل</button>` : ''}</div>`;
        html += children.map(channel => `<div class="row tree-channel"><span class="row-icon">${channel.type === 2 ? '◖' : '#'}</span><div class="row-main"><b>${esc(channel.name)}</b><small>${channel.type === 2 ? 'قناة صوتية' : channel.type === 0 ? 'قناة نصية' : 'قناة Discord'}</small></div><button class="btn small secondary" data-edit="${esc(channel.id)}" data-kind="channel">تعديل</button></div>`).join('');
      }
    }
    $('#resourceList').innerHTML = html || empty('لا توجد نتائج', 'جرّب اسمًا آخر أو أضف عنصرًا جديدًا.');
    document.querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => editResource(button.dataset.kind, button.dataset.edit); });
  }
  rows(); $('#resourceSearch').oninput = event => rows(event.target.value.trim().toLowerCase());
  $('#newResource').onclick = () => editResource(roles ? 'role' : 'channel');
  $('#newCategory')?.addEventListener('click', () => editResource('category'));
}
function editResource(kind, id) {
  const original = (kind === 'role' ? state.data.roles : state.data.channels).find(item => item.id === id);
  const existing = state.draft.find(item => item.resource_id === id && id);
  const item = { ...original, ...existing };
  const label = { role: 'الرتبة', channel: 'القناة', category: 'التصنيف' }[kind];
  modal(`${id ? 'تعديل' : 'إضافة'} ${label}`, `<form id="resourceForm" class="form-grid"><label>الاسم<input id="resourceName" required maxlength="100" value="${esc(item.name || '')}" placeholder="اكتب اسمًا واضحًا"></label>${kind === 'channel' ? `${!id ? '<label>نوع القناة<select id="resourceType"><option value="0">قناة نصية</option><option value="2">قناة صوتية</option><option value="15">منتدى</option></select></label>' : ''}<label>التصنيف<select id="resourceParent"><option value="">دون تصنيف</option>${state.data.channels.filter(channel => channel.type === 4).map(channel => `<option value="${esc(channel.id)}" ${item.parent_id === channel.id ? 'selected' : ''}>${esc(channel.name)}</option>`).join('')}</select></label><label>الترتيب<input id="resourcePosition" type="number" min="0" max="500" value="${Number(item.position || 0)}"></label>${(item.type ?? 0) !== 2 ? `<label>وصف القناة<textarea id="resourceTopic" maxlength="1024" rows="3" placeholder="اشرح هدف القناة للأعضاء">${esc(item.topic || '')}</textarea></label>` : ''}` : ''}${kind === 'role' ? `<label>ترتيب الرتبة<input id="resourcePosition" type="number" min="1" max="500" value="${Number(item.position || 1)}"></label><label>لون الرتبة<input id="resourceColor" type="color" value="#${Number(item.color || 0x99aab5).toString(16).padStart(6, '0')}"></label>` : ''}<p class="form-note">سيُضاف هذا التعديل إلى قائمة المراجعة. لن يتغير شيء في Discord حتى تراجع وتؤكد التطبيق.</p></form>`, '<button class="btn secondary" id="cancelEdit">إلغاء</button><button class="btn primary" type="submit" form="resourceForm">إضافة للمراجعة</button>');
  $('#cancelEdit').onclick = closeDialog;
  $('#resourceForm').onsubmit = event => {
    event.preventDefault(); const name = $('#resourceName').value.trim(); if (!name) return;
    const op = { resource_type: kind, action: id ? 'update' : 'create', name, ...(id ? { resource_id: id, before: { name: original.name } } : {}) };
    if (kind === 'channel') { op.parent_id = $('#resourceParent').value || null; if (!id) op.type = Number($('#resourceType').value); if ($('#resourceTopic')) op.topic = $('#resourceTopic').value.trim() || null; }
    if (kind === 'role') op.color = parseInt($('#resourceColor').value.slice(1), 16);
    if (existing) state.draft[state.draft.indexOf(existing)] = op; else state.draft.push(op);
    saveDraft(); closeDialog(); toast('أُضيف التعديل إلى مسودتك.');
  };
}
async function renderTemplates() {
  state.templates ||= (await api('/api/workspace-templates')).templates;
  if (screen() !== 'builder' || state.tab !== 'templates') return;
  $('#builderContent').innerHTML = `<div class="notice info"><div><b>ابدأ بهيكل جاهز، واحتفظ بما بنيته.</b><p>القوالب تضيف العناصر الناقصة فقط. راجع أسماء القنوات والرتب قبل إنشاء الخطة.</p></div></div><div class="template-grid">${state.templates.map((template, index) => `<article class="template"><div class="template-icon">${['🎮', '🛟', '📚'][index] || '◇'}</div><h3>${esc(template.name)}</h3><p>${fmt(template.categories.length)} تصنيفات · ${fmt(template.operations.filter(op => op.resource_type === 'channel').length)} قنوات · ${fmt(template.roles.length)} رتب</p><button class="btn secondary" data-template="${esc(template.key)}">معاينة القالب ←</button></article>`).join('')}</div>`;
  document.querySelectorAll('[data-template]').forEach(button => { button.onclick = () => {
    const template = state.templates.find(item => item.key === button.dataset.template);
    modal(esc(template.name), `<p class="form-note">ستُعاد الاستفادة من العناصر المطابقة في التصنيف نفسه. لن تُحذف قنوات أو رتب.</p>${operationTable(template.operations)}`, `<button class="btn primary" id="createTemplate" ${!state.data.connection.readable ? 'disabled' : ''}>حفظ خطة للمراجعة</button>`);
    $('#createTemplate').onclick = async event => { event.currentTarget.disabled = true; try { const created = await api('/api/change-sets', { method: 'POST', body: JSON.stringify({ guildId: state.guild, templateKey: template.key }) }); closeDialog(); await loadGuild(); await showPlan(created.changeSet.id); } catch (error) { modalError(error); $('#createTemplate').disabled = false; } };
  }; });
}
function operationTable(operations, removable = false) {
  const names = new Map(operations.map(op => [op.operation_key, op.name]));
  return `<div class="table-wrap"><table><thead><tr><th>الإجراء</th><th>العنصر والتغيير</th>${removable ? '<th>إزالة</th>' : ''}</tr></thead><tbody>${operations.map((op, index) => `<tr><td>${badge(op.action === 'update' ? 'تعديل' : 'إضافة / مطابقة', op.action === 'update' ? 'warn' : 'purple')}</td><td><b>${esc(op.name)}</b><small>${{ channel: op.type === 2 ? 'قناة صوتية' : op.type === 15 ? 'منتدى' : 'قناة', category: 'تصنيف', role: 'رتبة' }[op.resource_type] || ''}${op.before?.name && op.before.name !== op.name ? ` · <span class="before">${esc(op.before.name)}</span> ← <span class="after">${esc(op.name)}</span>` : ''}${op.parent_key ? ` · التصنيف: ${esc(names.get(op.parent_key) || op.parent_name || '')}` : Object.hasOwn(op, 'parent_id') ? ` · التصنيف: ${esc(state.data.channels?.find(c => c.id === op.parent_id)?.name || 'دون تصنيف')}` : ''}${Object.hasOwn(op, 'color') ? ` · اللون: #${Number(op.color).toString(16).padStart(6, '0')}` : ''}${op.access === 'read_only' ? ' · للقراءة فقط' : op.access === 'staff_only' ? ` · خاصة برتبة ${esc(state.data.roles?.find(role => role.id === op.staff_role_id)?.name || 'فريق محدد')}` : ''}</small></td>${removable ? `<td><button class="btn text" data-remove="${index}" aria-label="إزالة ${esc(op.name)} من قائمة المراجعة">×</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function reviewLocal() {
  modal('مراجعة مسودتك', `<p class="form-note">السيرفر المستهدف: <b>${esc(state.data.guild.name)}</b>. حفظ الخطة لا يطبق التغييرات.</p>${operationTable(state.draft, true)}`, '<button class="btn primary" id="savePlan">حفظ خطة التغييرات</button>');
  document.querySelectorAll('[data-remove]').forEach(button => { button.onclick = () => { state.draft.splice(Number(button.dataset.remove), 1); saveDraft(); if (state.draft.length) reviewLocal(); else closeDialog(); }; });
  $('#savePlan').onclick = async event => { event.currentTarget.disabled = true; try { const created = await api('/api/change-sets', { method: 'POST', body: JSON.stringify({ guildId: state.guild, operations: state.draft }) }); state.draft = []; saveDraft(); closeDialog(); await loadGuild(); await showPlan(created.changeSet.id); } catch (error) { modalError(error); $('#savePlan').disabled = false; } };
}
async function showPlan(id, returnToWorkspace = false) {
  const expectedGuild = state.guild;
  const data = await api(`/api/change-sets/${encodeURIComponent(id)}`);
  if (state.guild !== expectedGuild || data.changeSet.guild_id !== state.guild) throw Error('هذه الخطة تخص سيرفرًا آخر.');
  const done = data.operations.filter(op => op.status === 'succeeded').length;
  const complete = data.changeSet.status === 'succeeded';
  modal('مراجعة التغييرات', `<div class="notice info"><div><b>${esc(state.data.guild.name)}</b><p>${fmt(done)} من ${fmt(data.operations.length)} عمليات مكتملة. ${complete ? 'اكتمل التطبيق.' : 'سيُنفّذ غير المكتمل فقط.'}</p></div>${status(data.changeSet.status)}</div>${operationTable(data.changeSet.plan.operations)}<div class="rows">${data.operations.map(op => `<div class="row"><div class="row-main"><b>${esc(data.changeSet.plan.operations.find(item => item.operation_key === op.operation_key)?.name || op.operation_key)}</b>${op.result?.error ? `<small>${esc(op.result.error)}</small>` : ''}</div>${status(op.status)}</div>`).join('')}</div>${!complete && !returnToWorkspace ? '<label class="check-row"><input type="checkbox" id="confirmApply">راجعت التغييرات وأوافق على تطبيقها على هذا السيرفر.</label>' : ''}`, complete ? '<button class="btn primary" id="donePlan">تم</button>' : `<button class="btn secondary" id="laterPlan">لاحقًا</button><button class="btn primary" id="applyPlan" ${returnToWorkspace && state.data.connection.readable ? '' : 'disabled'}>نعم، أؤكد التنفيذ</button>`);
  if (complete) { $('#donePlan').onclick = closeDialog; return; }
  $('#laterPlan').onclick = closeDialog;
  if (!returnToWorkspace) $('#confirmApply').onchange = event => { $('#applyPlan').disabled = !event.target.checked || !state.data.connection.readable; };
  $('#applyPlan').onclick = async event => {
    event.currentTarget.disabled = true; event.currentTarget.textContent = 'جارٍ التطبيق…'; $('#closeDialog').disabled = true; $('#laterPlan').disabled = true;
    try { await api(`/api/change-sets/${encodeURIComponent(id)}/apply`, { method: 'POST', body: JSON.stringify({ confirmed: true, guildId: state.guild }) }); closeDialog(); await loadGuild(); if (!returnToWorkspace) await showPlan(id); toast('اكتملت التغييرات على سيرفرك وسُجلت في سجل التغييرات.'); }
    catch (error) { closeDialog(); await loadGuild(); await showPlan(id, returnToWorkspace); modalError(error); }
  };
}
const botPresets = [
  { kind: 'general', icon: '◈', title: 'بوت عام', description: 'هوية خاصة لمجتمعك؛ اختر أوامره بعد ربط تطبيق Discord.', commands: [['help', 'المساعدة'], ['rules', 'القوانين'], ['info', 'معلومات السيرفر']] },
  { kind: 'games', icon: '♟', title: 'بوت ألعاب', description: 'مساحة لأوامر الألعاب والتحديات والنقاط بعد تشغيل البوت الخاص.', commands: [['dice', 'رمي النرد'], ['coin', 'عملة عشوائية'], ['trivia', 'أسئلة سريعة']] },
  { kind: 'music', icon: '♫', title: 'بوت موسيقى', description: 'تصميم بوت صوتي خاص؛ تشغيل الموسيقى يحتاج عامل صوت وربط مصدر مسموح.', commands: [['play', 'تشغيل'], ['skip', 'تخطي'], ['queue', 'قائمة التشغيل'], ['stop', 'إيقاف']] },
  { kind: 'welcome', icon: '✦', title: 'بوت ترحيب', description: 'جهّز رسائل الاستقبال وأوامر تعريف الأعضاء.', commands: [['welcome', 'الترحيب'], ['rules', 'القوانين'], ['roles', 'الرتب']] },
  { kind: 'moderation', icon: '◇', title: 'بوت إشراف', description: 'خطط لأوامر الإشراف مع مراجعة الصلاحيات قبل التشغيل.', commands: [['warn', 'تحذير'], ['mute', 'كتم مؤقت'], ['logs', 'السجل']] },
  { kind: 'assistant', icon: '✧', title: 'بوت ذكاء اصطناعي', description: 'مساعد منفصل لسيرفرك. يحتاج ربط جهاز الذكاء الاصطناعي أولًا.', commands: [['ask', 'اسأل المساعد'], ['plan', 'خطط لتعديل السيرفر']] },
];
async function bots() {
  const guild = state.guild, epoch = state.epoch;
  $('#workspace').innerHTML = head('تصاميم بوتاتك', 'هذه مسودات لهوية البوت وأوامره؛ تشغيل بوتك الخاص يتم من إعدادات السيرفر.') + '<div class="loading" role="status">جارٍ تحميل بوتاتك…</div>';
  const { bots: items } = await api(`/api/custom-bots?guildId=${encodeURIComponent(guild)}`);
  if (guild !== state.guild || epoch !== state.epoch || screen() !== 'bots') return;
  const capacity = state.account?.usage?.customBots || { used: items.length, limit: state.account?.limits?.customBots || 1 };
  const available = capacity.used < capacity.limit;
  const free = (state.account?.limits?.plan || state.account?.user?.plan) === 'free';
  const cards = items.map(bot => {
    const preset = botPresets.find(item => item.kind === bot.definition?.kind) || botPresets[0];
    return `<article class="server-card bot-instance"><div class="server-title"><span class="server-image">${preset.icon}</span><div class="row-main"><h3>${esc(bot.name)}</h3><small>${esc(preset.title)} · ${esc(state.data.guild.name)}</small></div>${badge('تصميم محفوظ', 'purple')}</div><p class="form-note">${esc(bot.description || preset.description)}</p><div class="bot-command-tags">${(bot.definition?.commands || []).map(key => `<span>/${esc(key)}</span>`).join('') || '<small>لا أوامر مختارة</small>'}</div><div class="notice info"><div><b>خطوة الربط التالية</b><p>أنشئ تطبيق البوت في Discord Developer Portal باسمك. الربط والتشغيل المستقل سيظهران هنا بعد تجهيز عامل البوتات؛ هذا التصميم لم يُثبت في Discord بعد.</p></div></div><div class="actions"><button class="btn secondary" data-edit-bot="${bot.id}">تعديل التصميم</button><a class="btn text" href="https://discord.com/developers/applications" target="_blank" rel="noopener">فتح بوابة Discord ↗</a></div></article>`;
  }).join('');
  $('#workspace').innerHTML = head('تصاميم بوتاتك', 'احفظ فكرة بوتك هنا. لربط بوت يعمل فعليًا، انتقل إلى إعدادات السيرفر واختر بوتك الخاص.') + connectionNotice() + `<div class="notice info"><div><b>${fmt(capacity.used)} من ${fmt(capacity.limit)} تصاميم بوت في باقتك</b><p>Free: 1 · Starter: 5 · Growth: 10 · Business: 20. إنشاء التطبيق وربطه وتشغيله خطوات منفصلة.</p></div>${!available ? '<a class="btn secondary" href="/account.html#subscription">عرض الباقات</a>' : ''}</div><div class="section-title"><h3>مسودات هذا السيرفر</h3><small>المسودة لا تنشئ تطبيق Discord تلقائيًا</small></div><div class="server-grid">${cards || `<div class="panel">${empty('لم تصمم بوتًا لهذا السيرفر بعد', 'اختر نوعًا من البوتات الجاهزة أدناه وسمّه باسم مجتمعك.')}</div>`}</div><div class="section-title"><h3>اختر فكرة لتصميم بوت</h3><small>للتخطيط فقط؛ ربط البوت العامل يتم من إعدادات السيرفر</small></div><div class="server-grid bot-gallery">${botPresets.map(preset => `<article class="server-card bot-preset"><div class="server-title"><span class="server-image">${preset.icon}</span><div><h3>${preset.title}</h3><small>${preset.kind === 'assistant' && free ? 'يتطلب Starter أو أعلى' : 'تصميم قابل للتخصيص'}</small></div></div><p>${preset.description}</p><button class="btn ${preset.kind === 'assistant' ? 'secondary' : 'primary'}" data-create-bot="${preset.kind}" ${!available ? 'disabled' : ''}>${!available ? 'وصلت لحد الباقة' : preset.kind === 'assistant' && free ? 'ترقية الباقة' : 'اختيار هذا النوع'}</button></article>`).join('')}</div>`;
  document.querySelectorAll('[data-create-bot]').forEach(button => button.onclick = () => {
    const preset = botPresets.find(item => item.kind === button.dataset.createBot);
    if (preset.kind === 'assistant' && free) { location.href = '/account.html#subscription'; return; }
    modal(`تصميم ${preset.title}`, `<form id="createBotForm" class="form-grid"><p>${esc(preset.description)}</p><label>اسم البوت<input id="newBotName" maxlength="80" required value="${esc(state.data.guild.name)} — ${esc(preset.title)}"></label><label>وصفه المختصر<textarea id="newBotDescription" maxlength="300" rows="3">${esc(preset.description)}</textarea></label><p class="form-note">سيُحفظ التصميم في حسابك فقط. تركيب تطبيق Discord وتشغيله يأتيان بعد إكمال الربط.</p><button class="btn primary" type="submit">حفظ التصميم</button></form>`);
    $('#createBotForm').onsubmit = run(async event => { event.preventDefault(); const submit = event.submitter; submit.disabled = true; try { await api('/api/custom-bots', { method: 'POST', body: JSON.stringify({ guildId: guild, kind: preset.kind, name: $('#newBotName').value, description: $('#newBotDescription').value }) }); if (state.account?.usage?.customBots) state.account.usage.customBots.used++; closeDialog(); await bots(); toast('حُفظ تصميم البوت في حسابك.'); } finally { submit.disabled = false; } });
  });
  document.querySelectorAll('[data-edit-bot]').forEach(button => button.onclick = () => {
    const bot = items.find(item => String(item.id) === button.dataset.editBot);
    const preset = botPresets.find(item => item.kind === bot.definition?.kind) || botPresets[0];
    modal('تعديل تصميم البوت', `<form id="editBotForm" class="form-grid"><label>اسم البوت<input id="editBotName" maxlength="80" required value="${esc(bot.name)}"></label><label>وصف البوت<textarea id="editBotDescription" maxlength="300" rows="3">${esc(bot.description)}</textarea></label><div><b>أوامر هذا النوع</b>${preset.commands.map(([key, label]) => `<label class="check-row"><input class="custom-command" type="checkbox" value="${key}" ${(bot.definition?.commands || []).includes(key) ? 'checked' : ''}> /${key} · ${label}</label>`).join('')}</div><p class="form-note">هذه أوامر التصميم. لا تُسجّل في Discord حتى يكتمل ربط البوت وتشغيله.</p><button class="btn primary" type="submit">حفظ التعديل</button></form>`);
    $('#editBotForm').onsubmit = run(async event => { event.preventDefault(); const submit = event.submitter; submit.disabled = true; try { await api(`/api/custom-bots/${bot.id}`, { method: 'PUT', body: JSON.stringify({ name: $('#editBotName').value, description: $('#editBotDescription').value, commands: [...document.querySelectorAll('.custom-command:checked')].map(input => input.value) }) }); closeDialog(); await bots(); toast('تحدّث تصميم البوت.'); } finally { submit.disabled = false; } });
  });
}
async function prepareAiImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw Error('اختر صورة PNG أو JPG أو WebP أصغر من 10 ميجابايت.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  for (const quality of [0.82, 0.68, 0.5]) {
    const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    if (data.length < 460000) return { mime: 'image/jpeg', base64: data };
  }
  throw Error('الصورة كبيرة جدًا بعد الضغط. اختر صورة أصغر.');
}
function readyCounts(definition) { const categories = definition.categories.length, channels = definition.categories.reduce((n, group) => n + group.channels.length, 0), roles = definition.roles.length, features = ['welcome','ticket'].filter(kind => definition.features?.[kind]?.enabled).length + (definition.features?.logs?.enabled ? definition.features.logs.mode === 'routed' ? (definition.features.logs.routes || []).length : 1 : 0); return { categories, channels, roles, features, units: categories + channels + features }; }
function readyPreview(definition) {
  const roleNames = new Map(definition.roles.map(role => [role.key, role.name]));
  return `<div class="ready-discord" dir="rtl"><aside><strong>✦ ${esc(state.data.guild.name)}</strong>${definition.categories.map(group => `<div class="ready-discord-category"><b>⌄ ${esc(group.name)}</b>${group.channels.map(channel => `<div class="ready-discord-channel"><span>${channel.type === 2 ? '◖' : '#'}</span>${esc(channel.name)}${channel.access === 'private' ? '<small>🔒</small>' : ''}</div>`).join('')}</div>`).join('')}</aside><main><b>معاينة القنوات والبطاقات</b><p>شكل تقريبي داخل Discord؛ سيستخدم السيرفر اسمه وصورته الحقيقيين.</p>${definition.features?.welcome?.enabled ? `<div class="ready-preview-card" style="--ready-accent:${esc(definition.features.welcome.color || '#8d72e8')}">${definition.features.welcome.banner?.base64 ? `<img class="ready-banner" src="data:${esc(definition.features.welcome.banner.mime)};base64,${esc(definition.features.welcome.banner.base64)}" alt="صورة الترحيب">` : ''}<strong>${esc(definition.features.welcome.title)}</strong><p>${esc(definition.features.welcome.description.replaceAll('{member}', '@عضو جديد'))}</p><small>في #${esc(definition.categories.flatMap(group => group.channels).find(channel => channel.key === definition.features.welcome.channelKey)?.name || '')} · صورة العضو ${esc({ left: 'يسارًا', right: 'يمينًا', top: 'فوق النص' }[definition.features.welcome.avatarPosition] || 'يمينًا')}</small></div>` : ''}${definition.features?.ticket?.enabled ? `<div class="ready-preview-card"><strong>${esc(definition.features.ticket.title)}</strong><p>${esc(definition.features.ticket.description)}</p><button class="btn small primary" disabled>فتح تذكرة دعم</button></div>` : ''}<div class="ready-role-list"><b>الرتب وصلاحياتها</b>${definition.roles.map(role => `<span><i style="background:#${Number(role.color).toString(16).padStart(6, '0')}"></i>${esc(role.name)} <small>${esc(role.preset === 'moderator' ? 'إشراف محدود' : role.preset === 'support' ? 'دعم' : 'عضو')}</small></span>`).join('')}</div><p class="form-note">القنوات الخاصة لا يراها إلا أعضاء رتبة ${esc([...roleNames.values()].join('، '))} بحسب اختيارك. القنوات النصية للقراءة فقط تمنع رسائل الأعضاء.</p></main></div>`;
}
function readyDecoratePreview() {
  const [card, ticketCard] = document.querySelectorAll('#readyPreview .ready-preview-card');
  const welcome = state.readyDraft.features.welcome;
  if (card && welcome?.enabled) {
    const avatar = document.createElement('span'); avatar.className = `ready-avatar ready-avatar-${welcome.avatarPosition || 'right'}`; avatar.textContent = 'ع'; avatar.setAttribute('aria-label', 'صورة العضو الجديد');
    const banner = card.querySelector('.ready-banner');
    if (welcome.composite && banner) {
      const composite = document.createElement('div'); composite.className = 'ready-image-composite';
      banner.replaceWith(composite); composite.append(banner, avatar);
      const x = { left: 15.4, center: 50, right: 84.6 }[welcome.avatarPosition] || 84.6;
      avatar.style.left = `${x}%`; avatar.style.top = `${Number(welcome.avatarVertical ?? 50)}%`;
      avatar.style.setProperty('--avatar-size', `${Number(welcome.avatarRadius ?? 95) / 6}%`);
    } else { card.prepend(avatar); if (banner && welcome.bannerPosition !== 'above') card.append(banner); }
  }
  const support = state.readyDraft.features.ticket;
  const supportCard = welcome?.enabled ? ticketCard : card;
  if (supportCard && support?.enabled) {
    supportCard.style.setProperty('--ready-accent', support.color || '#8d72e8');
    const button = supportCard.querySelector('button'); if (button) button.textContent = support.buttonLabel || 'فتح تذكرة دعم';
    if (support.banner?.base64) {
      const image = document.createElement('img'); image.className = support.imageStyle === 'logo' ? 'ready-banner ready-support-logo' : 'ready-banner'; image.alt = 'صورة لوحة الدعم'; image.src = `data:${support.banner.mime};base64,${support.banner.base64}`;
      if (support.bannerPosition === 'above') supportCard.prepend(image); else supportCard.append(image);
    }
  }
  for (const [kind, source] of [['welcome', welcome?.enabled ? card : null], ['ticket', support?.enabled ? supportCard : null]]) {
    const local = $(`#ready-${kind}-inline-preview`);
    if (!local) continue;
    local.replaceChildren();
    const title = document.createElement('strong'); title.textContent = kind === 'welcome' ? 'معاينة الترحيب المباشرة' : 'معاينة لوحة الدعم المباشرة';
    local.append(title);
    if (source) local.append(source.cloneNode(true));
    else { const note = document.createElement('p'); note.textContent = 'فعّل هذا القسم لتظهر معاينته هنا.'; local.append(note); }
  }
  const logs = state.readyDraft.features.logs;
  if (logs?.enabled) {
    const channels = state.readyDraft.categories.flatMap(group => group.channels);
    const name = key => channels.find(channel => channel.key === key)?.name || 'قناة محذوفة';
    const box = document.createElement('div'); box.className = 'ready-log-preview';
    const heading = document.createElement('strong'); heading.textContent = 'مسار سجلات النشاط'; box.append(heading);
    const rules = logs.mode === 'routed' ? (logs.routes || []).map(rule => ({ sources: (rule.sourceKeys || []).map(name), target: name(rule.targetKey) })) : [{ sources: ['جميع القنوات'], target: name(logs.channelKey) }];
    for (const rule of rules) {
      const row = document.createElement('p'); row.textContent = `${rule.sources.join('، ') || 'اختر قناة مصدر'} ← #${rule.target}`; box.append(row);
    }
    const note = document.createElement('small'); note.textContent = `${(logs.events || []).length || 6} أنواع أحداث · دون نص الرسائل`; box.append(note);
    document.querySelector('#readyPreview .ready-discord main')?.append(box);
  }
}
function readySelectOptions(items, chosen) { return items.map(item => `<option value="${esc(item.key)}" ${item.key === chosen ? 'selected' : ''}>${esc(item.name)}</option>`).join(''); }
async function readyTemplatesPage() {
  const epoch = state.epoch, guild = state.guild;
  $('#workspace').innerHTML = head('قوالب جاهزة لسيرفرك', 'اختر قالبًا، عدّل كل تفاصيله، ثم شاهد الفرق قبل أن يلمس البوت سيرفرك.') + '<div class="loading">نحمّل القوالب…</div>';
  const [catalog, runs, connected] = await Promise.all([state.readyCatalog ? Promise.resolve({ templates: state.readyCatalog }) : api('/api/ready-templates'), api(`/api/workspace/${encodeURIComponent(guild)}/ready-templates/runs`), api(`/api/ai/bot-connection?guildId=${encodeURIComponent(guild)}`)]);
  state.readyCatalog = catalog.templates;
  state.readyRuns = runs.runs || [];
  state.readyCustomBot = connected.bot;
  if (epoch !== state.epoch || guild !== state.guild || screen() !== 'ready-templates') return;
  renderReadyEditor();
}
function readyStart(template) {
  state.readyKey = template.key;
  state.readyDraft = structuredClone(template.definition);
  state.readyMode = 'add';
  state.readyExecutor = state.readyCustomBot?.online ? 'custom' : 'diskoko';
  state.readyTicketDesignFile = null;
  state.readyTicketLogoFile = null;
  renderReadyEditor();
}
function readyDraftUpdate(field, value) {
  const path = field.dataset.readyField?.split('.'); if (!path) return;
  let target = state.readyDraft;
  for (const part of path.slice(0, -1)) target = target[part];
  const key = path.at(-1);
  target[key] = field.type === 'checkbox' ? field.checked : field.type === 'number' || key === 'type' ? Number(value) : value;
  const preview = $('#readyPreview'); if (preview) { preview.innerHTML = readyPreview(state.readyDraft); readyDecoratePreview(); }
  const counts = $('#readyCounts'); if (counts) { const c = readyCounts(state.readyDraft); counts.textContent = `${fmt(c.units)} متغيرًا · ${fmt(c.categories)} تصنيفات · ${fmt(c.channels)} قنوات · ${fmt(c.roles)} رتب`; }
  const note = $('.ready-unit-note'); if (note) { const c = readyCounts(state.readyDraft); note.textContent = `الاستهلاك المتوقع: ${fmt(c.units)} متغيرًا = ${fmt(c.categories)} تصنيفات + ${fmt(c.channels)} قنوات + ${fmt(c.features)} تشغيل تلقائي. الرتب لا تُحتسب. يُخصم عند بدء التنفيذ.`; }
}
function readyNewKey(prefix) { return `${prefix}-${Math.random().toString(36).slice(2, 9)}`; }
function botHierarchyNotice(context) {
  return `<div class="notice info bot-hierarchy-notice" role="note"><div><b>⚠ قبل ${context}: تأكد من صلاحيات البوت وترتيب رتبته</b><p>افتح Discord ← إعدادات السيرفر ← الرتب، وارفع رتبة <strong>البوت الذي اخترته للتنفيذ</strong> فوق الرتب التي سيُنشئها أو يعدّلها أو يحذفها. للتنصيب أو الاستبدال يحتاج إدارة القنوات وإدارة الرتب؛ ولنشر بطاقات الترحيب والدعم يحتاج أيضًا عرض القنوات وإرسال الرسائل والروابط المضمنة.</p><p>يمكن منح بوت موثوق صلاحية <strong>Administrator</strong> إذا أردت إعدادًا شاملًا، لكنها صلاحية واسعة واختيارية، ولا تُغني عن رفع رتبته فوق الرتب المستهدفة.</p><a href="https://support.discord.com/hc/en-us/articles/214836687-Discord-Roles-and-Permissions" target="_blank" rel="noopener noreferrer">شرح الرتب والصلاحيات في Discord ↗</a></div></div>`;
}
function renderReadyEditor() {
  if (screen() !== 'ready-templates') return;
  const templates = state.readyCatalog || [];
  const cards = `<div class="template-grid">${templates.map(template => { const c = readyCounts(template.definition); return `<article class="template ${state.readyKey === template.key ? 'selected' : ''}"><div class="template-icon">${template.icon}</div><h3>${esc(template.name)}</h3><p>${esc(template.description)}</p><small>${fmt(c.units)} متغيرًا · ${fmt(c.categories)} تصنيفات · ${fmt(c.channels)} قنوات · ${fmt(c.roles)} رتب</small><div class="actions"><button class="btn ${state.readyKey === template.key ? 'primary' : 'secondary'}" data-ready-choose="${esc(template.key)}">${state.readyKey === template.key ? 'إعادة تحميل الأصل' : 'اختيار وتعديل'}</button>${template.source ? `<a class="btn text" target="_blank" rel="noopener" href="${esc(template.source)}">المصدر ↗</a>` : ""}</div></article>`; }).join('')}</div>`;
  const d = state.readyDraft;
  if (!d) {
    $('#workspace').innerHTML = head('قوالب جاهزة لسيرفرك', 'أربعة قوالب مختلفة للتجربة؛ عدّل الهيكل والرتب ثم اختر التنصيب أو الاستبدال.') + connectionNotice() + cards + panel('قبل التطبيق', '<p class="panel-body">التنصيب يحتفظ بالموجود. الاستبدال ينشئ الهيكل الجديد أولًا، ثم يحذف العناصر القديمة القابلة للحذف بعد مراجعتك الدقيقة. حذف القنوات يحذف تاريخ رسائلها من Discord.</p>');
  } else {
    const channels = d.categories.flatMap(group => group.channels).filter(channel => channel.type === 0);
    const roleOptions = readySelectOptions(d.roles, '');
    const channelOptions = readySelectOptions(channels, '');
    const c = readyCounts(d);
    $('#workspace').innerHTML = head('قوالب جاهزة لسيرفرك', 'عدّل الأسماء والترتيب والصلاحيات والميزات، ثم راجع الفروق والتطبيق.') + connectionNotice() + cards + `<div class="ready-layout"><section class="panel ready-editor"><div class="panel-head"><h3>تفاصيل القالب</h3><span id="readyCounts" class="badge purple">${fmt(c.categories)} تصنيفات · ${fmt(c.channels)} قنوات · ${fmt(c.roles)} رتب</span></div><div class="panel-body"><label>اسم القالب في مراجعتك<input data-ready-field="name" maxlength="100" value="${esc(d.name)}"></label><h3>الرتب</h3><p class="form-note">لا يمنح أي قالب صلاحية Administrator. الرتب الإدارية محدودة للإشراف ويمكن تعديلها قبل التنفيذ.</p>${d.roles.map((role, i) => `<div class="ready-edit-row"><input aria-label="اسم الرتبة" data-ready-field="roles.${i}.name" maxlength="100" value="${esc(role.name)}"><select aria-label="صلاحيات الرتبة" data-ready-field="roles.${i}.preset">${[['member','عضو'],['vip','مميز'],['support','دعم'],['moderator','إشراف محدود']].map(([value,label]) => `<option value="${value}" ${role.preset === value ? 'selected' : ''}>${label}</option>`).join('')}</select><input aria-label="لون الرتبة" type="color" data-ready-field="roles.${i}.color" value="#${Number(role.color).toString(16).padStart(6, '0')}"><button class="btn text" data-ready-remove="role:${i}" title="إزالة الرتبة">×</button></div>`).join('')}<button class="btn secondary" data-ready-add="role">＋ رتبة</button><h3>التصنيفات والقنوات</h3>${d.categories.map((group, gi) => `<section class="ready-group"><div class="ready-group-head"><input aria-label="اسم التصنيف" data-ready-field="categories.${gi}.name" maxlength="100" value="${esc(group.name)}"><button class="btn text" data-ready-move="category:${gi}:-1" title="رفع التصنيف">↑</button><button class="btn text" data-ready-move="category:${gi}:1" title="تنزيل التصنيف">↓</button><button class="btn text" data-ready-remove="category:${gi}" title="إزالة التصنيف">×</button></div>${group.channels.map((channel, ci) => `<div class="ready-channel-row"><input aria-label="اسم القناة" data-ready-field="categories.${gi}.channels.${ci}.name" maxlength="100" value="${esc(channel.name)}"><select aria-label="نوع القناة" data-ready-field="categories.${gi}.channels.${ci}.type"><option value="0" ${channel.type === 0 ? 'selected' : ''}>نصية</option><option value="2" ${channel.type === 2 ? 'selected' : ''}>صوتية</option></select><select aria-label="وصول القناة" data-ready-field="categories.${gi}.channels.${ci}.access"><option value="public" ${!channel.access || channel.access === 'public' ? 'selected' : ''}>عامة</option><option value="read_only" ${channel.access === 'read_only' ? 'selected' : ''}>قراءة فقط</option><option value="private" ${channel.access === 'private' ? 'selected' : ''}>خاصة</option></select>${channel.access === 'private' ? `<select aria-label="رتبة القناة الخاصة" data-ready-field="categories.${gi}.channels.${ci}.roleKey">${readySelectOptions(d.roles, channel.roleKey)}</select>` : ''}<button class="btn text" data-ready-move="channel:${gi}:${ci}:-1" title="رفع القناة">↑</button><button class="btn text" data-ready-move="channel:${gi}:${ci}:1" title="تنزيل القناة">↓</button><button class="btn text" data-ready-remove="channel:${gi}:${ci}" title="إزالة القناة">×</button>${channel.type === 0 ? `<input class="ready-topic" aria-label="وصف القناة" placeholder="وصف القناة (اختياري)" maxlength="1024" data-ready-field="categories.${gi}.channels.${ci}.topic" value="${esc(channel.topic || '')}">` : ''}</div>`).join('')}<button class="btn text" data-ready-add="channel:${gi}">＋ قناة داخل التصنيف</button></section>`).join('')}<button class="btn secondary" data-ready-add="category">＋ تصنيف</button><h3>التشغيل التلقائي</h3><div class="ready-feature"><label class="check-row"><input type="checkbox" data-ready-field="features.welcome.enabled" ${d.features.welcome?.enabled ? 'checked' : ''}>بطاقة ترحيب لكل عضو جديد</label><label>العنوان<input data-ready-field="features.welcome.title" maxlength="256" value="${esc(d.features.welcome?.title || '')}"></label><label>الرسالة<textarea data-ready-field="features.welcome.description" maxlength="2000" rows="2">${esc(d.features.welcome?.description || '')}</textarea></label><label>قناة الترحيب<select data-ready-field="features.welcome.channelKey">${readySelectOptions(channels, d.features.welcome?.channelKey)}</select></label><label>لون البطاقة<input type="color" data-ready-field="features.welcome.color" value="${esc(d.features.welcome?.color || '#8d72e8')}"></label></div><div class="ready-feature"><label class="check-row"><input type="checkbox" data-ready-field="features.ticket.enabled" ${d.features.ticket?.enabled ? 'checked' : ''}>لوحة دعم بزر فتح تذكرة</label><label>العنوان<input data-ready-field="features.ticket.title" maxlength="256" value="${esc(d.features.ticket?.title || '')}"></label><label>الوصف<textarea data-ready-field="features.ticket.description" maxlength="2000" rows="2">${esc(d.features.ticket?.description || '')}</textarea></label><label>قناة لوحة الدعم<select data-ready-field="features.ticket.channelKey">${channelOptions.replace(`value="${esc(d.features.ticket?.channelKey)}"`, `value="${esc(d.features.ticket?.channelKey)}" selected`)}</select></label><label>رتبة الدعم<select data-ready-field="features.ticket.staffRoleKey">${roleOptions.replace(`value="${esc(d.features.ticket?.staffRoleKey)}"`, `value="${esc(d.features.ticket?.staffRoleKey)}" selected`)}</select></label></div><div class="ready-feature"><label class="check-row"><input type="checkbox" data-ready-field="features.logs.enabled" ${d.features.logs?.enabled ? 'checked' : ''}>سجلات نشاط السيرفر والأوامر</label><label>قناة السجل<select data-ready-field="features.logs.channelKey">${channelOptions.replace(`value="${esc(d.features.logs?.channelKey)}"`, `value="${esc(d.features.logs?.channelKey)}" selected`)}</select></label><p class="form-note">اختر الأحداث والقنوات التي تريد تسجيلها.</p></div><h3>طريقة التنصيب</h3><label class="check-row"><input type="radio" name="readyMode" value="add" ${state.readyMode === 'add' ? 'checked' : ''}>تنصيب بجانب القنوات والرتب الموجودة</label><label class="check-row"><input type="radio" name="readyMode" value="replace" ${state.readyMode === 'replace' ? 'checked' : ''}>استبدال الموجود بعد بناء القالب الجديد</label><p class="form-note">الاستبدال يحذف قنوات Discord ورسائلها ورتب الأعضاء القديمة؛ العناصر التي يحميها Discord أو تعلو رتبة البوت تبقى ويظهر اسمها في المراجعة.</p><button class="btn primary" id="readyReview" ${!state.data.connection.readable ? 'disabled' : ''}>معاينة التغييرات والمراجعة ←</button></div></section><section class="panel ready-preview-pane"><div class="panel-head"><h3>شكل القالب داخل Discord</h3></div><div id="readyPreview">${readyPreview(d)}</div></section></div>`;
  }
  if (state.readyRuns.length) $('#workspace .template-grid')?.insertAdjacentHTML('afterend', panel('المراجعات والتنفيذ السابق', `<div class="rows">${state.readyRuns.map(item => `<div class="row"><div class="row-main"><b>${esc(item.name || templates.find(template => template.key === item.template_key)?.name || item.template_key)}</b><small>${item.mode === 'replace' ? 'استبدال' : 'تنصيب'} · ${date(item.updated_at)}</small></div>${status(item.status)}<button class="btn secondary" data-ready-run="${esc(item.id)}">${item.status === 'succeeded' ? 'التفاصيل' : 'متابعة'}</button></div>`).join('')}</div>`));
  $('#workspace .template-grid')?.insertAdjacentHTML('beforebegin', botHierarchyNotice('استخدام القوالب الجاهزة'));
  $('#workspace .template-grid')?.insertAdjacentHTML('beforebegin', '<section class="ready-executor-panel" aria-label="اختيار بوت تنفيذ القالب"></section>');
  const botNotice = $('#workspace .template-grid')?.previousElementSibling;
  if (botNotice) {
    botNotice.innerHTML = `<div class="ready-executor-head"><div><span class="ready-executor-kicker">تخصيص القالب</span><h3>اختر بوت التنفيذ</h3><p>سيستخدم القالب البوت الذي تختاره لإنشاء القنوات والرتب وتشغيل الميزات.</p></div>${action(state.readyCustomBot ? 'إدارة ربط البوت' : 'ربط بوتك الخاص', 'settings')}</div><div class="ready-executor-options"><label class="ready-executor-option"><input type="radio" name="readyExecutor" value="diskoko" ${state.readyExecutor !== 'custom' ? 'checked' : ''}><span class="ready-executor-icon" aria-hidden="true"><img src="/assets/diskoko-logo.png" alt=""></span><span class="ready-executor-copy"><strong>بوت ديسكوكو</strong><small>${state.data.bot?.online ? 'متصل وجاهز' : 'سيُفحص الاتصال قبل التنفيذ'}</small></span></label><label class="ready-executor-option"><input type="radio" name="readyExecutor" value="custom" ${state.readyExecutor === 'custom' ? 'checked' : ''}><span class="ready-executor-icon" aria-hidden="true">🤖</span><span class="ready-executor-copy"><strong>بوتك الخاص</strong><small>${state.readyCustomBot ? `${esc(state.readyCustomBot.name)} · ${state.readyCustomBot.online ? 'متصل' : 'غير متصل'}` : 'اربط بوتك لتستخدمه في التنفيذ'}</small></span></label></div><p class="ready-executor-foot">لا يبدأ أي تغيير قبل مراجعتك، وسنتحقق من اتصال البوت وصلاحياته.</p>`;
  }
  document.querySelectorAll('input[name="readyExecutor"]').forEach(input => input.onchange = () => { state.readyExecutor = input.value; });
  document.querySelectorAll('[data-ready-choose]').forEach(button => button.onclick = () => { const template = templates.find(item => item.key === button.dataset.readyChoose); if (template) readyStart(template); });
  document.querySelectorAll('[data-ready-run]').forEach(button => button.onclick = run(async () => { const result = await api(`/api/workspace/${encodeURIComponent(state.guild)}/ready-templates/runs/${encodeURIComponent(button.dataset.readyRun)}`); readyReviewDialog(result); }));
  if (!d) return;
  if ($('#readyCounts')) $('#readyCounts').textContent = `${fmt(readyCounts(d).units)} متغيرًا · ${fmt(readyCounts(d).categories)} تصنيفات · ${fmt(readyCounts(d).channels)} قنوات · ${fmt(readyCounts(d).roles)} رتب`;
  const modeTitle = [...document.querySelectorAll('.ready-editor h3')].find(node => node.textContent === 'طريقة التنصيب');
  if (modeTitle) {
    const modeBox = document.createElement('div'); modeBox.className = 'ready-mode-choice';
    modeTitle.after(modeBox);
    let next = modeBox.nextElementSibling;
    while (next && (next.matches('label.check-row') || next.matches('p.form-note'))) { const following = next.nextElementSibling; modeBox.append(next); next = following; }
    modeBox.querySelectorAll('label').forEach((label, index) => { label.innerHTML += `<small>${index === 0 ? 'يبقي كل القنوات والرتب الحالية ويضيف عناصر القالب فقط.' : 'ينشئ القالب أولًا، ثم يحذف القنوات والرتب القديمة التي تسمح صلاحيات البوت بحذفها. ستراجع قائمة الحذف قبل التأكيد.'}</small>`; });
  }
  $('#readyCounts')?.closest('.panel-head')?.insertAdjacentHTML('afterend', `<p class="form-note ready-unit-note">الاستهلاك المتوقع: ${fmt(readyCounts(d).units)} متغيرًا = ${fmt(readyCounts(d).categories)} تصنيفات + ${fmt(readyCounts(d).channels)} قنوات + ${fmt(readyCounts(d).features)} تشغيل تلقائي. الرتب لا تُحتسب. يُخصم عند بدء التنفيذ.</p>`);
  const [welcomeSection, ticketSection, logsSection] = document.querySelectorAll('.ready-feature');
  document.querySelectorAll('.ready-edit-row').forEach((row, index) => row.insertAdjacentHTML('beforeend', `<button class="btn text" data-ready-move="role:${index}:-1" title="رفع الرتبة">↑</button><button class="btn text" data-ready-move="role:${index}:1" title="تنزيل الرتبة">↓</button>`));
  d.categories.forEach((group, gi) => group.channels.forEach((channel, ci) => {
    if (channel.type !== 0 || channel.access !== 'read_only') return;
    const accessField = document.querySelector(`[data-ready-field="categories.${gi}.channels.${ci}.access"]`);
    accessField?.closest('.ready-channel-row')?.insertAdjacentHTML('beforeend', `<label class="ready-post-role">من يستطيع النشر في هذه القناة؟<select data-ready-field="categories.${gi}.channels.${ci}.postRoleKey"><option value="">الإدارة والبوت فقط</option>${d.roles.map(role => `<option value="${esc(role.key)}" ${channel.postRoleKey === role.key ? 'selected' : ''}>${esc(role.name)}</option>`).join('')}</select></label>`);
  }));
  welcomeSection.insertAdjacentHTML('beforeend', `<label>صورة الترحيب أو GIF (حتى 8 ميجابايت)<input id="readyWelcomeImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><button class="btn text" id="readyRemoveImage" ${d.features.welcome?.banner ? '' : 'hidden'}>إزالة الصورة الحالية</button><label>موضع صورة العضو<select data-ready-field="features.welcome.avatarPosition"><option value="right" ${!d.features.welcome?.avatarPosition || d.features.welcome.avatarPosition === 'right' ? 'selected' : ''}>يمين</option><option value="left" ${d.features.welcome?.avatarPosition === 'left' ? 'selected' : ''}>يسار</option><option value="top" ${d.features.welcome?.avatarPosition === 'top' ? 'selected' : ''}>أعلى</option></select></label><label>موضع الصورة<select data-ready-field="features.welcome.bannerPosition"><option value="below" ${d.features.welcome?.bannerPosition !== 'above' ? 'selected' : ''}>أسفل البطاقة</option><option value="above" ${d.features.welcome?.bannerPosition === 'above' ? 'selected' : ''}>أعلى البطاقة</option></select></label>`);
  welcomeSection.insertAdjacentHTML('beforeend', `<label class="check-row"><input type="checkbox" data-ready-field="features.welcome.composite" ${d.features.welcome?.composite ? 'checked' : ''}>ضع صورة العضو داخل التصميم المرفوع</label><label>مكان صورة العضو داخل التصميم<select data-ready-field="features.welcome.avatarPosition"><option value="right" ${d.features.welcome?.avatarPosition === 'right' ? 'selected' : ''}>يمين</option><option value="center" ${d.features.welcome?.avatarPosition === 'center' ? 'selected' : ''}>الوسط</option><option value="left" ${d.features.welcome?.avatarPosition === 'left' ? 'selected' : ''}>يسار</option><option value="top" ${d.features.welcome?.avatarPosition === 'top' ? 'selected' : ''}>فوق البطاقة (بدون دمج)</option></select></label><label>تحريك صورة العضو أعلى وأسفل <output id="readyAvatarYValue">${Number(d.features.welcome?.avatarVertical ?? 50)}%</output><input type="range" min="15" max="85" data-ready-field="features.welcome.avatarVertical" value="${Number(d.features.welcome?.avatarVertical ?? 50)}"></label><label>حجم صورة العضو <output id="readyAvatarSizeValue">${Number(d.features.welcome?.avatarRadius ?? 95)}</output><input type="range" min="60" max="160" data-ready-field="features.welcome.avatarRadius" value="${Number(d.features.welcome?.avatarRadius ?? 95)}"></label><p class="form-note">عند الدمج تُستخدم صورة العضو الحقيقية عند انضمامه. معاينة الصورة هنا مثال. التصميم الثابت يُجهّز بمقاس 1200×480 تلقائيًا.</p>`);
  ticketSection.insertAdjacentHTML('beforeend', `<label>لون لوحة الدعم<input type="color" data-ready-field="features.ticket.color" value="${esc(d.features.ticket?.color || '#8d72e8')}"></label><label>نص زر الدعم<input data-ready-field="features.ticket.buttonLabel" maxlength="80" value="${esc(d.features.ticket?.buttonLabel || 'فتح تذكرة دعم')}"></label><label>صورة لوحة الدعم أو GIF (حتى 8 ميجابايت)<input id="readyTicketImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><button class="btn text" id="readyRemoveTicketImage" ${d.features.ticket?.banner ? '' : 'hidden'}>إزالة صورة الدعم</button><label>موضع صورة الدعم<select data-ready-field="features.ticket.bannerPosition"><option value="below" ${d.features.ticket?.bannerPosition !== 'above' ? 'selected' : ''}>أسفل النص</option><option value="above" ${d.features.ticket?.bannerPosition === 'above' ? 'selected' : ''}>فوق النص</option></select></label>`);
  ticketSection.insertAdjacentHTML('beforeend', `<label>طريقة عرض صورة الدعم<select data-ready-field="features.ticket.imageStyle"><option value="normal" ${!['logo','design'].includes(d.features.ticket?.imageStyle) ? 'selected' : ''}>صورة عادية</option><option value="logo" ${d.features.ticket?.imageStyle === 'logo' ? 'selected' : ''}>شعار صغير داخل البطاقة</option><option value="design" ${d.features.ticket?.imageStyle === 'design' ? 'selected' : ''}>دمج شعار دائري داخل تصميمك</option></select></label><div id="readyTicketDesignControls" class="ready-design-controls" ${d.features.ticket?.imageStyle === 'design' ? '' : 'hidden'}><label>شعار السيرفر داخل التصميم<input id="readyTicketLogo" type="file" accept="image/png,image/jpeg,image/webp"></label><label>تحريك الشعار يمينًا ويسارًا <output id="readyTicketXValue">${Number(d.features.ticket?.logoX ?? 50)}%</output><input id="readyTicketX" type="range" min="10" max="90" value="${Number(d.features.ticket?.logoX ?? 50)}"></label><label>تحريك الشعار أعلى وأسفل <output id="readyTicketYValue">${Number(d.features.ticket?.logoY ?? 50)}%</output><input id="readyTicketY" type="range" min="25" max="75" value="${Number(d.features.ticket?.logoY ?? 50)}"></label><small class="form-note">ارفع تصميمًا ثابتًا وشعارًا، ثم حرّك موضع الشعار. تظهر النتيجة في المعاينة قبل النشر.</small></div>`);
  const logs = d.features.logs;
  logsSection.querySelector('[data-ready-field="features.logs.channelKey"]').closest('label').classList.add('ready-log-unified-target');
  logsSection.querySelector('.form-note').textContent = 'يسجل أحداث الرسائل والدخول والخروج الصوتي بحسب اختيارك، دون نسخ محتوى الرسائل. الإشعارات تُجمع لتفادي الإرسال المفرط.';
  logsSection.insertAdjacentHTML('beforeend', `<label>طريقة توزيع اللوقات<select id="readyLogMode"><option value="unified" ${logs.mode !== 'routed' ? 'selected' : ''}>لوق واحد لجميع القنوات</option><option value="routed" ${logs.mode === 'routed' ? 'selected' : ''}>قواعد منفصلة: مصادر متعددة إلى وجهة تختارها</option></select></label><div class="ready-log-events"><b>الأحداث المسجلة</b>${[['message_create','رسالة جديدة'],['message_update','تعديل رسالة'],['message_delete','حذف رسالة'],['voice_join','دخول صوتي'],['voice_leave','خروج صوتي'],['command','أوامر البوت']].map(([key,label]) => `<label class="check-row"><input type="checkbox" data-ready-log-event="${key}" ${(logs.events || ['message_create','message_update','message_delete','voice_join','voice_leave','command']).includes(key) ? 'checked' : ''}>${label}</label>`).join('')}</div><div id="readyLogRoutes" class="ready-log-routes" ${logs.mode === 'routed' ? '' : 'hidden'}>${(logs.routes || []).map((rule,index) => `<div class="ready-log-rule"><div class="ready-log-rule-head"><b>قاعدة اللوق ${fmt(index + 1)}</b><button class="btn text" type="button" data-ready-log-remove="${index}">إزالة</button></div><details><summary>القنوات المصدر (${fmt(rule.sourceKeys?.length || 0)})</summary><div class="ready-log-sources">${d.categories.flatMap(group => group.channels).map(channel => `<label class="check-row"><input type="checkbox" data-ready-log-source="${index}:${esc(channel.key)}" ${(rule.sourceKeys || []).includes(channel.key) ? 'checked' : ''}>${channel.type === 2 ? '🔊' : '#'} ${esc(channel.name)}</label>`).join('')}</div></details><label>إرسال اللوق إلى<select data-ready-field="features.logs.routes.${index}.targetKey">${readySelectOptions(channels, rule.targetKey)}</select></label></div>`).join('')}<button class="btn secondary" type="button" id="readyAddLogRoute" ${(logs.routes || []).length >= 10 ? 'disabled' : ''}>＋ أضف قاعدة لوق</button></div>`);
  logsSection.querySelector('.ready-log-unified-target').hidden = logs.mode === 'routed';
  welcomeSection.querySelector('[data-ready-field="features.welcome.avatarPosition"]').closest('label').remove();
  for (const [section, kind] of [[welcomeSection, 'welcome'], [ticketSection, 'ticket']]) {
    section.classList.add('ready-feature-with-preview');
    const fields = document.createElement('div'); fields.className = 'ready-feature-fields';
    while (section.firstChild) fields.append(section.firstChild);
    const inline = document.createElement('aside'); inline.className = 'ready-feature-inline'; inline.id = `ready-${kind}-inline-preview`;
    inline.setAttribute('aria-live', 'polite');
    section.append(fields, inline);
  }
  readyDecoratePreview();
  $('#readyWelcomeImage').onchange = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 8 * 1024 * 1024) { toast('اختر صورة PNG أو JPG أو WebP أو GIF بحجم 8 ميجابايت أو أقل.'); event.target.value = ''; return; }
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    d.features.welcome.banner = d.features.welcome.composite && file.type !== 'image/gif' ? await prepareWelcomeBackground(file) : { mime: file.type, base64: dataUrl.split(',')[1] };
    $('#readyPreview').innerHTML = readyPreview(d); readyDecoratePreview(); $('#readyRemoveImage').hidden = false;
  };
  $('#readyRemoveImage').onclick = () => { d.features.welcome.banner = null; $('#readyWelcomeImage').value = ''; $('#readyPreview').innerHTML = readyPreview(d); readyDecoratePreview(); $('#readyRemoveImage').hidden = true; };
  let ticketArtworkVersion = 0;
  const updateTicketArtwork = async () => {
    const version = ++ticketArtworkVersion;
    const file = state.readyTicketDesignFile, logo = state.readyTicketLogoFile;
    if (!file) return;
    if (d.features.ticket.imageStyle === 'design') {
      if (!logo) return;
      if (file.type === 'image/gif') throw Error('دمج الشعار داخل التصميم يحتاج PNG أو JPG أو WebP. استخدم GIF في العرض العادي.');
      const image = await prepareWelcomeBackground(file, logo, d.features.ticket.logoX ?? 50, d.features.ticket.logoY ?? 50);
      if (version !== ticketArtworkVersion) return;
      d.features.ticket.banner = image;
    } else {
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      if (version !== ticketArtworkVersion) return;
      d.features.ticket.banner = { mime: file.type, base64: dataUrl.split(',')[1] };
    }
    $('#readyPreview').innerHTML = readyPreview(d); readyDecoratePreview(); $('#readyRemoveTicketImage').hidden = false;
  };
  $('#readyTicketImage').onchange = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 8 * 1024 * 1024) { toast('اختر صورة PNG أو JPG أو WebP أو GIF بحجم 8 ميجابايت أو أقل.'); event.target.value = ''; return; }
    state.readyTicketDesignFile = file;
    try { await updateTicketArtwork(); } catch (error) { toast(error.message); }
  };
  $('#readyTicketLogo').onchange = async event => { state.readyTicketLogoFile = event.target.files?.[0] || null; try { await updateTicketArtwork(); } catch (error) { toast(error.message); } };
  for (const axis of ['X', 'Y']) $(`#readyTicket${axis}`).oninput = async event => { d.features.ticket[`logo${axis}`] = Number(event.target.value); $(`#readyTicket${axis}Value`).textContent = `${event.target.value}%`; try { await updateTicketArtwork(); } catch (error) { toast(error.message); } };
  $('#readyRemoveTicketImage').onclick = () => { ticketArtworkVersion++; d.features.ticket.banner = null; state.readyTicketDesignFile = null; state.readyTicketLogoFile = null; $('#readyTicketImage').value = ''; $('#readyTicketLogo').value = ''; $('#readyPreview').innerHTML = readyPreview(d); readyDecoratePreview(); $('#readyRemoveTicketImage').hidden = true; };
  document.querySelectorAll('[data-ready-field]').forEach(field => {
    const handler = () => {
      if (field.type === 'color' && field.dataset.readyField.endsWith('.color') && field.dataset.readyField.startsWith('roles.')) readyDraftUpdate(field, parseInt(field.value.slice(1), 16));
      else readyDraftUpdate(field, field.value);
      if (field.dataset.readyField.startsWith('features.logs.routes.') && field.dataset.readyField.endsWith('.targetKey')) {
        const index = Number(field.dataset.readyField.split('.')[3]);
        logs.routes[index].sourceKeys = (logs.routes[index].sourceKeys || []).filter(key => key !== field.value);
        renderReadyEditor();
        return;
      }
      if (field.dataset.readyField === 'features.welcome.avatarVertical') $('#readyAvatarYValue').textContent = `${field.value}%`;
      if (field.dataset.readyField === 'features.welcome.avatarRadius') $('#readyAvatarSizeValue').textContent = field.value;
      if (field.dataset.readyField === 'features.welcome.composite' && d.features.welcome.banner && d.features.welcome.banner.mime !== 'image/gif') toast('بعد تفعيل الدمج، أعد رفع التصميم ليُجهّز بمقاس البطاقة.');
      if (field.dataset.readyField === 'features.ticket.imageStyle') { $('#readyTicketDesignControls').hidden = field.value !== 'design'; void updateTicketArtwork().catch(error => toast(error.message)); }
      if (field.dataset.readyField.endsWith('.access') || field.dataset.readyField.endsWith('.type')) renderReadyEditor();
    };
    field.addEventListener(field.tagName === 'SELECT' || field.type === 'checkbox' ? 'change' : 'input', handler);
  });
  $('#readyLogMode').onchange = event => {
    logs.mode = event.target.value;
    if (logs.mode === 'routed' && !(logs.routes || []).length) logs.routes = [{ key: readyNewKey('log'), sourceKeys: [d.categories.flatMap(group => group.channels).find(channel => channel.key !== logs.channelKey)?.key].filter(Boolean), targetKey: logs.channelKey }];
    renderReadyEditor();
  };
  $('#readyAddLogRoute')?.addEventListener('click', () => {
    if ((logs.routes || []).length >= 10) return;
    logs.routes ||= [];
    logs.routes.push({ key: readyNewKey('log'), sourceKeys: [], targetKey: logs.channelKey });
    renderReadyEditor();
  });
  document.querySelectorAll('[data-ready-log-remove]').forEach(button => button.onclick = () => { logs.routes.splice(Number(button.dataset.readyLogRemove), 1); renderReadyEditor(); });
  document.querySelectorAll('[data-ready-log-source]').forEach(input => input.onchange = () => {
    const [index, key] = input.dataset.readyLogSource.split(':');
    const rule = logs.routes[Number(index)];
    rule.sourceKeys = input.checked ? [...new Set([...(rule.sourceKeys || []), key])] : (rule.sourceKeys || []).filter(item => item !== key);
    input.closest('details').querySelector('summary').textContent = `القنوات المصدر (${fmt(rule.sourceKeys.length)})`;
    $('#readyPreview').innerHTML = readyPreview(d); readyDecoratePreview();
  });
  document.querySelectorAll('[data-ready-log-event]').forEach(input => input.onchange = () => {
    logs.events = [...document.querySelectorAll('[data-ready-log-event]:checked')].map(item => item.dataset.readyLogEvent);
    $('#readyPreview').innerHTML = readyPreview(d); readyDecoratePreview();
  });
  document.querySelectorAll('input[name="readyMode"]').forEach(input => input.onchange = () => { state.readyMode = input.value; });
  document.querySelectorAll('[data-ready-add]').forEach(button => button.onclick = () => {
    const [kind, index] = button.dataset.readyAdd.split(':');
    if (kind === 'role') d.roles.push({ key: readyNewKey('role'), name: 'رتبة جديدة', preset: 'member', color: 0x99aab5 });
    if (kind === 'category') d.categories.push({ key: readyNewKey('category'), name: 'تصنيف جديد', channels: [] });
    if (kind === 'channel') d.categories[Number(index)].channels.push({ key: readyNewKey('channel'), name: 'قناة-جديدة', type: 0, access: 'public' });
    renderReadyEditor();
  });
  document.querySelectorAll('[data-ready-remove]').forEach(button => button.onclick = () => {
    const [kind, i, j] = button.dataset.readyRemove.split(':');
    if (kind === 'role') d.roles.splice(Number(i), 1);
    if (kind === 'category') d.categories.splice(Number(i), 1);
    if (kind === 'channel') d.categories[Number(i)].channels.splice(Number(j), 1);
    renderReadyEditor();
  });
  document.querySelectorAll('[data-ready-move]').forEach(button => button.onclick = () => {
    const [kind, a, b, c] = button.dataset.readyMove.split(':');
    const items = kind === 'category' ? d.categories : kind === 'role' ? d.roles : d.categories[Number(a)].channels;
    const index = Number(kind === 'category' || kind === 'role' ? a : b), next = index + Number(kind === 'category' || kind === 'role' ? b : c);
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]]; renderReadyEditor();
  });
  $('#readyReview').onclick = run(async () => {
    const result = await api(`/api/workspace/${encodeURIComponent(state.guild)}/ready-templates/review`, { method: 'POST', body: JSON.stringify({ templateKey: state.readyKey, mode: state.readyMode, executor: state.readyExecutor || 'diskoko', definition: d }) });
    readyReviewDialog(result);
  });
}
function readyReviewDialog(data) {
  const review = data.run.review, replace = data.run.mode === 'replace';
  const toDelete = [...review.deletions.channels.map(item => `# ${item.name}`), ...review.deletions.roles.map(item => `رتبة ${item.name}`)];
  const protectedItems = [...(review.protectedChannels || []).map(item => `# ${item.name}`), ...(review.protectedRoles || []).map(item => `رتبة ${item.name}`)];
  const executorName = data.run.executor === 'custom' ? state.readyCustomBot?.name || 'بوتك الخاص' : 'بوت ديسكوكو';
  modal('مراجعة القالب قبل التنفيذ', `<div class="notice info"><div><b>${esc(review.guildName)}</b><p>${replace ? 'استبدال الهيكل القديم' : 'تنصيب القالب مع إبقاء الموجود'} · ${fmt(data.steps.length)} خطوات</p></div></div><div class="ready-review-list"><h3>الهيكل الجديد</h3>${data.steps.filter(step => !step.kind.startsWith('delete-')).map(step => `<div class="row"><span class="row-icon">${step.kind === 'role' ? '◇' : step.kind === 'category' ? '▤' : step.kind === 'channel' ? '#' : '✦'}</span><div class="row-main"><b>${esc(step.name)}</b><small>${esc(step.kind.replace('feature-', 'ميزة: '))}</small></div>${status(step.status)}</div>`).join('')}${replace ? `<h3>العناصر التي سيحذفها البوت بعد البناء (${fmt(toDelete.length)})</h3>${toDelete.length ? `<ul>${toDelete.map(name => `<li>${esc(name)}</li>`).join('')}</ul>` : '<p>لا توجد عناصر قديمة للحذف.</p>'}${protectedItems.length ? `<h3>عناصر محمية ستبقى (${fmt(protectedItems.length)})</h3><ul>${protectedItems.map(name => `<li>${esc(name)}</li>`).join('')}</ul>` : ''}<p class="form-note">حذف القنوات يمحو الرسائل نهائيًا من Discord، وحذف الرتب يزيلها من الأعضاء. لا يمكن استعادة المحتوى من هذه المعاينة.</p>` : '<p class="form-note">لن تُحذف القنوات أو الرتب الحالية.</p>'}</div><label class="check-row"><input type="checkbox" id="readyAcknowledge">راجعت الهيكل والصلاحيات وقائمة الحذف، وأوافق على التنفيذ.</label>${replace ? `<label>لتأكيد الاستبدال، اكتب اسم السيرفر كما يظهر: <b>${esc(review.guildName)}</b><input id="readyGuildName" autocomplete="off" placeholder="اسم السيرفر"></label>` : ''}`, `<button class="btn secondary" id="readyLater">لاحقًا</button><button class="btn primary" id="readyApply" disabled>نعم، نفّذ القالب</button>`);
  const details = (review.createOrReuse || []).map(item => `<div class="row"><div class="row-main"><b>${esc(item.name)}</b><small>${item.kind === 'role' ? `رتبة · ${esc({ moderator: 'إشراف محدود', support: 'دعم', member: 'عضو', vip: 'مميز' }[item.preset] || '')} · لا صلاحية Administrator` : item.kind === 'channel' ? `${item.parent ? `${esc(item.parent)} · ` : ''}${esc({ public: 'عامة', read_only: 'قراءة فقط', private: 'خاصة' }[item.access] || '')}` : 'تصنيف'}</small></div>${badge(item.action === 'reuse' ? 'موجودة وتبقى' : item.action === 'update' ? 'تعديل' : 'إنشاء', item.action === 'reuse' ? 'neutral' : 'purple')}</div>`).join('');
  document.querySelector('.ready-review-list')?.insertAdjacentHTML('afterbegin', `<details><summary>تفاصيل كل قناة ورتبة وصلاحيتها (${fmt((review.createOrReuse || []).length)})</summary><div class="rows">${details}</div></details>`);
  document.querySelector('.ready-review-list')?.insertAdjacentHTML('afterbegin', `<p class="notice info">المنفّذ: ${esc(executorName)} · استهلاك القالب: ${fmt(review.usageUnits || 1)} متغيرًا عند بدء التنفيذ. الرتب لا تُحتسب.</p>`);
  const reusedAdminRoles = (review.createOrReuse || []).filter(item => item.kind === 'role' && item.action === 'reuse' && item.hasAdministrator);
  if (reusedAdminRoles.length) document.querySelector('.ready-review-list')?.insertAdjacentHTML('afterbegin', `<p class="notice">تنبيه: الرتب الموجودة ${reusedAdminRoles.map(item => esc(item.name)).join('، ')} لديها صلاحية Administrator حاليًا. وضع التنصيب سيبقي صلاحياتها كما هي؛ راجعها في Discord.</p>`);
  if (replace && review.affectedTasks) document.querySelector('.ready-review-list')?.insertAdjacentHTML('beforeend', `<p class="notice">ستُلغى ${fmt(review.affectedTasks.schedules)} رسائل مجدولة، وتُوقف ${fmt(review.affectedTasks.giveaways)} جيف أوي، وتُزال ${fmt(review.affectedTasks.ticketPanels)} لوحات دعم مرتبطة بالقنوات القديمة.</p>`);
  if (data.run.status === 'succeeded') { $('#readyApply').remove(); $('#readyLater').textContent = 'إغلاق'; $('#readyLater').onclick = closeDialog; return; }
  $('#readyLater').onclick = closeDialog;
  const toggle = () => { $('#readyApply').disabled = !$('#readyAcknowledge').checked || (replace && $('#readyGuildName').value !== review.guildName); };
  $('#readyAcknowledge').onchange = toggle; if (replace) $('#readyGuildName').oninput = toggle;
  $('#readyApply').onclick = run(async () => {
    $('#readyApply').disabled = true; $('#readyLater').disabled = true; $('#closeDialog').disabled = true;
    let result = data;
    try {
      do {
        $('#readyApply').textContent = `جارٍ التنفيذ… ${fmt(result.steps.filter(step => step.status === 'succeeded').length)} / ${fmt(result.steps.length)}`;
        result = await api(`/api/workspace/${encodeURIComponent(state.guild)}/ready-templates/runs/${encodeURIComponent(data.run.id)}/apply`, { method: 'POST', body: JSON.stringify({ confirmed: true, guildName: review.guildName, mode: data.run.mode }) });
      } while (result.run.status === 'running');
      closeDialog(); await loadGuild(); toast('اكتمل تنصيب القالب على سيرفرك.');
    } catch (error) {
      $('#closeDialog').disabled = false; $('#readyLater').disabled = false; $('#readyApply').disabled = false; $('#readyApply').textContent = 'متابعة التنفيذ'; modalError(error);
    }
  });
}
async function prepareWelcomeBackground(file, logoFile = null, logoX = 16, logoY = 50) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 25 * 1024 * 1024) throw Error('اختر تصميم PNG أو JPG أو WebP لا يتجاوز 25 ميجابايت.');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 50_000_000) { bitmap.close(); throw Error('أبعاد الصورة كبيرة جدًا. استخدم صورة أقل من 50 مليون بكسل.'); }
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 480;
  const scale = Math.max(1200 / bitmap.width, 480 / bitmap.height);
  const width = bitmap.width * scale, height = bitmap.height * scale;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, (1200 - width) / 2, (480 - height) / 2, width, height);
  bitmap.close();
  if (logoFile) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(logoFile.type) || logoFile.size > 25 * 1024 * 1024) throw Error('اختر شعار PNG أو JPG أو WebP حتى 25 ميجابايت.');
    const logo = await createImageBitmap(logoFile);
    const x = 1200 * Number(logoX) / 100, y = 480 * Number(logoY) / 100, radius = 72;
    context.fillStyle = '#bea0ff'; context.beginPath(); context.arc(x, y, radius + 7, 0, 2 * Math.PI); context.fill();
    context.save(); context.beginPath(); context.arc(x, y, radius, 0, 2 * Math.PI); context.clip();
    const logoScale = Math.max(2 * radius / logo.width, 2 * radius / logo.height);
    context.drawImage(logo, x - logo.width * logoScale / 2, y - logo.height * logoScale / 2, logo.width * logoScale, logo.height * logoScale);
    context.restore(); logo.close();
  }
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  if (base64.length > 6_500_000) throw Error('التصميم كبير بعد التجهيز. استخدم صورة أبسط أو أصغر.');
  return { mime: 'image/png', base64 };
}
async function prepareWelcomeLogoOverlay(logoFile, logoX = 16, logoY = 50) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(logoFile?.type) || logoFile.size > 25 * 1024 * 1024) throw Error('اختر شعار PNG أو JPG أو WebP حتى 25 ميجابايت.');
  const logo = await createImageBitmap(logoFile);
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 480;
  const context = canvas.getContext('2d');
  const x = 1200 * Number(logoX) / 100, y = 480 * Number(logoY) / 100, radius = 72;
  context.fillStyle = '#bea0ff'; context.beginPath(); context.arc(x, y, radius + 7, 0, 2 * Math.PI); context.fill();
  context.save(); context.beginPath(); context.arc(x, y, radius, 0, 2 * Math.PI); context.clip();
  const scale = Math.max(2 * radius / logo.width, 2 * radius / logo.height);
  context.drawImage(logo, x - logo.width * scale / 2, y - logo.height * scale / 2, logo.width * scale, logo.height * scale);
  context.restore(); logo.close();
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  if (base64.length > 6_500_000) throw Error('الشعار كبير جدًا بعد التجهيز. اختر صورة أبسط.');
  return { mime: 'image/png', base64 };
}
async function prepareCircleLogo(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file?.type) || file.size > 25 * 1024 * 1024) throw Error('اختر صورة شعار PNG أو JPG أو WebP حتى 25 ميجابايت.');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext('2d');
  context.beginPath(); context.arc(128, 128, 124, 0, 2 * Math.PI); context.clip();
  const scale = Math.max(256 / bitmap.width, 256 / bitmap.height);
  context.drawImage(bitmap, (256 - bitmap.width * scale) / 2, (256 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  bitmap.close();
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  if (base64.length > 460000) throw Error('تعذر تجهيز الشعار. استخدم صورة أبسط.');
  return { mime: 'image/png', base64 };
}
async function prepareDesignedCard(backgroundFile, logoFile, logoX = 84, logoY = 50) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(backgroundFile?.type) || backgroundFile.size > 25 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(logoFile?.type) || logoFile.size > 25 * 1024 * 1024) throw Error('ارفع تصميمًا وشعارًا بصيغة PNG أو JPG أو WebP حتى 25 ميجابايت لكل صورة.');
  const [background, logo] = await Promise.all([createImageBitmap(backgroundFile), createImageBitmap(logoFile)]);
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 480;
  const context = canvas.getContext('2d');
  const cover = Math.max(1200 / background.width, 480 / background.height);
  context.drawImage(background, (1200 - background.width * cover) / 2, (480 - background.height * cover) / 2, background.width * cover, background.height * cover);
  const x = 1200 * Number(logoX) / 100, y = 480 * Number(logoY) / 100, radius = 96;
  context.fillStyle = '#bea0ff'; context.beginPath(); context.arc(x, y, radius + 8, 0, 2 * Math.PI); context.fill();
  context.save(); context.beginPath(); context.arc(x, y, radius, 0, 2 * Math.PI); context.clip();
  const scale = Math.max(2 * radius / logo.width, 2 * radius / logo.height);
  context.drawImage(logo, x - logo.width * scale / 2, y - logo.height * scale / 2, logo.width * scale, logo.height * scale);
  context.restore(); background.close(); logo.close();
  for (const quality of [0.82, 0.68, 0.5]) {
    const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    if (base64.length < 460000) return { mime: 'image/jpeg', base64 };
  }
  throw Error('التصميم مع الشعار كبير بعد التجهيز. استخدم خلفية أبسط.');
}
const logoPlacementFields = (prefix, initial = 'right') => `<label>مكان الشعار المبدئي<select id="${prefix}LogoPosition"><option value="right" ${initial === 'right' ? 'selected' : ''}>يمين</option><option value="center" ${initial === 'center' ? 'selected' : ''}>الوسط</option><option value="left" ${initial === 'left' ? 'selected' : ''}>يسار</option></select></label><div class="form-grid two"><label>تحريك الشعار يمينًا ويسارًا <output id="${prefix}LogoXValue">${initial === 'left' ? 16 : initial === 'center' ? 50 : 84}%</output><input id="${prefix}LogoX" type="range" min="10" max="90" value="${initial === 'left' ? 16 : initial === 'center' ? 50 : 84}"></label><label>تحريك الشعار أعلى وأسفل <output id="${prefix}LogoYValue">50%</output><input id="${prefix}LogoY" type="range" min="25" max="75" value="50"></label></div>`;
function bindLogoPlacement(prefix, update) {
  const position = document.querySelector(`#${prefix}LogoPosition`), x = document.querySelector(`#${prefix}LogoX`), y = document.querySelector(`#${prefix}LogoY`);
  if (!position || !x || !y) return;
  position.onchange = () => { x.value = { left: 16, center: 50, right: 84 }[position.value]; update(); };
  const sync = () => { document.querySelector(`#${prefix}LogoXValue`).textContent = `${x.value}%`; document.querySelector(`#${prefix}LogoYValue`).textContent = `${y.value}%`; update(); };
  x.oninput = sync; y.oninput = sync;
}
const imageStyleFields = prefix => `<label>طريقة عرض الصورة<select id="${prefix}Style"><option value="normal">صورة عادية</option><option value="logo">شعار دائري صغير داخل البطاقة</option><option value="design">شعار دائري داخل تصميمك</option></select></label><small class="form-note">GIF يبقى متحركًا في العرض العادي؛ دمج الشعار داخل التصميم يحتاج صورة ثابتة.</small><div id="${prefix}Design" hidden><label>صورة الشعار التي ستُدمج داخل التصميم<input id="${prefix}Logo" type="file" accept="image/png,image/jpeg,image/webp"></label>${logoPlacementFields(prefix)}</div>`;
const imageStylePreviewUrls = new WeakMap();
async function prepareStyledImage(file, prefix) {
  const style = document.querySelector(`#${prefix}Style`)?.value || 'normal';
  if (!file) { if (style !== 'normal') throw Error('ارفع صورة ثابتة لاستخدام الشعار الدائري أو التصميم.'); return null; }
  if (file.type === 'image/gif') {
    if (style !== 'normal') throw Error('GIF المتحرك يُعرض كصورة عادية. اختر صورة ثابتة لدمج الشعار.');
    return prepareAiMedia(file);
  }
  if (style === 'logo') return prepareCircleLogo(file);
  if (style === 'design') return prepareDesignedCard(file, document.querySelector(`#${prefix}Logo`)?.files[0], document.querySelector(`#${prefix}LogoX`)?.value, document.querySelector(`#${prefix}LogoY`)?.value);
  return prepareAiImage(file);
}
async function prepareNativeEventCover(file) {
  if (!file) return null;
  if (file.type === 'image/gif') {
    if (!file.size || file.size > 2 * 1024 * 1024) throw Error('غلاف الحدث GIF يجب ألا يتجاوز 2 ميجابايت.');
    const media = await prepareAiMedia(file);
    return { mime: media.mime, base64: media.base64 };
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 25 * 1024 * 1024) throw Error('اختر غلاف PNG أو JPG أو WebP حتى 25 ميجابايت؛ سيُجهز للمقاس المناسب تلقائيًا.');
  const source = await createImageBitmap(file);
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 480;
  const context = canvas.getContext('2d');
  const scale = Math.max(canvas.width / source.width, canvas.height / source.height);
  context.drawImage(source, (canvas.width - source.width * scale) / 2, (canvas.height - source.height * scale) / 2, source.width * scale, source.height * scale);
  source.close();
  for (const quality of [0.88, 0.75, 0.6, 0.45]) {
    const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    if (base64.length < 2_700_000) return { mime: 'image/jpeg', base64 };
  }
  throw Error('تعذر تجهيز غلاف الحدث ضمن الحجم المسموح. جرّب صورة أبسط.');
}
function updateStyledImagePreview(prefix, preview) {
  const styleControl = document.querySelector(`#${prefix}Style`);
  const gif = document.querySelector(`#${prefix}`)?.files?.[0]?.type === 'image/gif';
  if (gif && styleControl) styleControl.value = 'normal';
  const style = styleControl?.value || 'normal';
  const controls = document.querySelector(`#${prefix}Design`);
  if (controls) controls.hidden = style !== 'design';
  if (!preview) return;
  if (preview.tagName === 'IMG' && !preview.parentElement.classList.contains('ai-card-image-wrap')) {
    const wrapper = document.createElement('div'); wrapper.className = 'ai-card-image-wrap'; preview.before(wrapper); wrapper.append(preview);
  }
  preview.classList.toggle('ai-card-logo-preview', style === 'logo');
  preview.classList.toggle('ai-card-design-preview', style === 'design');
  let overlay = preview.parentElement?.querySelector('.ai-card-logo-overlay');
  if (style === 'design' && preview.tagName === 'IMG') {
    if (!overlay) { overlay = document.createElement('img'); overlay.className = 'ai-card-logo-overlay'; preview.after(overlay); }
    const file = document.querySelector(`#${prefix}Logo`)?.files[0];
    if (file) { if (!imageStylePreviewUrls.has(file)) imageStylePreviewUrls.set(file, URL.createObjectURL(file)); overlay.src = imageStylePreviewUrls.get(file); }
    overlay.hidden = !file;
    overlay.style.left = `${document.querySelector(`#${prefix}LogoX`)?.value || 84}%`;
    overlay.style.top = `${document.querySelector(`#${prefix}LogoY`)?.value || 50}%`;
  } else if (overlay) overlay.hidden = true;
}
async function prepareAiMedia(file) {
  if (!['image/gif', 'video/mp4', 'video/quicktime'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) throw Error('اختر GIF أو MP4 أو MOV بحجم لا يتجاوز 20 ميجابايت.');
  const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '').split(',')[1]); reader.onerror = () => reject(Error('تعذر قراءة الملف المتحرك.')); reader.readAsDataURL(file); });
  return { mime: file.type, base64: encoded };
}
function aiActionChoices(answer) {
  return String(answer || '').split('\n').map(line => line.trim().replace(/^\*+/, '').trim()).map(line => /^[0-9٠-٩۰-۹]{1,2}[.)،:\-]\s*(.{8,300})/.exec(line)?.[1]?.replace(/^\*+|\*+$/g, '').trim()).filter(Boolean).slice(0, 10);
}
const aiLibraryFlow = item => {
  if (item.kind === 'tickets') return 'حدد قناة اللوحة ورتبة الدعم ← راجع النص والبنر ← أكد النشر ← العميل يفتح تذكرة خاصة ← الفريق يستلمها ويتابعها';
  if (item.category === 'الجيف آواي' || item.title.includes('جيف آواي')) return 'حدد الجائزة والمدة والقناة ← راجع البطاقة والبنر ← أكد النشر ← يتفاعل الأعضاء مع زر المشاركة';
  if (item.kind === 'poll') return 'حدد السؤال والخيارات والصور ← راجع المعاينة ← انشر ← يصوّت الأعضاء وتظهر النتائج';
  if (item.kind === 'event') return 'جهز إعلان الفعالية ← فعّل زر التسجيل إن أردت ← راجع المعاينة ← انشر ويتحدث عدّاد المشاركين';
  if (item.kind === 'scheduled_event') return 'اختر قناة صوتية أو مكانًا آخر ← اضبط الموعد والغلاف ← راجع شكل الحدث ← أنشئه في Events داخل Discord';
  if (item.kind === 'welcome') return 'اختر قناة الترحيب والبطاقة ← راجع المعاينة ← فعّلها ← يرحّب البوت تلقائيًا بكل عضو جديد';
  if (item.kind === 'rules') return 'اختر القناة وعدّل القوانين ← اختر طريقة عرض البطاقة واللون والصورة ← راجع المعاينة ← انشر';
  return 'حدد القناة والنص والصورة إن وجدت ← راجع المحتوى وموضع الصورة ← أكد النشر في Discord';
};
async function assistant() {
  const guild = state.guild, epoch = state.epoch;
  const active = () => guild === state.guild && epoch === state.epoch && screen() === 'assistant';
  const storageKey = `diskoko-ai-conversation:${guild}`;
  let selected = sessionStorage.getItem(storageKey) || '';
  let conversations = [], messages = [], available = false, planEnabled = true, busy = false;
  $('#workspace').innerHTML = head('AI ديسكوكو', 'مساعدك لتنظيم السيرفر. محادثاتك محفوظة لهذا السيرفر ويمكنك الرجوع إليها.') + connectionNotice() + `<div class="ai-chat-layout"><aside class="panel ai-chat-sidebar"><section class="ai-bot-connect"><div class="ai-bot-connect-head"><span>✦ بوتك وهويتك</span><a href="/ai-bot-guide.html" target="_blank" rel="noopener noreferrer">شرح الربط ↗</a></div><h3>اربط بوتك الخاص بديسكوكو AI</h3><p>خلّ AI ينشر وينفذ باسم بوت سيرفرك بعد مراجعتك. يبقى بوت ديسكوكو الخيار الأساسي حتى تربط بوتك.</p><div id="aiBotConnection" role="status">جارٍ التحقق من الربط…</div></section><div class="panel-head"><h3>المحادثات</h3><button id="aiNew" class="btn small primary" type="button">+ جديدة</button></div><div id="aiConversations" class="ai-conversations"></div></aside><section class="panel ai-chat-main"><div class="panel-head"><div><h3 id="aiChatTitle">محادثة جديدة</h3><small>التغييرات على Discord تظهر للمراجعة قبل تطبيقها.</small></div><span id="aiStatus" class="badge neutral">جارٍ التحقق…</span></div><div id="aiMessages" class="ai-messages" role="log" aria-live="polite"></div><div id="aiNotice" class="ai-notice" role="status"></div><div id="aiRecording" class="ai-recording" role="status" hidden><span class="ai-recording-dot"></span><b>جارٍ تسجيل كلامك</b><span id="aiRecordingTime">00:00</span><button id="aiStopVoice" type="button" class="btn small secondary">إيقاف التسجيل</button></div><div id="aiAttachment" class="ai-attachment" hidden></div><form id="assistantForm" class="ai-composer"><label for="assistantPrompt" class="sr-only">رسالتك إلى AI ديسكوكو</label><textarea id="assistantPrompt" rows="2" maxlength="1500" placeholder="اكتب ما تحتاجه لسيرفرك…"></textarea><div class="ai-composer-tools"><button id="aiAttach" class="btn secondary" type="button" aria-label="إرفاق صورة أو ملف نصي">📎 <span>إرفاق</span></button><input id="aiFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,.txt,text/plain" hidden><button id="aiVoice" class="btn secondary" type="button" aria-label="تسجيل صوت وتحويله إلى نص">🎙 <span>مايك</span></button><button id="aiSend" class="btn primary" type="submit">إرسال</button></div></form></section></div>`;
  $('#workspace .ai-chat-layout').insertAdjacentHTML('beforeend', `<aside class="panel ai-library"><div class="panel-head"><div><h3>مكتبة AI ديسكوكو</h3><small>${fmt(aiPromptLibrary.length)} إجراء قابل للمراجعة والتنفيذ</small></div></div><div class="ai-library-controls"><label for="aiLibrarySearch" class="sr-only">ابحث في الإجراءات</label><input id="aiLibrarySearch" type="search" placeholder="ابحث عن إجراء…"><div id="aiLibraryCategories" class="ai-library-categories"></div></div><div id="aiLibraryList" class="ai-library-list"></div><p class="ai-library-note">اختر إجراءً وأرسل القالب كما هو. أكمل بياناته في بطاقة المراجعة، وشاهد شكله في سيرفرك قبل التأكيد.</p></aside>`);
  $('#workspace .page-head').classList.add('ai-page-head');
  $('#workspace .page-head').append($('#workspace .ai-bot-connect'));
  $('#workspace .page-head').insertAdjacentHTML('afterend', botHierarchyNotice('تنفيذ تعديلات AI على القنوات والرتب'));
  $('#assistantForm').insertAdjacentHTML('afterbegin', '<div id="aiTemplateDraft" class="ai-template-draft" hidden></div>');
  const list = $('#aiConversations'), thread = $('#aiMessages'), notice = $('#aiNotice'), input = $('#assistantPrompt');
  let connectedAiBot = null;
  const renderAiBotConnection = () => {
    const target = $('#aiBotConnection'); if (!target || !active()) return;
    state.aiBotName = connectedAiBot?.name || null;
    const retryAt = connectedAiBot?.retryAt && new Date(connectedAiBot.retryAt).getTime() > Date.now() ? `؛ المحاولة التالية ${new Date(connectedAiBot.retryAt).toLocaleString('ar-SA')}` : '';
    target.innerHTML = connectedAiBot ? `<div class="ai-bot-connected"><b>✓ ${esc(connectedAiBot.name)}</b><small>${connectedAiBot.online ? 'متصل؛ يعتمد النشر على صلاحياته في القناة' : `غير متصل الآن؛ لن يتم النشر حتى يعود${retryAt}`}</small>${!connectedAiBot.memberJoins ? '<small>للترحيب التلقائي: فعّل Server Members Intent وأعد الربط.</small>' : ''}</div><button id="aiBotDisconnect" class="btn small secondary" type="button">فصل البوت</button>` : '<button id="aiBotConnect" class="btn small primary" type="button">ربط بوتي</button>';
    if (connectedAiBot) $('#aiBotDisconnect').onclick = run(async () => {
      if (!window.confirm('سيُفصل البوت الخاص عن هذا السيرفر. المنشورات التفاعلية السابقة قد تتوقف حتى تعيد ربطه. هل تريد المتابعة؟')) return;
      await api('/api/ai/bot-connection', { method: 'DELETE', body: JSON.stringify({ guildId: guild }) });
      connectedAiBot = null; renderAiBotConnection(); toast('فُصل بوتك الخاص. سيستخدم AI بوت ديسكوكو في المنشورات الجديدة.');
    });
    else $('#aiBotConnect').onclick = () => {
      modal('ربط بوتك الخاص', `<p>أنشئ بوتًا في Discord Developer Portal وأضفه إلى ${esc(state.data?.guild?.name || 'سيرفرك')}، ثم انسخ رمزه هنا. لن يظهر الرمز مجددًا بعد الحفظ.</p><label>رمز البوت<input id="aiBotToken" type="password" autocomplete="off" spellcheck="false" placeholder="ألصق Bot Token هنا"></label><p class="form-note">فعّل Server Members Intent إذا أردت الترحيب التلقائي. لا تضع الرمز في المحادثة أو في رسالة Discord.</p><a href="/ai-bot-guide.html" target="_blank" rel="noopener noreferrer">شرح الإنشاء والإضافة خطوة بخطوة ↗</a>`, '<button id="aiBotCancel" class="btn secondary" type="button">إلغاء</button><button id="aiBotSave" class="btn primary" type="button">تحقق واربط</button>');
      $('#aiBotCancel').onclick = closeDialog;
      $('#aiBotSave').onclick = run(async () => {
        const button = $('#aiBotSave'); button.disabled = true; button.textContent = 'جارٍ التحقق…';
        try { const result = await api('/api/ai/bot-connection', { method: 'POST', body: JSON.stringify({ guildId: guild, token: $('#aiBotToken').value }) }); connectedAiBot = result.bot; closeDialog(); renderAiBotConnection(); toast(result.pending ? `حُفظ ربط ${connectedAiBot.name}؛ سيتصل تلقائيًا بعد انتهاء مهلة Discord.` : `تم ربط ${connectedAiBot.name} بنجاح.`); }
        catch (error) { const message = $('#dialogError'); message.textContent = error.message; if (error.inviteUrl?.startsWith('https://discord.com/oauth2/authorize?')) { const link = document.createElement('a'); link.href = error.inviteUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'أضف البوت إلى السيرفر ↗'; message.append(document.createElement('br'), link); } message.hidden = false; button.disabled = false; button.textContent = 'تحقق واربط'; }
      });
    };
  };
  api(`/api/ai/bot-connection?guildId=${encodeURIComponent(guild)}`).then(result => { if (active()) { connectedAiBot = result.bot; renderAiBotConnection(); } }).catch(() => { if (active()) $('#aiBotConnection').textContent = 'تعذر التحقق من الربط الآن. حدّث الصفحة للمحاولة مجددًا.'; });
  let libraryCategory = 'الكل', selectedTemplate = null;
  const previewMemberRail = () => `<aside class="ai-discord-members"><b>الأعضاء ${Number.isFinite(Number(state.data?.onlineMembers)) && state.data?.onlineMembers !== null ? `— ${fmt(state.data.onlineMembers)} تقريبًا` : ''}</b>${state.data?.bot?.online ? '<div class="ai-discord-member"><span class="ai-discord-member-avatar">◈<i></i></span><span>ديسكوكو<small>BOT</small></span></div>' : ''}<p>أسماء المتصلين الفعلية تظهر في Discord؛ المعاينة لا تخمّنها.</p></aside>`;
  const renderLibrary = () => {
    $('#aiLibraryCategories').innerHTML = ['الكل', ...new Set(aiPromptLibrary.map(item => item.category))].map(category => `<button type="button" class="${category === libraryCategory ? 'active' : ''}" data-ai-category="${esc(category)}">${esc(category)}</button>`).join('');
    $('#aiLibraryCategories').querySelectorAll('[data-ai-category]').forEach(button => button.onclick = () => { libraryCategory = button.dataset.aiCategory; renderLibrary(); });
    const query = $('#aiLibrarySearch').value.trim().toLocaleLowerCase('ar');
    const matched = aiPromptLibrary.map((item, index) => ({ ...item, index })).filter(item => (libraryCategory === 'الكل' || item.category === libraryCategory) && (!query || `${item.title} ${item.category} ${item.prompt}`.toLocaleLowerCase('ar').includes(query)));
    $('#aiLibraryList').innerHTML = matched.length ? matched.map(item => `<button type="button" class="ai-library-item" data-ai-template="${item.index}"><span>⚡ إجراء بعد المراجعة</span><b>${esc(item.title)}</b><small>${esc(item.prompt)}</small><small>المسار: ${esc(aiLibraryFlow(item))}</small></button>`).join('') : '<p class="ai-library-empty">لا توجد نتائج. جرّب كلمة أخرى.</p>';
    $('#aiLibraryList').querySelectorAll('[data-ai-template]').forEach(button => button.onclick = () => {
      selectedTemplate = aiPromptLibrary[Number(button.dataset.aiTemplate)];
      if (selected && messages.length) {
        selected = ''; messages = []; sessionStorage.removeItem(storageKey); renderList(); renderMessages();
        notice.textContent = 'بدأت مسودة جديدة حتى لا تختلط المهمة بسياق محادثة سابقة.';
      }
      input.value = selectedTemplate.prompt;
      $('#aiTemplateDraft').hidden = false;
      $('#aiTemplateDraft').innerHTML = `<div><b>مسودة: ${esc(selectedTemplate.title)}</b><small>${esc(aiLibraryFlow(selectedTemplate))}. تقدر ترسلها كما هي وتكمل التفاصيل في بطاقة المراجعة.</small></div><button id="aiClearTemplate" type="button" class="btn small secondary">مسح المسودة</button>`;
      $('#aiClearTemplate').onclick = () => { selectedTemplate = null; input.value = ''; $('#aiTemplateDraft').hidden = true; input.focus(); };
      input.focus(); input.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  };
  $('#aiLibrarySearch').oninput = renderLibrary;
  renderLibrary();
  let attachedFile = null;
  let previewUrl = '';
  const showAttachment = () => { const bar = $('#aiAttachment'); if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = attachedFile?.type.startsWith('image/') ? URL.createObjectURL(attachedFile) : ''; bar.hidden = !attachedFile; bar.innerHTML = attachedFile ? `${previewUrl ? `<img src="${previewUrl}" alt="معاينة الصورة المرفقة">` : '📎'}<span>${esc(attachedFile.name)} · ${previewUrl ? 'ستظهر مع رسالتك ويمكن إرفاقها عند النشر في Discord. تحليل محتواها يتطلب اتصال نموذج الرؤية المحلي.' : 'سيضاف محتواه إلى سؤالك'}</span><button id="aiRemoveFile" type="button" class="btn small secondary">إزالة</button>` : ''; if (attachedFile) $('#aiRemoveFile').onclick = () => { attachedFile = null; $('#aiFile').value = ''; showAttachment(); }; };
  $('#aiAttach').onclick = () => $('#aiFile').click();
  $('#aiFile').onchange = event => { const file = event.target.files[0]; if (!file) return; const limit = file.type === 'image/gif' ? 20 : 10; if (file.size > limit * 1024 * 1024) { toast(`الملف أكبر من ${limit} ميجابايت.`); event.target.value = ''; return; } attachedFile = file; showAttachment(); };
  const renderProposal = item => {
    const proposal = item.status === 'completed' ? item.proposal : null;
    if (!proposal) return '';
    const interactiveSummary = proposal.interactive?.kind === 'giveaway' ? `🎉 جيف آواي${proposal.interactive.prize ? `: ${esc(proposal.interactive.prize)}` : ' · أكمل الجائزة والمدة في بطاقة المراجعة'}${proposal.interactive.durationMinutes ? ` · ${esc(proposal.interactive.winnerCount)} فائز · ${esc(proposal.interactive.durationMinutes)} دقيقة` : ''}` : proposal.interactive?.kind === 'poll' ? `📊 استطلاع${proposal.interactive.question ? `: ${esc(proposal.interactive.question)}` : ' · أكمل السؤال والخيارات في بطاقة المراجعة'}` : proposal.interactive?.kind === 'scheduled_event' ? '🗓️ حدث Discord أصلي يظهر في Events' : proposal.interactive?.kind === 'event' ? '🎊 إعلان فعالية مع تسجيل اختياري' : proposal.interactive?.kind === 'welcome' ? '👋 ترحيب تلقائي لكل عضو جديد' : proposal.interactive?.kind === 'rules' ? '📜 بطاقة قوانين السيرفر · اختر طريقة العرض وراجعها' : proposal.interactive?.kind === 'channel_control' ? '⚙️ تحكم بالقناة · راجع الصلاحيات والتفاصيل' : `🎫 لوحة تذاكر${proposal.interactive?.title ? `: ${esc(proposal.interactive.title)}` : ' · أكمل العنوان والوصف في بطاقة المراجعة'}`;
    return `<div class="ai-action-card"><span class="ai-action-step">${proposal.draft ? 'أكمل التفاصيل قبل التنفيذ' : 'الخطوة الأخيرة قبل التنفيذ'}</span><b>راجع ما سيتغير في ${esc(state.data?.guild?.name || 'سيرفرك')}</b><p><strong>طلبك:</strong> ${esc(proposal.review_request || item.prompt)}</p>${proposal.message ? `<p><strong>رسالة Discord:</strong> ${esc(proposal.message.content || 'حدد القناة واكتب النص النهائي في بطاقة المراجعة.')}</p>${item.sent_message_id ? `<a class="btn small secondary" href="https://discord.com/channels/${encodeURIComponent(guild)}/${encodeURIComponent(item.sent_channel_id)}/${encodeURIComponent(item.sent_message_id)}" target="_blank" rel="noopener noreferrer">تم الإرسال · عرض في Discord</a>` : `<button class="btn primary small" type="button" data-ai-message="${esc(item.id)}">مراجعة الرسالة وتأكيد النشر</button>`}` : ''}${proposal.interactive ? `<p><strong>${proposal.interactive.kind === 'rules' ? 'بطاقة النشر' : 'النظام التفاعلي'}:</strong> ${interactiveSummary}${item.has_attachment && proposal.interactive.kind !== 'poll' ? ' · 🖼️ مع بنر' : ''}</p>${item.interactive_kind === 'channel_control' ? '<span class="badge good">تم تعديل القناة</span>' : item.interactive_kind === 'welcome' ? '<span class="badge good">الترحيب التلقائي مفعّل</span>' : item.interactive_kind === 'scheduled_event' && item.interactive_message_id ? `<a class="btn small secondary" href="https://discord.com/events/${encodeURIComponent(guild)}/${encodeURIComponent(item.interactive_message_id)}" target="_blank" rel="noopener noreferrer">تم الإنشاء · عرض الحدث في Discord</a>` : item.interactive_message_id ? `<a class="btn small secondary" href="https://discord.com/channels/${encodeURIComponent(guild)}/${encodeURIComponent(item.interactive_channel_id)}/${encodeURIComponent(item.interactive_message_id)}" target="_blank" rel="noopener noreferrer">تم النشر · عرض في Discord</a>` : `<button class="btn primary small" type="button" data-ai-interactive="${esc(item.id)}">إكمال التفاصيل ومراجعة النشر</button>`}` : ''}<small>${item.sent_message_id || item.interactive_message_id || ['welcome', 'scheduled_event'].includes(item.interactive_kind) || item.change_set_status === 'succeeded' ? 'راجع العملية المنفذة في السجل.' : 'لم يُنفّذ شيء بعد. يمكنك مراجعة التفاصيل قبل التأكيد.'}</small></div>`;
  };
  const renderList = () => {
    list.innerHTML = conversations.length ? conversations.map(item => `<div class="ai-conversation-row ${item.id === selected ? 'active' : ''}"><button type="button" class="ai-conversation" data-ai-conversation="${esc(item.id)}"><b>${esc(item.title)}</b><small>${new Date(item.updated_at).toLocaleDateString('ar-SA')}</small></button><button type="button" class="ai-delete-conversation" data-ai-delete="${esc(item.id)}" aria-label="حذف محادثة ${esc(item.title)}" title="حذف المحادثة">⌫</button></div>`).join('') : '<p class="ai-empty-list">محادثاتك ستظهر هنا بعد أول رسالة.</p>';
    list.querySelectorAll('[data-ai-conversation]').forEach(button => button.onclick = () => { selected = button.dataset.aiConversation; sessionStorage.setItem(storageKey, selected); renderList(); loadMessages().catch(error => { notice.textContent = error.message; }); });
    list.querySelectorAll('[data-ai-delete]').forEach(button => button.onclick = () => {
      const conversation = conversations.find(item => item.id === button.dataset.aiDelete); if (!conversation) return;
      confirmDialog('حذف المحادثة؟', `ستُحذف محادثة «${conversation.title}» ورسائلها ومرفقاتها نهائيًا من ديسكوكو. لن تُحذف الرسائل أو الأنظمة التي سبق نشرها داخل Discord.`, 'حذف المحادثة', async () => {
        await api(`/api/ai/conversations/${encodeURIComponent(conversation.id)}`, { method: 'DELETE' });
        if (selected === conversation.id) { selected = ''; messages = []; sessionStorage.removeItem(storageKey); }
        closeDialog(); await refreshList(); renderMessages(); toast('حُذفت المحادثة.');
      });
    });
  };
  const renderMessages = () => {
    $('#aiChatTitle').textContent = conversations.find(item => item.id === selected)?.title || 'محادثة جديدة';
    thread.innerHTML = messages.length ? messages.map(item => `<div class="ai-turn"><div class="ai-bubble user"><b>أنت</b><div>${esc(item.prompt)}</div>${item.has_attachment ? `<img class="ai-sent-image" src="/api/ai/requests/${encodeURIComponent(item.id)}/attachment" alt="الصورة المرفقة بهذه الرسالة">` : ''}</div><div class="ai-bubble assistant"><b>AI ديسكوكو</b><div>${esc(item.status === 'completed' ? item.answer || '' : item.status === 'failed' ? item.error || 'تعذر توليد الرد. حاول مجددًا.' : 'جارٍ تجهيز الرد…')}</div>${item.status === 'completed' && item.answer && !item.proposal && !item.sent_message_id && item.can_publish_answer !== false ? `<button class="btn small secondary" type="button" data-ai-publish-answer="${esc(item.id)}">حوّل الرد إلى رسالة للمراجعة</button>` : ''}${item.status === 'completed' && item.can_select_step && aiActionChoices(item.answer).length ? `<div class="ai-choice-list"><small>اختر فكرة أو خطوة لنجهز تطبيقها:</small>${aiActionChoices(item.answer).map((choice, index) => `<button class="btn small secondary" type="button" data-ai-choice="${esc(item.id)}" data-choice-index="${index}">${esc(choice.slice(0, 95))}</button>`).join('')}</div>` : ''}${item.sent_message_id && !item.proposal ? `<a class="btn small secondary" href="https://discord.com/channels/${encodeURIComponent(guild)}/${encodeURIComponent(item.sent_channel_id)}/${encodeURIComponent(item.sent_message_id)}" target="_blank" rel="noopener noreferrer">عرض الرسالة المنشورة في Discord</a>` : ''}</div>${renderProposal(item)}</div>`).join('') : `<div class="ai-welcome"><span>✦</span><h2>أهلًا، أنا AI ديسكوكو</h2><p>قل لي وش تحتاج في سيرفرك، وبساعدك بخطوات واضحة. تقدر تتابع معي في نفس المحادثة، وسأفهم سياق كلامنا.</p><div class="ai-suggestions"><button type="button" data-ai-suggestion="اقترح لي ترتيب رومات لسيرفر ألعاب">رتب لي الرومات</button><button type="button" data-ai-suggestion="اقترح رتب وصلاحيات مناسبة لمجتمعي">نظّم الرتب</button></div></div>`;
    thread.querySelectorAll('.ai-turn').forEach((turn, index) => {
      const item = messages[index];
      if (item?.status !== 'completed' || !item.can_select_step || aiActionChoices(item.answer).length) return;
      const button = document.createElement('button'); button.className = 'btn small secondary'; button.type = 'button'; button.textContent = 'اختر خطوة قابلة للتطبيق';
      button.onclick = () => { input.value = `أريد تطبيق نتيجة «${item.library_title || item.prompt.slice(0, 80)}» في سيرفري. اختر معي خطوة فعلية محددة من الرد السابق، واعرض فقط ما يمكن للبوت تنفيذه للمراجعة. لا تنشر الخطة كاملة كرسالة، واسألني عن التفاصيل الضرورية إن نقصت.`.slice(0, 1500); input.focus(); input.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); };
      turn.querySelector('.ai-bubble.assistant')?.appendChild(button);
    });
    thread.querySelectorAll('[data-ai-suggestion]').forEach(button => button.onclick = () => { input.value = button.dataset.aiSuggestion; input.focus(); });
    thread.querySelectorAll('[data-ai-choice]').forEach(button => button.onclick = () => {
      const item = messages.find(entry => entry.id === button.dataset.aiChoice);
      const choice = aiActionChoices(item?.answer)[Number(button.dataset.choiceIndex)];
      if (!choice) return;
      input.value = `اخترت هذه الفكرة من خطتك: «${choice}». أريد تطبيقها في سيرفري. حدد الإجراء الحقيقي الذي يحققها، واعرض خطواته للمراجعة. لا تنشر شرح الفكرة نفسه كرسالة، ولا تستبدلها بفكرة مختلفة. اسألني عن التفاصيل الضرورية إن نقصت، ووضح إذا كان جزء منها غير مدعوم حاليًا.`.slice(0, 1500);
      input.focus(); input.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
    thread.querySelectorAll('[data-ai-publish-answer]').forEach(button => button.onclick = () => {
      const item = messages.find(entry => entry.id === button.dataset.aiPublishAnswer);
      if (!item?.answer || item.status !== 'completed') return;
      const textChannels = (state.data.channels || []).filter(channel => [0, 5].includes(channel.type));
      modal('حوّل الرد إلى رسالة', `<p class="form-note">هذا الرد لم يُنشر بعد. حرّر النص وحدد القناة؛ لن يرسل البوت شيئًا حتى تؤكد.</p><label>قناة النشر<select id="aiAnswerChannel"><option value="">اختر قناة نصية</option>${textChannels.map(channel => `<option value="${esc(channel.id)}">#${esc(channel.name)}</option>`).join('')}</select></label><label>النص النهائي<textarea id="aiAnswerContent" rows="8" maxlength="1800">${esc(item.answer.slice(0, 1800))}</textarea></label><label class="check-row"><input id="aiAnswerConfirmed" type="checkbox">راجعت النص والقناة وأوافق على نشره.</label>`, '<button class="btn secondary" id="aiAnswerCancel">إلغاء</button><button class="btn primary" id="aiAnswerSend" disabled>نعم، أؤكد النشر</button>');
      $('#aiAnswerCancel').onclick = closeDialog;
      $('#aiAnswerConfirmed').onchange = event => { $('#aiAnswerSend').disabled = !event.target.checked; };
      $('#aiAnswerSend').onclick = async event => { event.currentTarget.disabled = true; try {
        if (!$('#aiAnswerChannel').value) throw Error('اختر القناة التي ستُنشر فيها الرسالة.');
        await api(`/api/ai/requests/${encodeURIComponent(item.id)}/send-message`, { method: 'POST', body: JSON.stringify({ confirmed: true, publishAnswer: true, channelId: $('#aiAnswerChannel').value, content: $('#aiAnswerContent').value }) });
        closeDialog(); await loadMessages(); toast('نُشرت الرسالة في Discord.');
      } catch (error) { modalError(error); $('#aiAnswerSend').disabled = false; } };
    });
    thread.querySelectorAll('[data-ai-message]').forEach(button => button.onclick = () => {
      const item = messages.find(entry => entry.id === button.dataset.aiMessage);
      if (!item?.proposal?.message) return;
      const textChannels = (state.data.channels || []).filter(channel => [0, 5].includes(channel.type));
      modal('مراجعة الرسالة قبل إرسالها', `<label>قناة النشر<select id="aiMessageChannel"><option value="">اختر قناة نصية</option>${textChannels.map(channel => `<option value="${esc(channel.id)}" ${channel.name.toLowerCase() === item.proposal.message.channel.toLowerCase() ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}</select></label><label>نص الرسالة<textarea id="aiMessageContent" rows="5" maxlength="1800">${esc(item.proposal.message.content)}</textarea></label>${item.has_attachment ? `<div class="ai-review-image"><img src="/api/ai/requests/${encodeURIComponent(item.id)}/attachment" alt="الصورة المرفقة مع طلبك"><span>ستُرسل هذه الصورة مع الرسالة إلى Discord</span></div>` : ''}<label>تغيير الصورة أو إرفاق صورة (اختياري)<input id="aiMessageImage" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="form-note">ستُنشر مرة واحدة بواسطة بوت ديسكوكو، ولن تُرسل إشارات جماعية.</p><label class="check-row"><input id="aiMessageConfirmed" type="checkbox">راجعت الرسالة والقناة وأوافق على نشرها.</label>`, '<button class="btn secondary" id="aiMessageCancel">إلغاء</button><button class="btn primary" id="aiMessageSend" disabled>نعم، أؤكد التنفيذ</button>');
      $('#aiMessageContent').closest('label').insertAdjacentHTML('afterend', '<div class="ai-format-toolbar" role="toolbar" aria-label="تنسيق رسالة Discord"><button type="button" data-format="heading" title="عنوان كبير">عنوان</button><button type="button" data-format="bold" title="عريض"><b>عريض</b></button><button type="button" data-format="italic" title="مائل"><i>مائل</i></button><button type="button" data-format="underline" title="تسطير"><u>تسطير</u></button><button type="button" data-format="strike" title="يتوسطه خط"><s>شطب</s></button><button type="button" data-format="spoiler" title="نص مخفي">مخفي</button><button type="button" data-format="quote" title="اقتباس">اقتباس</button><button type="button" data-format="code" title="رمز برمجي">كود</button><button type="button" data-format="link" title="رابط باسم">رابط</button></div><small class="form-note">هذه أدوات تنسيق Discord الفعلية؛ نوع الخط وحجمه الحر لا يتغيران في الرسائل العادية.</small>');
      $('#aiMessageImage').accept = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime';
      $('#aiMessageImage').closest('label').firstChild.textContent = 'صورة حتى 10 ميجابايت أو GIF/فيديو MP4/MOV حتى 20 ميجابايت';
      $('#aiMessageImage').closest('label').insertAdjacentHTML('afterend', '<label>موضع الصورة في Discord<select id="aiMessageImagePosition"><option value="above">فوق النص</option><option value="below">تحت النص</option></select></label>');
      $('#aiMessageImagePosition').closest('label').insertAdjacentHTML('afterend', imageStyleFields('aiMessageImage'));
      $('#aiMessageImagePosition').closest('label').insertAdjacentHTML('afterend', `<section class="ai-discord-preview" aria-label="معاينة الرسالة داخل السيرفر"><div class="ai-discord-preview-head"><b>معاينة داخل ${esc(state.data?.guild?.name || 'سيرفرك')}</b><small>شكل تقريبي قبل الإرسال</small></div><div class="ai-discord-server"><aside class="ai-discord-server-channels"><b>${esc(state.data?.guild?.name || 'السيرفر')}</b>${textChannels.slice(0, 7).map(channel => `<span data-preview-channel="${esc(channel.id)}"># ${esc(channel.name)}</span>`).join('')}</aside><div class="ai-discord-server-chat"><div class="ai-discord-channel-name" id="aiMessagePreviewChannel"></div><div class="ai-discord-bot-name">◈ ديسكوكو <small>BOT</small></div><div class="ai-message-preview-body"><p id="aiMessagePreviewText"></p>${item.has_attachment ? `<img class="ai-discord-banner" src="/api/ai/requests/${encodeURIComponent(item.id)}/attachment" alt="الصورة المرفقة">` : ''}</div></div>${previewMemberRail()}</div></section>`);
      let messagePreviewUrl = '';
      const updateMessagePreview = () => {
        const selectedChannel = $('#aiMessageChannel').selectedOptions[0]?.textContent || 'اختر قناة النشر';
        $('#aiMessagePreviewChannel').textContent = selectedChannel.startsWith('#') ? selectedChannel : `# ${selectedChannel}`;
        $('#aiMessagePreviewText').innerHTML = discordMarkdownPreview($('#aiMessageContent').value.trim() || 'اكتب نص الرسالة لترى المعاينة.');
        document.querySelectorAll('[data-preview-channel]').forEach(entry => entry.classList.toggle('active', entry.dataset.previewChannel === $('#aiMessageChannel').value));
        const body = $('.ai-message-preview-body'), banner = body.querySelector('.ai-discord-banner');
        if (banner) { const visual = banner.closest('.ai-card-image-wrap') || banner; $('#aiMessageImagePosition').value === 'above' ? body.prepend(visual) : body.append(visual); }
        updateStyledImagePreview('aiMessageImage', banner);
      };
      $('#aiMessageContent').oninput = updateMessagePreview;
      document.querySelectorAll('.ai-format-toolbar [data-format]').forEach(formatButton => formatButton.onclick = () => {
        const field = $('#aiMessageContent'), start = field.selectionStart, end = field.selectionEnd;
        const selected = field.value.slice(start, end) || 'النص';
        const wrap = { bold: ['**', '**'], italic: ['*', '*'], underline: ['__', '__'], strike: ['~~', '~~'], spoiler: ['||', '||'], code: ['`', '`'], link: ['[', '](https://example.com)'] }[formatButton.dataset.format];
        const replacement = formatButton.dataset.format === 'heading' ? `# ${selected}` : formatButton.dataset.format === 'quote' ? `> ${selected}` : `${wrap[0]}${selected}${wrap[1]}`;
        field.setRangeText(replacement, start, end, 'select'); field.focus(); updateMessagePreview();
      });
      $('#aiMessageChannel').onchange = updateMessagePreview;
      $('#aiMessageImagePosition').onchange = updateMessagePreview;
      $('#aiMessageImageStyle').onchange = updateMessagePreview;
      $('#aiMessageImageLogo').onchange = updateMessagePreview;
      bindLogoPlacement('aiMessageImage', updateMessagePreview);
      $('#aiMessageImage').onchange = event => {
        if (messagePreviewUrl) URL.revokeObjectURL(messagePreviewUrl);
        const file = event.target.files[0]; if (!file) return;
        messagePreviewUrl = URL.createObjectURL(file);
        let banner = $('.ai-message-preview-body .ai-discord-banner');
        const video = file.type.startsWith('video/');
        if (banner && (banner.tagName === 'VIDEO') !== video) { (banner.closest('.ai-card-image-wrap') || banner).remove(); banner = null; }
        if (!banner) { banner = document.createElement(video ? 'video' : 'img'); banner.className = 'ai-discord-banner'; if (video) banner.controls = true; else banner.alt = 'معاينة الصورة'; $('.ai-message-preview-body').append(banner); }
        banner.src = messagePreviewUrl; updateMessagePreview();
      };
      updateMessagePreview();
      $('#aiMessageCancel').onclick = closeDialog;
      $('#aiMessageConfirmed').onchange = event => { $('#aiMessageSend').disabled = !event.target.checked; };
      $('#aiMessageSend').onclick = async event => { event.currentTarget.disabled = true; try {
        if (!$('#aiMessageChannel').value) throw Error('اختر القناة التي ستُنشر فيها الرسالة.');
        const file = $('#aiMessageImage').files[0];
        if (!file && $('#aiMessageImageStyle').value !== 'normal') throw Error('ارفع صورة للشعار أو التصميم أولًا.');
        const animated = file && (file.type === 'image/gif' || file.type.startsWith('video/'));
        if (animated && $('#aiMessageImageStyle').value !== 'normal') throw Error('الشعار الدائري يحتاج صورة PNG أو JPG أو WebP ثابتة.');
        const image = file && !animated ? await prepareStyledImage(file, 'aiMessageImage') : undefined;
        const media = animated ? await prepareAiMedia(file) : undefined;
        await api(`/api/ai/requests/${encodeURIComponent(item.id)}/send-message`, { method: 'POST', body: JSON.stringify({ confirmed: true, channelId: $('#aiMessageChannel').value, content: $('#aiMessageContent').value, image, media, imagePosition: $('#aiMessageImageStyle').value === 'logo' ? 'logo' : $('#aiMessageImagePosition').value }) });
        closeDialog(); await loadMessages(); toast('نُشرت الرسالة في Discord.');
      } catch (error) { modalError(error); $('#aiMessageSend').disabled = false; } };
    });
    const openNativeEventReview = (item, plan) => {
      const voice = (state.data.channels || []).filter(channel => channel.type === 2);
      const stages = (state.data.channels || []).filter(channel => channel.type === 13);
      const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(18, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const local = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      const body = `<p class="form-note">هذا حدث Discord أصلي يظهر في تبويب Events أعلى السيرفر، وليس رسالة إعلان في قناة. يتيح للأعضاء إبداء اهتمامهم وتلقي تذكير من Discord.</p><div class="ai-native-event-layout"><div class="ai-native-event-fields"><label>مكان الحدث<select id="aiNativeType"><option value="voice">🔊 قناة صوتية</option>${stages.length ? '<option value="stage">🎙️ قناة Stage</option>' : ''}<option value="elsewhere">📍 مكان آخر: رابط أو قناة نصية أو موقع</option></select></label><label id="aiNativeChannelWrap">القناة<select id="aiNativeChannel"></select></label><label id="aiNativeLocationWrap" hidden>الرابط أو اسم المكان<input id="aiNativeLocation" maxlength="100" placeholder="رابط لقاء، #قناة نصية، أو عنوان المكان"></label><label>اسم الحدث<input id="aiNativeTitle" maxlength="100" value="${esc(plan.title || '')}" placeholder="مثال: لقاء المجتمع الأسبوعي"></label><div class="form-grid two"><label>البداية حسب توقيت جهازك<input id="aiNativeStart" type="datetime-local" value="${local(start)}"></label><label>النهاية حسب توقيت جهازك<input id="aiNativeEnd" type="datetime-local" value="${local(end)}"></label></div><label>تكرار الحدث<select id="aiNativeRepeat"><option value="none">مرة واحدة</option><option value="daily">يوميًا</option><option value="weekly">أسبوعيًا</option></select></label><label>الوصف (اختياري)<textarea id="aiNativeDescription" maxlength="1000" rows="4" placeholder="ماذا سيحدث؟ ماذا يحتاج المشارك؟ يمكن إضافة رابط هنا.">${esc(plan.description || '')}</textarea></label><label>غلاف الحدث (اختياري)<input id="aiNativeCover" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><small class="form-note">الصور الثابتة تُجهز إلى 1200×480، وGIF يُرفع كما هو حتى 2 ميجابايت. قد يختلف عرضه داخل Events حسب تطبيق Discord.</small></div><section class="ai-native-event-preview" aria-label="معاينة حدث Discord"><div class="ai-native-event-server">${esc(state.data?.guild?.name || 'سيرفرك')} <span>⌄</span></div><div class="ai-native-event-heading">▣ &nbsp; Events <small>الأحداث القادمة</small></div><div class="ai-native-event-card"><div id="aiNativeCoverPreview" class="ai-native-event-cover">صورة غلاف الحدث</div><div class="ai-native-event-date" id="aiNativePreviewDate"></div><b id="aiNativePreviewTitle">اسم الحدث</b><span id="aiNativePreviewLocation"></span><p id="aiNativePreviewDescription"></p><span class="ai-native-event-interest">مهتم · تذكير من Discord</span></div><small>معاينة تقريبية. يعرض Discord الحدث وفق واجهته وأذونات السيرفر.</small></section></div><label class="check-row"><input id="aiNativeConfirmed" type="checkbox">راجعت مكان الحدث والوقت والغلاف وأوافق على إنشائه في Discord.</label>`;
      modal('إنشاء حدث Discord', body, '<button class="btn secondary" id="aiNativeCancel">إلغاء</button><button class="btn primary" id="aiNativeCreate" disabled>أنشئ الحدث في Discord</button>');
      let coverUrl = '';
      const update = () => {
        const type = $('#aiNativeType').value, channelSelect = $('#aiNativeChannel');
        const old = channelSelect.value;
        channelSelect.innerHTML = `<option value="">اختر ${type === 'stage' ? 'قناة Stage' : 'قناة صوتية'}</option>${(type === 'stage' ? stages : voice).map(channel => `<option value="${esc(channel.id)}">${esc(channel.name)}</option>`).join('')}`;
        if ([...channelSelect.options].some(option => option.value === old)) channelSelect.value = old;
        $('#aiNativeChannelWrap').hidden = type === 'elsewhere'; $('#aiNativeLocationWrap').hidden = type !== 'elsewhere';
        $('#aiNativePreviewTitle').innerHTML = emojiPreviewText($('#aiNativeTitle').value.trim() || 'اسم الحدث');
        $('#aiNativePreviewDescription').innerHTML = discordMarkdownPreview($('#aiNativeDescription').value.trim() || 'تفاصيل الحدث ستظهر هنا.');
        $('#aiNativePreviewLocation').innerHTML = emojiPreviewText(type === 'elsewhere' ? `📍 ${$('#aiNativeLocation').value || 'مكان الحدث أو رابطه'}` : `${type === 'stage' ? '🎙️' : '🔊'} ${channelSelect.selectedOptions[0]?.textContent || 'اختر القناة'}`);
        const begin = new Date($('#aiNativeStart').value), finish = new Date($('#aiNativeEnd').value);
        $('#aiNativePreviewDate').textContent = Number.isFinite(begin.getTime()) && Number.isFinite(finish.getTime()) ? `${begin.toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })} – ${finish.toLocaleTimeString('ar-SA', { timeStyle: 'short' })}${$('#aiNativeRepeat').value === 'none' ? '' : $('#aiNativeRepeat').value === 'daily' ? ' · يوميًا' : ' · أسبوعيًا'}` : 'حدد موعد البداية والنهاية';
      };
      $('#aiNativeType').onchange = update;
      $('#dialogContent').querySelectorAll('input,textarea,select').forEach(control => { if (control.id !== 'aiNativeType' && control.id !== 'aiNativeCover') { control.addEventListener('input', update); control.addEventListener('change', update); } });
      $('#aiNativeCover').onchange = () => { if (coverUrl) URL.revokeObjectURL(coverUrl); const file = $('#aiNativeCover').files[0]; coverUrl = file ? URL.createObjectURL(file) : ''; $('#aiNativeCoverPreview').innerHTML = coverUrl ? `<img src="${coverUrl}" alt="غلاف الحدث الذي رفعته">` : 'صورة غلاف الحدث'; };
      $('#aiNativeCancel').onclick = () => { if (coverUrl) URL.revokeObjectURL(coverUrl); closeDialog(); };
      $('#aiNativeConfirmed').onchange = event => { $('#aiNativeCreate').disabled = !event.target.checked; };
      $('#aiNativeCreate').onclick = async event => { event.currentTarget.disabled = true; try {
        const title = $('#aiNativeTitle').value.trim(), startTime = new Date($('#aiNativeStart').value), endTime = new Date($('#aiNativeEnd').value);
        if (!title || !Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || startTime <= new Date() || endTime <= startTime) throw Error('أكمل عنوان الحدث وحدد بداية مستقبلية ونهاية بعدها.');
        if ($('#aiNativeType').value === 'elsewhere' ? !$('#aiNativeLocation').value.trim() : !$('#aiNativeChannel').value) throw Error('حدد مكان الحدث أو قناته.');
        await api(`/api/ai/requests/${encodeURIComponent(item.id)}/create-scheduled-event`, { method: 'POST', body: JSON.stringify({ confirmed: true, title, description: $('#aiNativeDescription').value, locationType: $('#aiNativeType').value, location: $('#aiNativeLocation').value, channelId: $('#aiNativeChannel').value, startTime: startTime.toISOString(), endTime: endTime.toISOString(), recurrence: $('#aiNativeRepeat').value, image: await prepareNativeEventCover($('#aiNativeCover').files[0]) }) });
        if (coverUrl) URL.revokeObjectURL(coverUrl); closeDialog(); await loadMessages(); toast('أُنشئ الحدث في Events داخل Discord.');
      } catch (error) { modalError(error); $('#aiNativeCreate').disabled = false; } };
      update();
    };
    const openChannelControlReview = (item, plan) => {
      const channels = (state.data.channels || []).filter(channel => [0, 5].includes(channel.type));
      const roles = (state.data.roles || []).filter(role => role.id !== guild && !role.managed);
      const select = `<label>القناة التي تريد تعديلها<select id="aiControlChannel"><option value="">اختر قناة نصية أو قناة إعلانات</option>${channels.map(channel => `<option value="${esc(channel.id)}" ${channel.name.toLowerCase() === String(plan.channel || '').toLowerCase() ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}</select></label>`;
      modal('تحكم بالقناة', `<p class="form-note">يُطبّق التغيير على القناة المحددة فقط. تبقى بقية صلاحيات القناة كما هي، ويمكنك تعديلها لاحقًا.</p>${select}<label>من يستطيع الكتابة؟<select id="aiControlMode"><option value="">اختر طريقة الكتابة</option><option value="open">الجميع</option><option value="locked">منع الأعضاء من الكتابة</option><option value="roles">الرتب التي أحددها فقط</option></select></label><div id="aiControlRoles" hidden><b>الرتب المسموح لها بالكتابة</b><div class="ai-control-role-list">${roles.map(role => `<label class="check-row"><input type="checkbox" data-control-role="${esc(role.id)}">${esc(role.name)}</label>`).join('')}</div><small>حد أقصى 25 رتبة. صلاحية Administrator واستثناءات الأعضاء المباشرة قد تتجاوز هذا القيد داخل Discord.</small></div><div class="form-grid two"><label>اسم القناة<input id="aiControlName" maxlength="100"></label><label>بطء المحادثة بالثواني<input id="aiControlSlowmode" type="number" min="0" max="21600"></label></div><label>وصف القناة<textarea id="aiControlTopic" maxlength="1024" rows="3"></textarea></label><label class="check-row"><input id="aiControlNsfw" type="checkbox">قناة للمحتوى الحساس (NSFW)</label><section class="ai-discord-preview" aria-label="معاينة تغييرات القناة"><div class="ai-discord-preview-head"><b>ما سيتغير في Discord</b><small>معاينة قبل التنفيذ</small></div><div id="aiControlPreview" class="ai-control-preview"></div></section><label class="check-row"><input id="aiControlConfirmed" type="checkbox">راجعت القناة والرتب والصلاحيات وأوافق على تعديلها.</label>`, '<button class="btn secondary" id="aiControlCancel">إلغاء</button><button class="btn primary" id="aiControlLaunch" disabled>تطبيق إعدادات القناة</button>');
      const channelSelect = $('#aiControlChannel');
      const fill = () => { const channel = channels.find(entry => entry.id === channelSelect.value); $('#aiControlName').value = channel?.name || ''; $('#aiControlTopic').value = channel?.topic || ''; $('#aiControlSlowmode').value = Number(channel?.rate_limit_per_user || 0); $('#aiControlNsfw').checked = channel?.nsfw === true; update(); };
      const update = () => {
        const mode = $('#aiControlMode').value;
        $('#aiControlRoles').hidden = mode !== 'roles';
        const selected = [...$('#aiControlRoles').querySelectorAll('[data-control-role]:checked')].map(box => box.closest('label').textContent.trim());
        $('#aiControlPreview').innerHTML = `<b>${esc(channelSelect.selectedOptions[0]?.textContent || 'اختر القناة')}</b><p>${mode === 'open' ? 'يسمح للجميع بالكتابة' : mode === 'locked' ? 'يُمنع الأعضاء من الكتابة' : mode === 'roles' ? `يسمح بالكتابة للرتب: ${esc(selected.join('، ') || 'اختر رتبة')}` : 'اختر من يستطيع الكتابة'}</p><p>الاسم: ${esc($('#aiControlName').value)} · بطء المحادثة: ${esc($('#aiControlSlowmode').value || '0')} ثانية · ${$('#aiControlNsfw').checked ? 'محتوى حساس' : 'محتوى عادي'}</p><p>الوصف: ${esc($('#aiControlTopic').value || 'دون وصف')}</p>`;
        $('#aiControlLaunch').disabled = !$('#aiControlConfirmed').checked || !channelSelect.value || !mode || (mode === 'roles' && !selected.length);
      };
      channelSelect.onchange = fill;
      $('#dialogContent').querySelectorAll('input,select,textarea').forEach(control => { if (control !== channelSelect) { control.addEventListener('input', update); control.addEventListener('change', update); } });
      $('#aiControlCancel').onclick = closeDialog;
      $('#aiControlLaunch').onclick = async event => { event.currentTarget.disabled = true; try {
        const roleIds = [...$('#aiControlRoles').querySelectorAll('[data-control-role]:checked')].map(box => box.dataset.controlRole);
        if (roleIds.length > 25) throw Error('يمكن اختيار 25 رتبة بحد أقصى.');
        await api(`/api/ai/requests/${encodeURIComponent(item.id)}/control-channel`, { method: 'POST', body: JSON.stringify({ confirmed: true, channelId: channelSelect.value, mode: $('#aiControlMode').value, roleIds, name: $('#aiControlName').value, topic: $('#aiControlTopic').value, slowmode: Number($('#aiControlSlowmode').value), nsfw: $('#aiControlNsfw').checked }) });
        closeDialog(); await loadMessages(); toast('تحدثت إعدادات القناة في Discord.');
      } catch (error) { modalError(error); $('#aiControlLaunch').disabled = false; } };
      $('#aiControlMode').value = ''; fill();
    };
    const openSpecialReview = (item, plan) => {
      const channels = (state.data.channels || []).filter(channel => [0, 5].includes(channel.type));
      const channelOptions = `<label>القناة<select id="aiSpecialChannel"><option value="">اختر قناة نصية</option>${channels.map(channel => `<option value="${esc(channel.id)}" ${channel.name.toLowerCase() === String(plan.channel || '').toLowerCase() ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}</select></label>`;
      const format = `<div class="ai-format-toolbar" role="toolbar" aria-label="تنسيق Discord"><button type="button" data-special-format="bold">عريض</button><button type="button" data-special-format="italic">مائل</button><button type="button" data-special-format="underline">تسطير</button><button type="button" data-special-format="strike">شطب</button><button type="button" data-special-format="spoiler">مخفي</button><button type="button" data-special-format="quote">اقتباس</button><button type="button" data-special-format="code">كود</button></div><small class="form-note">هذه تنسيقات Discord المتاحة داخل البطاقة. حجم الخط وشكله يحدده تطبيق Discord.</small>`;
      const pollFields = `<label>سؤال الاستطلاع<input id="aiSpecialTitle" maxlength="180" value="${esc(plan.question || '')}"></label><label>توضيح السؤال (اختياري)<textarea id="aiSpecialDescription" maxlength="600" rows="2">${esc(plan.description || '')}</textarea></label>${format}<label>صورة أو GIF للسؤال (اختياري)<input id="aiQuestionImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>${imageStyleFields('aiQuestionImage')}<div id="aiPollOptions"></div><button class="btn secondary" type="button" id="aiAddPollOption">＋ أضف خيارًا</button><p class="form-note">من خيارين إلى ٩ خيارات؛ يمكن وضع صورة أو GIF مصغّر لكل خيار. لكل عضو صوت واحد قابل للتغيير.</p>`;
      const eventFields = `<label>عنوان الفعالية<input id="aiSpecialTitle" maxlength="180" value="${esc(plan.title || '🎊 فعالية قادمة')}"></label><label>تفاصيل الفعالية وموعدها<textarea id="aiSpecialDescription" maxlength="1000" rows="4">${esc(plan.description || 'انضم إلينا في فعالية مجتمعنا!')}</textarea></label>${format}<label class="check-row"><input id="aiEventSignup" type="checkbox" checked>تفعيل زر تسجيل المشاركين والعدّاد</label><label>مسمى زر التسجيل<input id="aiEventButton" maxlength="80" value="${esc(plan.buttonLabel || 'سجّل مشاركتك')}"></label><label>صورة أو GIF أو فيديو للفعالية (اختياري)<input id="aiSpecialImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime"></label>${imageStyleFields('aiSpecialImage')}`;
      const welcomeFields = `<label>عنوان بطاقة الترحيب<input id="aiSpecialTitle" maxlength="180" value="${esc(plan.title || '👋 أهلًا بك في مجتمعنا!')}"></label><label>رسالة كل عضو جديد<textarea id="aiSpecialDescription" maxlength="1000" rows="4">${esc(plan.description || 'مرحبًا {member}، سعداء بانضمامك إلينا!')}</textarea></label>${format}<small class="form-note">استخدم {member} لإشارة العضو و{name} لاسمه.</small><label>تصميم الترحيب الخاص بسيرفرك<input id="aiSpecialImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><label class="check-row"><input id="aiWelcomeComposite" type="checkbox">ضع صورة العضو داخل التصميم الذي رفعته</label><div class="form-grid two"><label>موضع صورة العضو<select id="aiWelcomeAvatarPosition"><option value="right">يمين</option><option value="center">الوسط</option><option value="left">يسار</option><option value="top">أعلى بطاقة Discord فقط</option></select></label><label>موضع التصميم عند استخدام بطاقة Discord<select id="aiWelcomeBannerPosition"><option value="below">تحت البطاقة</option><option value="above">فوق البطاقة</option></select></label></div><div id="aiWelcomeCompositeControls" class="form-grid two" hidden><label>ارتفاع صورة العضو <output id="aiWelcomeVerticalValue">50%</output><input id="aiWelcomeAvatarVertical" type="range" min="15" max="85" value="50"></label><label>حجم صورة العضو <output id="aiWelcomeRadiusValue">95</output><input id="aiWelcomeAvatarRadius" type="range" min="60" max="160" value="95"></label><label>شعار السيرفر الدائري (اختياري)<input id="aiWelcomeServerLogo" type="file" accept="image/png,image/jpeg,image/webp"></label>${logoPlacementFields('aiWelcomeServer', 'left')}</div><small id="aiWelcomeGifNote" class="form-note">يمكن دمج صورة العضو داخل PNG أو JPG أو WebP أو GIF متحرك. الحد الأقصى للملف 20 ميجابايت. عند دمج صورة العضو، يلزم ألا يتجاوز GIF مئة إطار أو 60 مليون بكسل عبر الإطارات. للملفات الأكبر، أوقف الدمج وسيظهر GIF كما هو.</small>`;
      const rulesFields = `<label>عنوان بطاقة القوانين<input id="aiSpecialTitle" maxlength="180" value="${esc(plan.title || '📜 قوانين السيرفر')}"></label><label>مقدمة قصيرة (اختياري)<textarea id="aiSpecialDescription" maxlength="500" rows="2">${esc(plan.description || '')}</textarea></label><label>طريقة عرض القوانين<select id="aiRulesStyle"><option value="single" ${plan.style === 'single' ? 'selected' : ''}>بطاقة واحدة</option><option value="sections" ${plan.style === 'sections' ? 'selected' : ''}>أقسام داخل بطاقة واحدة</option><option value="cards" ${plan.style === 'cards' ? 'selected' : ''}>بطاقة مستقلة لكل قانون</option></select></label><div id="aiRulesSingleWrap"><label>نص البطاقة بالكامل<textarea id="aiRulesSingleText" maxlength="3500" rows="12" placeholder="اكتب القوانين وتنسيقها وترقيمها بطريقتك">${esc(plan.singleText || (plan.rules || []).map(rule => typeof rule === 'string' ? rule : rule.body || '').join('\n\n'))}</textarea></label><small class="form-note">بطاقة واحدة بنص حر متعدد الأسطر. الترقيم اختياري وتكتبه بنفسك. الحد الأقصى 3500 حرف.</small></div><div id="aiRulesEntriesWrap" hidden><div id="aiRulesEntries"></div><button class="btn secondary" type="button" id="aiRulesAdd">＋ أضف قسمًا أو قانونًا</button><small class="form-note">لكل قسم عنوان اختياري ونص متعدد الأسطر. يمكنك إضافة حتى 100 قسم، وتُقسّم البطاقات الطويلة تلقائيًا على رسائل متتابعة.</small></div>${format}<label>صورة أو GIF للقوانين (اختياري)<input id="aiSpecialImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>${imageStyleFields('aiSpecialImage')}<label>موضع الصورة العادية<select id="aiRulesImagePosition"><option value="above">فوق بطاقة القوانين</option><option value="below">تحت بطاقة القوانين</option></select></label>`;
      const body = `${channelOptions}${plan.kind === 'poll' ? pollFields : plan.kind === 'event' ? eventFields : plan.kind === 'rules' ? rulesFields : welcomeFields}<label>لون البطاقة<input id="aiSpecialColor" type="color" value="${/^#[0-9a-f]{6}$/i.test(plan.color || '') ? esc(plan.color) : '#8b5cf6'}"></label><section class="ai-discord-preview" aria-label="معاينة داخل السيرفر"><div class="ai-discord-preview-head"><b>معاينة داخل ${esc(state.data?.guild?.name || 'سيرفرك')}</b><small>تتحدث مباشرة مع التعديل</small></div><div class="ai-discord-server"><aside class="ai-discord-server-channels"><b>${esc(state.data?.guild?.name || 'السيرفر')}</b>${channels.slice(0, 7).map(channel => `<span data-preview-channel="${esc(channel.id)}"># ${esc(channel.name)}</span>`).join('')}</aside><div class="ai-discord-server-chat"><div class="ai-discord-channel-name" id="aiSpecialPreviewChannel"></div><div class="ai-discord-bot-name">◈ ديسكوكو <small>BOT</small></div><div class="ai-discord-embed" id="aiSpecialPreviewCard"><div id="aiWelcomePreviewAvatar" class="ai-welcome-preview-avatar" hidden aria-label="صورة العضو الجديد">ع</div><b id="aiSpecialPreviewTitle"></b><div id="aiSpecialPreviewImage"></div><p id="aiSpecialPreviewBody"></p><div id="aiSpecialPreviewOptions"></div></div><span class="ai-discord-button" id="aiSpecialPreviewButton"></span></div>${previewMemberRail()}</div></section><label class="check-row"><input id="aiSpecialConfirmed" type="checkbox">راجعت البطاقة والإعدادات وأوافق على ${plan.kind === 'welcome' ? 'تفعيل الترحيب التلقائي' : 'النشر'}.</label>`;
      modal(plan.kind === 'poll' ? 'مراجعة الاستطلاع' : plan.kind === 'event' ? 'مراجعة إعلان الفعالية' : plan.kind === 'rules' ? 'مراجعة بطاقة القوانين' : 'بطاقة الترحيب التلقائي', body, '<button class="btn secondary" id="aiSpecialCancel">إلغاء</button><button class="btn primary" id="aiSpecialLaunch" disabled>تأكيد التنفيذ</button>');
      if (plan.kind === 'rules') $('#aiRulesEntriesWrap').insertAdjacentHTML('beforeend', '<strong id="aiRulesPageCount" class="form-note"></strong>');
      const optionFiles = [];
      const previewUrls = new Map();
      const fileUrl = file => { if (!file) return ''; if (!previewUrls.has(file)) previewUrls.set(file, URL.createObjectURL(file)); return previewUrls.get(file); };
      const releasePreviews = () => { for (const value of previewUrls.values()) URL.revokeObjectURL(value); previewUrls.clear(); };
      const renderOptions = () => {
        if (plan.kind !== 'poll') return;
        $('#aiPollOptions').innerHTML = optionFiles.map((entry, index) => `<div class="ai-poll-option"><label>الخيار ${index + 1}<input data-poll-text="${index}" maxlength="70" value="${esc(entry.text)}"></label><label>صورة أو GIF صغير للخيار (اختياري)<input data-poll-image="${index}" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><button type="button" class="btn small secondary" data-poll-remove="${index}" ${optionFiles.length <= 2 ? 'disabled' : ''}>حذف الخيار</button></div>`).join('');
        $('#aiPollOptions').querySelectorAll('[data-poll-text]').forEach(input => input.oninput = () => { optionFiles[Number(input.dataset.pollText)].text = input.value; update(); });
        $('#aiPollOptions').querySelectorAll('[data-poll-image]').forEach(input => input.onchange = () => { optionFiles[Number(input.dataset.pollImage)].file = input.files[0] || null; update(); });
        $('#aiPollOptions').querySelectorAll('[data-poll-remove]').forEach(button => button.onclick = () => { optionFiles.splice(Number(button.dataset.pollRemove), 1); renderOptions(); update(); });
        $('#aiAddPollOption').disabled = optionFiles.length >= 9;
        installAiEmojiPickers();
      };
      if (plan.kind === 'poll') { (plan.options?.length >= 2 ? plan.options : ['', '']).forEach(text => optionFiles.push({ text, file: null })); renderOptions(); $('#aiAddPollOption').onclick = () => { if (optionFiles.length < 9) { optionFiles.push({ text: '', file: null }); renderOptions(); update(); } }; }
      const ruleEntries = plan.kind === 'rules' ? (plan.rules || []).map(rule => typeof rule === 'string' ? { title: '', body: rule } : { title: String(rule.title || ''), body: String(rule.body || '') }) : [];
      if (plan.kind === 'rules' && !ruleEntries.length) ruleEntries.push({ title: '', body: '' });
      let activeRuleBody = null;
      const renderRuleEntries = () => {
        if (plan.kind !== 'rules') return;
        $('#aiRulesEntries').innerHTML = ruleEntries.map((entry, index) => `<div class="ai-rule-edit-box"><label>عنوان القسم أو القانون (اختياري)<input data-rule-title="${index}" maxlength="200" value="${esc(entry.title)}" placeholder="مثال: الاحترام"></label><label>نص القسم أو القانون<textarea data-rule-body="${index}" maxlength="1000" rows="4" placeholder="اكتب نص القانون هنا، ويمكنك استخدام أكثر من سطر">${esc(entry.body)}</textarea></label><div class="ai-rule-edit-actions"><button class="btn text" type="button" data-rule-move="${index}:-1" ${index === 0 ? 'disabled' : ''}>↑ رفع</button><button class="btn text" type="button" data-rule-move="${index}:1" ${index === ruleEntries.length - 1 ? 'disabled' : ''}>↓ تنزيل</button><button class="btn text" type="button" data-rule-remove="${index}" ${ruleEntries.length === 1 ? 'disabled' : ''}>حذف</button></div></div>`).join('');
        $('#aiRulesAdd').disabled = ruleEntries.length >= 100;
        $('#aiRulesEntries').querySelectorAll('[data-rule-title]').forEach(input => input.oninput = () => { ruleEntries[Number(input.dataset.ruleTitle)].title = input.value; update(); });
        $('#aiRulesEntries').querySelectorAll('[data-rule-body]').forEach(input => { input.oninput = () => { ruleEntries[Number(input.dataset.ruleBody)].body = input.value; update(); }; input.onfocus = () => { activeRuleBody = input; }; });
        $('#aiRulesEntries').querySelectorAll('[data-rule-remove]').forEach(button => button.onclick = () => { ruleEntries.splice(Number(button.dataset.ruleRemove), 1); activeRuleBody = null; renderRuleEntries(); update(); });
        $('#aiRulesEntries').querySelectorAll('[data-rule-move]').forEach(button => button.onclick = () => { const [index, delta] = button.dataset.ruleMove.split(':').map(Number); [ruleEntries[index], ruleEntries[index + delta]] = [ruleEntries[index + delta], ruleEntries[index]]; activeRuleBody = null; renderRuleEntries(); update(); });
        installAiEmojiPickers();
      };
      if (plan.kind === 'rules') { renderRuleEntries(); $('#aiRulesAdd').onclick = () => { if (ruleEntries.length >= 100) return; ruleEntries.push({ title: '', body: '' }); renderRuleEntries(); update(); [...$('#aiRulesEntries').querySelectorAll('[data-rule-body]')].at(-1)?.focus(); }; }
      const update = () => {
        const channel = $('#aiSpecialChannel').selectedOptions[0]?.textContent || 'اختر قناة النشر';
        $('#aiSpecialPreviewChannel').textContent = channel;
        document.querySelectorAll('[data-preview-channel]').forEach(entry => entry.classList.toggle('active', entry.dataset.previewChannel === $('#aiSpecialChannel').value));
        $('#aiSpecialPreviewCard').style.borderColor = $('#aiSpecialColor').value;
        if (plan.kind === 'rules') $('#aiSpecialPreviewOptions').style.setProperty('--rules-accent', $('#aiSpecialColor').value);
        $('#aiSpecialPreviewTitle').innerHTML = emojiPreviewText($('#aiSpecialTitle').value || 'العنوان');
        if (plan.kind === 'rules') { $('#aiRulesSingleWrap').hidden = $('#aiRulesStyle').value !== 'single'; $('#aiRulesEntriesWrap').hidden = $('#aiRulesStyle').value === 'single'; }
        const ruleStyle = plan.kind === 'rules' ? $('#aiRulesStyle').value : '';
        const text = plan.kind === 'poll' ? `${$('#aiSpecialDescription').value}\nاختر إجابة واحدة. يمكنك تغيير صوتك.` : plan.kind === 'rules' && ruleStyle === 'single' ? [$('#aiSpecialDescription').value, $('#aiRulesSingleText').value].filter(Boolean).join('\n\n') : plan.kind === 'rules' ? $('#aiSpecialDescription').value : $('#aiSpecialDescription').value.replaceAll('{member}', '@عضو جديد').replaceAll('{name}', 'عضو جديد');
        $('#aiSpecialPreviewBody').innerHTML = discordMarkdownPreview(text);
        const previewOptions = $('#aiSpecialPreviewOptions');
        let rulePageSize = 0, rulePageLength = ($('#aiSpecialTitle').value || '').length + ($('#aiSpecialDescription').value || '').length;
        previewOptions.innerHTML = plan.kind === 'poll' ? optionFiles.map((entry, index) => `<div class="ai-poll-preview-option">${entry.file ? `<img src="${fileUrl(entry.file)}" alt="صورة الخيار ${index + 1}">` : ''}<span>${index + 1}. ${emojiPreviewText(entry.text || 'الخيار')}</span></div>`).join('') : plan.kind === 'rules' && ruleStyle !== 'single' ? ruleEntries.filter(entry => entry.body.trim()).map(entry => {
          const size = entry.title.length + entry.body.length;
          const nextPage = rulePageSize && (rulePageSize >= 8 || rulePageLength + size > 5000);
          if (nextPage) { rulePageSize = 0; rulePageLength = ($('#aiSpecialTitle').value || '').length; }
          rulePageSize++; rulePageLength += size;
          return `${nextPage ? '<div class="ai-rules-page-break">رسالة تالية في Discord</div>' : ''}<div class="${ruleStyle === 'cards' ? 'ai-rules-separate-card' : 'ai-rules-field'}">${entry.title.trim() ? `<b>${emojiPreviewText(entry.title)}</b>` : ''}<p>${discordMarkdownPreview(entry.body)}</p></div>`;
        }).join('') : '';
        if (plan.kind === 'rules') $('#aiRulesPageCount').textContent = `القوانين: ${ruleEntries.length} من 100 · النشر المتوقع: ${rulePageSize ? 1 + previewOptions.querySelectorAll('.ai-rules-page-break').length : 0} رسالة في Discord. لا يلزم حذف القوانين عند تجاوز بطاقة واحدة.`;
        if (plan.kind === 'rules') { if (ruleStyle === 'cards') $('#aiSpecialPreviewCard').after(previewOptions); else $('#aiSpecialPreviewCard').append(previewOptions); }
        const avatarPreview = $('#aiWelcomePreviewAvatar');
        const composite = plan.kind === 'welcome' && $('#aiWelcomeComposite').checked;
        avatarPreview.hidden = plan.kind !== 'welcome' || composite;
        if (plan.kind === 'welcome') {
          $('#aiWelcomeCompositeControls').hidden = !composite;
          $('#aiWelcomeAvatarVertical').closest('label').querySelector('output').textContent = `${$('#aiWelcomeAvatarVertical').value}%`;
          $('#aiWelcomeAvatarRadius').closest('label').querySelector('output').textContent = $('#aiWelcomeAvatarRadius').value;
          const positions = $('#aiWelcomeAvatarPosition');
          positions.querySelector('[value="top"]').disabled = composite;
          positions.querySelector('[value="center"]').disabled = !composite;
          if (composite && positions.value === 'top') positions.value = 'center';
          if (!composite && positions.value === 'center') positions.value = 'right';
          const position = $('#aiWelcomeAvatarPosition').value;
          $('#aiSpecialPreviewCard').dataset.avatarPosition = position;
          avatarPreview.textContent = ($('#aiSpecialTitle').value.match(/\{name\}/) ? 'ع' : '✦');
        }
        $('#aiSpecialPreviewButton').innerHTML = emojiPreviewText(plan.kind === 'poll' ? '📊 تصويت' : plan.kind === 'event' ? $('#aiEventSignup').checked ? `${$('#aiEventButton').value || 'سجّل مشاركتك'} · المسجلون ٠` : 'دون زر تسجيل' : 'يُرسل تلقائيًا عند الانضمام');
        $('#aiSpecialPreviewButton').hidden = plan.kind === 'rules' || plan.kind === 'event' && !$('#aiEventSignup').checked;
        const file = plan.kind === 'poll' ? $('#aiQuestionImage').files[0] : $('#aiSpecialImage').files[0];
        const preview = $('#aiSpecialPreviewImage');
        if (composite && file?.type.startsWith('image/')) {
          const x = { left: 185, center: 600, right: 1015 }[$('#aiWelcomeAvatarPosition').value] / 12;
          const y = Number($('#aiWelcomeAvatarVertical').value);
          const diameter = Number($('#aiWelcomeAvatarRadius').value) / 6;
          preview.innerHTML = `<div class="ai-welcome-image-composite"><img src="${fileUrl(file)}" alt="تصميم الترحيب الذي رفعته"><span class="ai-welcome-image-avatar" style="left:${x}%;top:${y}%;width:${diameter}%" aria-label="مكان صورة العضو الجديد">👤</span></div><small class="form-note">صورة العضو هنا تجريبية؛ تُستخدم صورته الحقيقية عند انضمامه.</small>`;
          const logoFile = $('#aiWelcomeServerLogo').files[0];
          if (logoFile) preview.querySelector('.ai-welcome-image-composite').insertAdjacentHTML('beforeend', `<img class="ai-welcome-server-logo" src="${fileUrl(logoFile)}" style="left:${$('#aiWelcomeServerLogoX').value}%;top:${$('#aiWelcomeServerLogoY').value}%" alt="شعار سيرفرك">`);
        } else preview.innerHTML = file && file.type.startsWith('image/') ? `<img class="ai-special-preview-image" src="${fileUrl(file)}" alt="صورة البطاقة">` : file ? `📎 ${esc(file.name)}` : composite ? '<small class="form-note">ارفع تصميم سيرفرك لتظهر معاينته مع صورة العضو هنا.</small>' : item.has_attachment ? `<img class="ai-special-preview-image" src="/api/ai/requests/${encodeURIComponent(item.id)}/attachment" alt="الصورة المرفقة مع الطلب">` : '';
        if (plan.kind === 'poll') updateStyledImagePreview('aiQuestionImage', preview.querySelector('img'));
        if (['event', 'rules'].includes(plan.kind)) updateStyledImagePreview('aiSpecialImage', preview.querySelector('img'));
        if (plan.kind === 'rules') {
          const card = $('#aiSpecialPreviewCard');
          const logo = $('#aiSpecialImageStyle').value === 'logo';
          if (logo) card.insertBefore(preview, $('#aiSpecialPreviewTitle'));
          else if ($('#aiRulesImagePosition').value === 'below') (ruleStyle === 'cards' ? previewOptions : card).after(preview);
          else card.before(preview);
          preview.classList.toggle('ai-welcome-preview-banner', !logo);
        }
        if (plan.kind === 'welcome') {
          const card = $('#aiSpecialPreviewCard');
          if (composite) card.append(preview);
          else if ($('#aiWelcomeBannerPosition').value === 'above') card.before(preview); else card.after(preview);
          preview.classList.add('ai-welcome-preview-banner');
        }
      };
      $('#dialogContent').addEventListener('input', update); $('#dialogContent').addEventListener('change', update); update();
      if (plan.kind === 'welcome') bindLogoPlacement('aiWelcomeServer', update);
      if (plan.kind === 'poll') bindLogoPlacement('aiQuestionImage', update);
      if (['event', 'rules'].includes(plan.kind)) bindLogoPlacement('aiSpecialImage', update);
      $('#dialogContent').querySelectorAll('[data-special-format]').forEach(button => button.onclick = () => {
        const field = plan.kind === 'rules' ? ($('#aiRulesStyle').value === 'single' ? $('#aiRulesSingleText') : activeRuleBody || $('#aiRulesEntries [data-rule-body]')) : $('#aiSpecialDescription'), start = field.selectionStart, end = field.selectionEnd, selected = field.value.slice(start, end) || 'النص';
        const wrap = { bold: '**', italic: '*', underline: '__', strike: '~~', spoiler: '||', code: '`' }[button.dataset.specialFormat];
        field.setRangeText(button.dataset.specialFormat === 'quote' ? `> ${selected}` : `${wrap}${selected}${wrap}`, start, end, 'select'); field.focus(); update();
      });
      $('#aiSpecialCancel').onclick = () => { releasePreviews(); closeDialog(); };
      $('#aiSpecialConfirmed').onchange = event => { $('#aiSpecialLaunch').disabled = !event.target.checked; };
      $('#aiSpecialLaunch').onclick = async event => { event.currentTarget.disabled = true; try {
        if (!$('#aiSpecialChannel').value || !$('#aiSpecialTitle').value.trim()) throw Error('اختر القناة واكتب عنوان البطاقة.');
        if (plan.kind === 'poll' && [$('#aiQuestionImage').files[0], ...optionFiles.map(entry => entry.file)].filter(Boolean).reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) throw Error('مجموع صور وGIF الاستطلاع يجب ألا يتجاوز 20 ميجابايت.');
        const payload = { confirmed: true, channelId: $('#aiSpecialChannel').value, color: $('#aiSpecialColor').value, ...(plan.kind === 'poll' ? { question: $('#aiSpecialTitle').value, description: $('#aiSpecialDescription').value, options: optionFiles.map(entry => entry.text.trim()), questionImage: await prepareStyledImage($('#aiQuestionImage').files[0], 'aiQuestionImage'), questionStyle: $('#aiQuestionImageStyle').value, optionImages: await Promise.all(optionFiles.map(entry => entry.file ? entry.file.type === 'image/gif' ? prepareAiMedia(entry.file) : prepareAiImage(entry.file) : null)) } : { title: $('#aiSpecialTitle').value, description: $('#aiSpecialDescription').value, ...(plan.kind === 'event' ? { signupEnabled: $('#aiEventSignup').checked, buttonLabel: $('#aiEventButton').value } : plan.kind === 'rules' ? { style: $('#aiRulesStyle').value, singleText: $('#aiRulesSingleText').value, rules: ruleEntries.map(entry => ({ title: entry.title, body: entry.body })) } : { avatarPosition: $('#aiWelcomeAvatarPosition').value, bannerPosition: $('#aiWelcomeBannerPosition').value, composite: $('#aiWelcomeComposite').checked, avatarVertical: Number($('#aiWelcomeAvatarVertical').value), avatarRadius: Number($('#aiWelcomeAvatarRadius').value) }) }) };
        if (plan.kind === 'rules' && (payload.style === 'single' ? !payload.singleText.trim() || payload.singleText.length > 3500 : payload.rules.length < 1 || payload.rules.length > 100 || payload.rules.some(rule => !rule.body.trim() || rule.body.length > 1000 || rule.title.length > 200))) throw Error('أكمل نص البطاقة، أو اكتب نص كل قسم. يمكن إضافة حتى ١٠٠ قسم، وكل مربع يقبل عدة أسطر.');
        if (plan.kind === 'poll' && (payload.options.some(value => !value) || new Set(payload.options.map(value => value.toLocaleLowerCase('ar'))).size !== payload.options.length)) throw Error('اكتب خيارات مختلفة دون ترك خيار فارغ.');
        const file = plan.kind !== 'poll' ? $('#aiSpecialImage').files[0] : null;
        if (plan.kind === 'welcome' && payload.composite && !file) throw Error('ارفع تصميم الترحيب الخاص بسيرفرك أولًا.');
        if (plan.kind === 'welcome' && payload.composite && $('#aiWelcomeServerLogo').files[0]) {
          const avatarX = { left: 185, center: 600, right: 1015 }[$('#aiWelcomeAvatarPosition').value];
          const dx = avatarX - Number($('#aiWelcomeServerLogoX').value) * 12;
          const dy = Number($('#aiWelcomeAvatarVertical').value) * 4.8 - Number($('#aiWelcomeServerLogoY').value) * 4.8;
          if (Math.hypot(dx, dy) < Number($('#aiWelcomeAvatarRadius').value) + 86) throw Error('حرّك شعار السيرفر بعيدًا عن صورة العضو حتى لا يتداخلا.');
        }
        if (['event', 'rules'].includes(plan.kind) && !file && $('#aiSpecialImageStyle').value !== 'normal') throw Error('ارفع صورة للشعار أو التصميم أولًا.');
        if (file) { if (plan.kind === 'welcome' && payload.composite && file.type === 'image/gif') { payload.media = await prepareAiMedia(file); if ($('#aiWelcomeServerLogo').files[0]) payload.logo = await prepareWelcomeLogoOverlay($('#aiWelcomeServerLogo').files[0], $('#aiWelcomeServerLogoX').value, $('#aiWelcomeServerLogoY').value); } else if (plan.kind === 'welcome' && payload.composite) payload.image = await prepareWelcomeBackground(file, $('#aiWelcomeServerLogo').files[0], $('#aiWelcomeServerLogoX').value, $('#aiWelcomeServerLogoY').value); else if (['image/gif', 'video/mp4', 'video/quicktime'].includes(file.type)) { if (['event', 'rules'].includes(plan.kind) && $('#aiSpecialImageStyle').value !== 'normal') throw Error('الشعار الدائري يحتاج صورة ثابتة.'); payload.media = await prepareAiMedia(file); } else payload.image = ['event', 'rules'].includes(plan.kind) ? await prepareStyledImage(file, 'aiSpecialImage') : await prepareAiImage(file); }
        if (['event', 'rules'].includes(plan.kind) && $('#aiSpecialImageStyle').value === 'logo') payload.imagePosition = 'logo';
        else if (plan.kind === 'rules') payload.imagePosition = $('#aiRulesImagePosition').value;
        await api(`/api/ai/requests/${encodeURIComponent(item.id)}/launch-interactive`, { method: 'POST', body: JSON.stringify(payload) });
        releasePreviews(); closeDialog(); await loadMessages(); toast(plan.kind === 'welcome' ? 'فُعّل الترحيب التلقائي للأعضاء الجدد.' : 'نُشرت البطاقة في Discord.');
      } catch (error) { modalError(error); $('#aiSpecialLaunch').disabled = false; } };
    };
    thread.querySelectorAll('[data-ai-interactive]').forEach(button => button.onclick = () => {
      const item = messages.find(entry => entry.id === button.dataset.aiInteractive);
      const plan = item?.proposal?.interactive; if (!plan || !['giveaway', 'tickets', 'poll', 'event', 'welcome', 'scheduled_event', 'rules', 'channel_control'].includes(plan.kind)) return;
      if (plan.kind === 'scheduled_event') return openNativeEventReview(item, plan);
      if (plan.kind === 'channel_control') return openChannelControlReview(item, plan);
      if (['poll', 'event', 'welcome', 'rules'].includes(plan.kind)) return openSpecialReview(item, plan);
      const channels = (state.data.channels || []).filter(channel => [0, 5].includes(channel.type));
      const knownChannel = channels.some(channel => channel.name.toLowerCase() === String(plan.channel || '').toLowerCase());
      const channelField = `<label>قناة النشر<select id="aiInteractiveChannel"><option value="">اختر قناة نصية</option>${channels.map(channel => `<option value="${esc(channel.id)}" ${channel.name.toLowerCase() === String(plan.channel || '').toLowerCase() ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}${plan.kind === 'tickets' ? `<option value="__create__" ${knownChannel ? '' : 'selected'}>＋ أنشئ قناة دعم جديدة</option>` : ''}</select></label>${plan.kind === 'tickets' ? `<label>اسم القناة الجديدة (إذا اخترت إنشاءها)<input id="aiNewSupportChannel" maxlength="100" value="${esc(!knownChannel && plan.channel ? plan.channel : 'الدعم')}"></label>` : ''}`;
      const fields = plan.kind === 'giveaway' ? `${channelField}<label>الجائزة<input id="aiPrize" maxlength="160" value="${esc(plan.prize)}"></label><div class="form-grid two"><label>المدة بالدقائق<input id="aiDuration" type="number" min="5" max="43200" value="${Number(plan.durationMinutes) || 60}"></label><label>عدد الفائزين<input id="aiWinners" type="number" min="1" max="20" value="${Number(plan.winnerCount) || 1}"></label></div><p class="form-note">ينشر البوت زر مشاركة ويسحب الفائزين عشوائيًا عند انتهاء المدة.</p>` : plan.kind === 'poll' ? `${channelField}<label>السؤال<input id="aiPollQuestion" maxlength="180" value="${esc(plan.question)}"></label>${plan.options.map((option, index) => `<label>الخيار ${index + 1}<input data-ai-poll-option maxlength="70" value="${esc(option)}"></label>`).join('')}<p class="form-note">يسمح الاستطلاع بصوت واحد لكل عضو، ويمكنه تغيير اختياره. تظهر النتائج له بعد التصويت.</p>` : `${channelField}<label>عنوان لوحة الدعم<input id="aiTicketTitle" maxlength="100" value="${esc(plan.title)}"></label><label>الوصف<textarea id="aiTicketDescription" maxlength="800" rows="3">${esc(plan.description)}</textarea></label><label>تصنيف التذاكر (اختياري)<select id="aiTicketCategory"><option value="">دون تصنيف</option>${(state.data.channels || []).filter(channel => channel.type === 4).map(channel => `<option value="${esc(channel.id)}">${esc(channel.name)}</option>`).join('')}</select></label><label>رتبة فريق الدعم (مطلوبة)<select id="aiStaffRole"><option value="">اختر رتبة الدعم</option>${(state.data.roles || []).filter(role => role.id !== guild).map(role => `<option value="${esc(role.id)}">${esc(role.name)}</option>`).join('')}</select></label><p class="form-note">يفتح زر الدعم قناة خاصة لكل عضو. التذكرة خاصة بصاحبها ورتبة الدعم المحددة.</p>`;
      modal(plan.kind === 'giveaway' ? 'مراجعة الجيف آواي' : plan.kind === 'poll' ? 'مراجعة الاستطلاع' : 'مراجعة لوحة تذاكر الدعم', `${fields}${plan.kind !== 'poll' ? '<label>بنر اختياري يظهر مع البطاقة<input id="aiInteractiveImage" type="file" accept="image/png,image/jpeg,image/webp"></label><label>موضع البنر<select id="aiInteractiveImagePosition"><option value="above">فوق التفاصيل</option><option value="below">تحت التفاصيل</option></select></label>' : ''}<section class="ai-discord-preview" aria-label="معاينة قبل النشر"><div class="ai-discord-preview-head"><b>معاينة داخل ${esc(state.data?.guild?.name || 'سيرفرك')}</b><small>شكل تقريبي يتحدث مع تعديل الحقول · لا ينشر شيئًا</small></div><div class="ai-discord-server"><aside class="ai-discord-server-channels"><b>${esc(state.data?.guild?.name || 'السيرفر')}</b>${channels.slice(0, 7).map(channel => `<span data-preview-channel="${esc(channel.id)}"># ${esc(channel.name)}</span>`).join('')}</aside><div class="ai-discord-server-chat"><div class="ai-discord-channel-name" id="aiPreviewChannelName"># اختر قناة النشر</div><div class="ai-discord-bot-name">◈ ديسكوكو <small>BOT</small></div>${item.has_attachment && plan.kind !== 'poll' ? `<img class="ai-discord-banner" src="/api/ai/requests/${encodeURIComponent(item.id)}/attachment" alt="البنر المرفق">` : ''}<div class="ai-discord-embed"><b id="aiPreviewTitle"></b><p id="aiPreviewDescription"></p><small id="aiPreviewMeta"></small></div><span class="ai-discord-button" id="aiPreviewButton"></span></div>${previewMemberRail()}</div></section><label class="check-row"><input id="aiInteractiveConfirmed" type="checkbox">راجعت الإعدادات وأوافق على النشر في Discord.</label>`, '<button class="btn secondary" id="aiInteractiveCancel">إلغاء</button><button class="btn primary" id="aiInteractiveLaunch" disabled>نعم، أؤكد التنفيذ</button>');
      if ($('#aiInteractiveImage')) $('#aiInteractiveImagePosition').closest('label').insertAdjacentHTML('afterend', imageStyleFields('aiInteractiveImage'));
      if (plan.kind === 'giveaway') {
        $('#aiPrize').closest('label').insertAdjacentHTML('beforebegin', `<label>عنوان الجيف آواي<input id="aiGiveawayTitle" maxlength="180" value="${esc(plan.title || (plan.prize ? `🎉 جيف آواي: ${plan.prize}` : '🎉 جيف آواي مميز'))}"></label><label>النص الذي سيظهر للأعضاء<textarea id="aiGiveawayDescription" maxlength="1000" rows="3">${esc(plan.description || 'شارك الآن بالضغط على الزر، ونتمنى لك حظًا سعيدًا!')}</textarea></label><label>لون بطاقة الجيف آواي<input id="aiGiveawayColor" type="color" value="#8b5cf6"></label>`);
      }
      if (plan.kind === 'tickets') $('#aiTicketDescription').closest('label').insertAdjacentHTML('afterend', '<label>لون بطاقة الدعم<input id="aiTicketColor" type="color" value="#8b5cf6"></label>');
      installAiEmojiPickers();
      const descriptionField = plan.kind === 'giveaway' ? $('#aiGiveawayDescription') : plan.kind === 'tickets' ? $('#aiTicketDescription') : null;
      if (descriptionField) {
        descriptionField.closest('label').insertAdjacentHTML('afterend', '<div class="ai-format-toolbar" role="toolbar" aria-label="تنسيق نص البطاقة"><button type="button" data-card-format="bold">عريض</button><button type="button" data-card-format="italic">مائل</button><button type="button" data-card-format="underline">تسطير</button><button type="button" data-card-format="strike">شطب</button><button type="button" data-card-format="spoiler">مخفي</button><button type="button" data-card-format="quote">اقتباس</button><button type="button" data-card-format="code">كود</button></div>');
        $('#dialogContent').querySelectorAll('[data-card-format]').forEach(button => button.onclick = () => {
          const start = descriptionField.selectionStart, end = descriptionField.selectionEnd, selected = descriptionField.value.slice(start, end) || 'النص';
          const wrap = { bold: '**', italic: '*', underline: '__', strike: '~~', spoiler: '||', code: '`' }[button.dataset.cardFormat];
          descriptionField.setRangeText(button.dataset.cardFormat === 'quote' ? `> ${selected}` : `${wrap}${selected}${wrap}`, start, end, 'select'); descriptionField.focus(); descriptionField.dispatchEvent(new Event('input'));
        });
      }
      if (plan.kind === 'giveaway' || plan.kind === 'tickets') {
        $('#aiInteractiveImage').accept = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime';
        $('#aiInteractiveImage').closest('label').firstChild.textContent = 'صورة حتى 10 ميجابايت أو GIF/فيديو MP4/MOV حتى 20 ميجابايت';
      }
      if ($('#aiInteractiveImagePosition')) $('#aiInteractiveImagePosition').onchange = event => {
        const preview = $('.ai-discord-preview'), banner = preview.querySelector('.ai-discord-banner'), details = preview.querySelector('.ai-discord-embed');
        if (!banner) return;
        const visual = banner.closest('.ai-card-image-wrap') || banner;
        if (event.target.value === 'below') details.after(visual); else details.before(visual);
      };
      let previewImageUrl = '';
      if ($('#aiInteractiveImage')) $('#aiInteractiveImage').onchange = event => {
        if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
        const file = event.target.files[0]; if (!file) return;
        previewImageUrl = URL.createObjectURL(file);
        const video = file.type.startsWith('video/');
        let banner = $('.ai-discord-banner');
        if (!banner || banner.tagName.toLowerCase() !== (video ? 'video' : 'img')) { const replacement = document.createElement(video ? 'video' : 'img'); replacement.className = 'ai-discord-banner'; if (video) replacement.controls = true; else replacement.alt = 'معاينة البنر'; if (banner) (banner.closest('.ai-card-image-wrap') || banner).replaceWith(replacement); else $('.ai-discord-embed').before(replacement); banner = replacement; }
        banner.src = previewImageUrl;
        if (video) { $('#aiInteractiveImagePosition').value = 'below'; $('#aiInteractiveImagePosition').disabled = true; } else $('#aiInteractiveImagePosition').disabled = false;
        $('#aiInteractiveImagePosition').dispatchEvent(new Event('change'));
      };
      const updateInteractivePreview = () => {
        const value = selector => document.querySelector(selector)?.value?.trim() || '';
        const title = plan.kind === 'giveaway' ? value('#aiGiveawayTitle') || 'عنوان الجيف آواي' : plan.kind === 'poll' ? value('#aiPollQuestion') || 'سؤال الاستطلاع' : value('#aiTicketTitle') || 'عنوان لوحة الدعم';
        const description = plan.kind === 'giveaway' ? `${value('#aiGiveawayDescription')}\n\nالجائزة: ${value('#aiPrize') || '—'}\nمدة المشاركة: ${value('#aiDuration') || '—'} دقيقة · عدد الفائزين: ${value('#aiWinners') || '—'}\n👥 المشاركون: 0` : plan.kind === 'poll' ? [...document.querySelectorAll('[data-ai-poll-option]')].map((field, index) => `${index + 1}. ${field.value.trim()}`).join('\n') : value('#aiTicketDescription');
        const channel = $('#aiInteractiveChannel').selectedOptions[0]?.textContent || 'اختر قناة النشر';
        $('#aiPreviewChannelName').textContent = channel.startsWith('#') ? channel : `# ${channel}`;
        document.querySelectorAll('[data-preview-channel]').forEach(entry => entry.classList.toggle('active', entry.dataset.previewChannel === $('#aiInteractiveChannel').value));
        $('#aiPreviewTitle').innerHTML = emojiPreviewText(title);
        if (plan.kind === 'giveaway' || plan.kind === 'tickets') $('.ai-discord-embed').style.borderColor = (plan.kind === 'giveaway' ? $('#aiGiveawayColor') : $('#aiTicketColor')).value;
        $('#aiPreviewDescription').innerHTML = discordMarkdownPreview(description || 'سيظهر وصفك هنا.');
        $('#aiPreviewMeta').textContent = `قناة النشر: ${channel}`;
        $('#aiPreviewButton').textContent = plan.kind === 'giveaway' ? '🎉 مشاركة' : plan.kind === 'poll' ? '📊 تصويت' : '🎫 فتح تذكرة دعم';
        if ($('#aiInteractiveImageStyle')) {
          const banner = $('.ai-discord-banner'); updateStyledImagePreview('aiInteractiveImage', banner);
          if (banner) {
            const visual = banner.closest('.ai-card-image-wrap') || banner, details = $('.ai-discord-embed');
            if ($('#aiInteractiveImageStyle').value === 'logo') details.prepend(visual);
            else if ($('#aiInteractiveImagePosition').value === 'below') details.after(visual);
            else details.before(visual);
          }
        }
      };
      $('#dialogContent').addEventListener('input', updateInteractivePreview);
      $('#dialogContent').addEventListener('change', updateInteractivePreview);
      if (plan.kind !== 'poll') bindLogoPlacement('aiInteractiveImage', updateInteractivePreview);
      updateInteractivePreview();
      $('#aiInteractiveCancel').onclick = () => { if (previewImageUrl) URL.revokeObjectURL(previewImageUrl); closeDialog(); };
      $('#aiInteractiveConfirmed').onchange = event => { $('#aiInteractiveLaunch').disabled = !event.target.checked; };
      $('#aiInteractiveLaunch').onclick = async event => { event.currentTarget.disabled = true; try {
        const creatingSupportChannel = plan.kind === 'tickets' && $('#aiInteractiveChannel').value === '__create__';
        if (!$('#aiInteractiveChannel').value || (plan.kind === 'giveaway' && (!$('#aiPrize').value.trim() || !$('#aiDuration').value)) || (plan.kind === 'poll' && (!$('#aiPollQuestion').value.trim() || [...document.querySelectorAll('[data-ai-poll-option]')].some(field => !field.value.trim()))) || (plan.kind === 'tickets' && (!$('#aiTicketTitle').value.trim() || !$('#aiTicketDescription').value.trim() || !$('#aiStaffRole').value))) throw Error('أكمل الحقول المطلوبة في بطاقة المراجعة قبل النشر.');
        const imageFile = $('#aiInteractiveImage')?.files[0];
        const animated = imageFile && ['image/gif', 'video/mp4', 'video/quicktime'].includes(imageFile.type);
        if (!imageFile && $('#aiInteractiveImageStyle')?.value !== 'normal') throw Error('ارفع صورة للشعار أو التصميم أولًا.');
        if (animated && $('#aiInteractiveImageStyle')?.value !== 'normal') throw Error('الشعار الدائري يحتاج صورة ثابتة.');
        const body = { confirmed: true, channelId: creatingSupportChannel ? '' : $('#aiInteractiveChannel').value, imagePosition: $('#aiInteractiveImageStyle')?.value === 'logo' ? 'logo' : $('#aiInteractiveImagePosition')?.value || 'above', image: imageFile && !animated ? await prepareStyledImage(imageFile, 'aiInteractiveImage') : undefined, media: animated ? await prepareAiMedia(imageFile) : undefined, ...(plan.kind === 'giveaway' ? { title: $('#aiGiveawayTitle').value, description: $('#aiGiveawayDescription').value, color: $('#aiGiveawayColor').value, prize: $('#aiPrize').value, durationMinutes: Number($('#aiDuration').value), winnerCount: Number($('#aiWinners').value) } : plan.kind === 'poll' ? { question: $('#aiPollQuestion').value, options: [...document.querySelectorAll('[data-ai-poll-option]')].map(field => field.value) } : { title: $('#aiTicketTitle').value, description: $('#aiTicketDescription').value, color: $('#aiTicketColor').value, categoryId: $('#aiTicketCategory').value, staffRoleId: $('#aiStaffRole').value, ...(creatingSupportChannel ? { createChannelName: $('#aiNewSupportChannel').value } : {}) }) };
        await api(`/api/ai/requests/${encodeURIComponent(item.id)}/launch-interactive`, { method: 'POST', body: JSON.stringify(body) });
        closeDialog(); await loadMessages(); toast('نُشر النظام التفاعلي في Discord.');
      } catch (error) { modalError(error); $('#aiInteractiveLaunch').disabled = false; } };
    });
    thread.scrollTop = thread.scrollHeight;
  };
  const refreshList = async () => { const data = await api(`/api/ai/conversations?guildId=${encodeURIComponent(guild)}`); if (!active()) return; conversations = data.conversations || []; if (selected && !conversations.some(item => item.id === selected)) { selected = ''; sessionStorage.removeItem(storageKey); } renderList(); };
  const loadMessages = async () => { if (!selected) { messages = []; renderMessages(); return; } const current = selected; const data = await api(`/api/ai/conversations/${encodeURIComponent(current)}/messages`); if (!active() || current !== selected) return; messages = data.messages || []; renderMessages(); const pending = messages.find(item => ['pending', 'processing'].includes(item.status)); if (pending) poll(pending.id, current); };
  const poll = async (id, conversationId) => { for (let attempt = 0; attempt < 60 && active() && selected === conversationId; attempt++) { await new Promise(resolve => setTimeout(resolve, 3000)); if (!active() || selected !== conversationId) return; try { const { request } = await api(`/api/ai/requests/${id}`); if (['completed', 'failed'].includes(request.status)) { await loadMessages(); await refreshList(); return; } } catch (error) { notice.textContent = error.message; return; } } if (active()) notice.textContent = 'الرد ما زال قيد المعالجة. ستجده هنا عند العودة للمحادثة.'; };
  $('#aiNew').onclick = () => { selected = ''; sessionStorage.removeItem(storageKey); messages = []; notice.textContent = ''; renderList(); renderMessages(); input.focus(); };
  $('#assistantForm').onsubmit = run(async event => {
    event.preventDefault();
    if (busy) return;
    if (!planEnabled) { toast('طوّر باقتك لاستخدام AI ديسكوكو.'); return; }
    if (!available && !selectedTemplate) { toast('الجهاز المحلي غير متصل حاليًا. إجراءات المكتبة الجاهزة ما زالت متاحة.'); return; }
    let prompt = input.value.trim(); if (!prompt) return;
    if (attachedFile?.type === 'text/plain' || attachedFile?.name.toLowerCase().endsWith('.txt')) { const content = await attachedFile.text(); if (content.length > 800) { toast('الملف النصي طويل. الحد 800 حرف.'); return; } prompt = `${prompt}\n\nمحتوى الملف ${attachedFile.name}:\n${content}`; if (prompt.length > 1500) { toast('سؤالك مع الملف يتجاوز 1500 حرف. اختصر النص.'); return; } attachedFile = null; $('#aiFile').value = ''; showAttachment(); }
    busy = true; $('#aiSend').disabled = true; notice.textContent = '';
    try {
      const image = attachedFile?.type === 'image/gif' ? await prepareAiMedia(attachedFile) : attachedFile?.type.startsWith('image/') ? await prepareAiImage(attachedFile) : undefined;
      const result = await api('/api/ai/requests', { method: 'POST', body: JSON.stringify({ guildId: guild, conversationId: selected || undefined, prompt, image, libraryMode: selectedTemplate ? 'execute' : undefined, libraryTitle: selectedTemplate?.title, libraryCategory: selectedTemplate?.category }) });
      if (!active()) return;
      selected = result.conversationId; sessionStorage.setItem(storageKey, selected); input.value = ''; selectedTemplate = null; $('#aiTemplateDraft').hidden = true; attachedFile = null; $('#aiFile').value = ''; showAttachment();
      messages.push({ id: result.id, prompt, status: 'pending', has_attachment: !!image }); renderMessages();
      try { await refreshList(); await loadMessages(); }
      catch (error) { notice.textContent = 'حُفظت رسالتك، لكن تعذر تحديث السجل الآن. أعد فتح المحادثة بعد قليل.'; poll(result.id, selected); }
    } finally { busy = false; if (active()) $('#aiSend').disabled = false; }
  });
  input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#assistantForm').requestSubmit(); } };
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, recordingTimer = null, recordingStart = 0, recordingRequested = false, restartTimer = null, spokenBase = '', completedSpeech = '', sessionSpeech = '';
  const endRecordingUi = () => { clearInterval(recordingTimer); recordingTimer = null; $('#aiRecording').hidden = true; $('#aiVoice').classList.remove('recording'); };
  const stopRecognition = () => { recordingRequested = false; clearTimeout(restartTimer); recognition?.stop(); recognition = null; endRecordingUi(); notice.textContent = 'راجع النص ثم اضغط إرسال.'; input.focus(); };
  $('#aiStopVoice').onclick = stopRecognition;
  $('#aiVoice').onclick = async () => {
    if (recordingRequested) { stopRecognition(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { notice.textContent = 'المايك غير متاح هنا. افتح الموقع في Chrome.'; return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); }
    catch (error) { notice.textContent = ['NotAllowedError','PermissionDeniedError'].includes(error.name) ? 'المايك محظور. اسمح له من أيقونة الموقع بجانب الرابط.' : error.name === 'NotFoundError' ? 'لا يوجد مايك متصل بالجهاز.' : 'تعذر تشغيل المايك. جرّب Chrome مباشرة.'; return; }
    if (!Recognition) { notice.textContent = 'تم السماح بالمايك، لكن تحويل الصوت غير مدعوم هنا.'; return; }
    let devices = []; try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput'); } catch {}
    modal('اختيار الميكروفون', `<p class="form-note">يستخدم تحويل الكلام إلى نص ميكروفون المتصفح الافتراضي. إذا عندك أكثر من جهاز، اختر الميكروفون الافتراضي من إعدادات المتصفح أو النظام قبل البدء.</p><div class="ai-device-list">${devices.map(device => `<div>🎙 ${esc(device.label || 'ميكروفون')}</div>`).join('') || '<div>الميكروفون الافتراضي</div>'}</div><p class="form-note">بعد السماح، سيظهر شريط التسجيل والكلام المكتوب قبل أن تضغط إرسال.</p>`, '<button id="aiVoiceCancel" class="btn secondary" type="button">إلغاء</button><button id="aiVoiceStart" class="btn primary" type="button">ابدأ التسجيل</button>');
    $('#aiVoiceCancel').onclick = closeDialog;
    $('#aiVoiceStart').onclick = () => { closeDialog(); recordingRequested = true; spokenBase = input.value.trim(); completedSpeech = ''; recordingStart = Date.now(); startRecognition(); };
  };
  const startRecognition = () => {
    if (!recordingRequested || !active()) return;
    const current = new Recognition(); recognition = current; sessionSpeech = '';
    current.lang = 'ar-SA'; current.interimResults = true; current.continuous = true;
    current.onstart = () => { $('#aiVoice').classList.add('recording'); $('#aiRecording').hidden = false; if (!recordingTimer) recordingTimer = setInterval(() => { const seconds = Math.floor((Date.now() - recordingStart) / 1000); $('#aiRecordingTime').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }, 1000); notice.textContent = 'تكلّم الآن… سيظهر النص قبل الإرسال. اضغط إيقاف التسجيل عند الانتهاء.'; };
    current.onresult = event => { sessionSpeech = [...event.results].map(result => result[0].transcript).join(' ').trim(); input.value = [spokenBase, completedSpeech, sessionSpeech].filter(Boolean).join(' '); };
    current.onerror = event => { if (['not-allowed','service-not-allowed','audio-capture'].includes(event.error)) { recordingRequested = false; notice.textContent = event.error === 'audio-capture' ? 'تعذر الوصول إلى الميكروفون.' : 'اسمح للمتصفح باستخدام الميكروفون ثم حاول مجددًا.'; } };
    current.onend = () => { if (recognition !== current) return; recognition = null; completedSpeech = [completedSpeech, sessionSpeech].filter(Boolean).join(' '); sessionSpeech = ''; if (recordingRequested && active()) restartTimer = setTimeout(startRecognition, 300); else { endRecordingUi(); if (notice.textContent.startsWith('تكلّم')) notice.textContent = 'راجع النص ثم اضغط إرسال.'; input.focus(); } };
    try { current.start(); } catch { recordingRequested = false; recognition = null; endRecordingUi(); toast('تعذر بدء التسجيل الصوتي.'); }
  };
  try {
    const status = await api('/api/ai/status'); if (!active()) return;
    planEnabled = status.planEnabled; available = status.available && planEnabled;
    $('#aiStatus').className = `badge ${status.available ? 'good' : 'warn'}`;
    $('#aiStatus').textContent = status.available ? 'متصل' : 'الجهاز المحلي غير متصل';
    if (!planEnabled) notice.textContent = 'AI ديسكوكو متاح من باقة Starter. طوّر باقتك لتستخدمه.';
    else if (!status.available) notice.textContent = 'يمكنك قراءة محادثاتك السابقة. لإرسال رسالة جديدة، شغّل AI ديسكوكو على جهاز التشغيل.';
    try { await refreshList(); await loadMessages(); }
    catch (error) { notice.textContent = 'تعذر تحميل السجل من Discord الآن. أعد المحاولة بعد قليل.'; }
  } catch (error) { if (active()) notice.textContent = error.message; }
}
async function commands() {
  const guild = state.guild; const epoch = state.epoch;
  $('#workspace').innerHTML = head('الأوامر', 'اضبط أوامر بوت ديسكوكو المتصل بهذا السيرفر وشاهد مثال الرد.') + connectionNotice() + '<div class="loading" role="status">جارٍ قراءة إعدادات البوت…</div>';
  const [{ settings }, { commands: commandCatalog }] = await Promise.all([api(`/api/guilds/${encodeURIComponent(guild)}/bot-settings`), api('/api/bots/commands')]);
  if (guild !== state.guild || epoch !== state.epoch || screen() !== 'commands') return;
  const commands = commandCatalog.filter(command => command.status === 'available').map(command => [command.key, command.title, command.description]);
  const textChannels = state.data.channels?.filter(channel => [0, 5].includes(channel.type)) || [];
  $('#workspace').innerHTML = head('أوامر ديسكوكو', 'هذه إعدادات أوامر بوت ديسكوكو فقط. إذا اخترت بوتك الخاص، راجع أوامره في تطبيق Discord الذي تملكه.') + connectionNotice() + `<div class="grid-2">${panel('إعدادات Diskoko', `<form id="botForm" class="panel-body form-grid"><label class="check-row"><input id="botEnabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>تفعيل أوامر Diskoko في هذا السيرفر</label><div class="form-grid two"><label>لغة الردود<select id="botLocale"><option value="ar" ${settings.locale === 'ar' ? 'selected' : ''}>العربية</option><option value="en" ${settings.locale === 'en' ? 'selected' : ''}>English</option></select></label><label>قناة سجل الأوامر<select id="logChannel"><option value="">دون سجل رسائل</option>${textChannels.map(channel => `<option value="${esc(channel.id)}" ${settings.log_channel_id === channel.id ? 'selected' : ''}># ${esc(channel.name)}</option>`).join('')}</select></label></div><div>${commands.map(([key, title, description]) => `<div class="row"><label class="check-row"><input class="command-check" type="checkbox" value="${key}" ${settings.command_keys.includes(key) ? 'checked' : ''}></label><div class="row-main"><b>${title} <code>/diskoko ${key}</code></b><small>${description}</small></div><button class="btn text" type="button" data-preview="${key}">معاينة</button></div>`).join('')}</div><p class="form-note">يحفظ التغيير إعدادات أوامر ديسكوكو فقط. لا يغيّر إعدادات بوتك الخاص ولا يمنح أي صلاحيات جديدة.</p><div class="actions"><button class="btn primary" ${!state.data.connection.readable ? 'disabled' : ''}>حفظ إعدادات البوت</button></div></form>`)}${panel('معاينة الرد', '<div class="panel-body"><div class="preview"><b>◈ Diskoko</b> <span class="badge purple">مثال توضيحي</span><div class="message" id="botPreview">أهلًا! اعرض أوامر مجتمعك باستخدام /diskoko help.</div></div><p class="export-note">المعاينة لا ترسل رسالة إلى Discord.</p></div>')}</div>`;
  const examples = Object.fromEntries(commandCatalog.map(command => [command.key, command.example]));
  document.querySelectorAll('[data-preview]').forEach(button => { button.onclick = () => { $('#botPreview').textContent = examples[button.dataset.preview]; }; });
  $('#botForm').onsubmit = run(async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { await api(`/api/guilds/${encodeURIComponent(guild)}/bot-settings`, { method: 'PUT', body: JSON.stringify({ ...settings, enabled: $('#botEnabled').checked, locale: $('#botLocale').value, log_channel_id: $('#logChannel').value || null, command_keys: [...document.querySelectorAll('.command-check:checked')].map(input => input.value) }) }); toast('حُفظت إعدادات البوت لهذا السيرفر.'); } finally { button.disabled = false; } });
}
async function automation() {
  const guild = state.guild;
  $('#workspace').innerHTML = head('رسالتك، في وقتها.', 'جهّز إعلانًا أو تذكيرًا، وراجعه قبل الجدولة.') + '<div class="loading" role="status">جارٍ تحميل الرسائل المجدولة…</div>';
  const { schedules } = await api(`/api/workspace/${encodeURIComponent(guild)}/schedules`);
  if (guild !== state.guild || screen() !== 'automation') return;
  $('#workspace').innerHTML = head('رسالتك، في وقتها.', 'جهّز إعلانًا أو تذكيرًا، وراجعه قبل الجدولة.', `<button class="btn primary" id="newSchedule" ${!state.data.connection.readable ? 'disabled' : ''}>＋ رسالة مجدولة</button>`) + connectionNotice() + `<div class="notice info"><div><b>إرسال بعد موافقتك على الرسالة والموعد.</b><p>لا تُفعّل إشارات الجميع أو الرتب تلقائيًا. قد يتأخر الإرسال إذا توقفت خدمة الاستضافة.</p></div></div>` + panel('جدول الرسائل', schedules.length ? `<div class="rows">${schedules.map(job => `<div class="row"><span class="row-icon">◷</span><div class="row-main"><b>${esc(job.content.slice(0, 100))}</b><small># ${esc(state.data.channels?.find(channel => channel.id === job.channel_id)?.name || 'قناة غير متاحة')} · ${date(job.run_at)} · ${esc(job.timezone)} · ${{ once: 'مرة واحدة', daily: 'كل 24 ساعة', weekly: 'كل 7 أيام' }[job.repeat]}</small>${job.last_error ? `<small>${esc(job.last_error)}</small>` : ''}</div>${status(job.status)}${['scheduled', 'failed'].includes(job.status) ? `<button class="btn small secondary" data-cancel-job="${job.id}">إلغاء</button>` : ''}</div>`).join('')}</div>` : empty('لا توجد رسائل مجدولة', 'جهّز أول إعلان وحدد القناة والوقت. ستجد حالة إرساله هنا.'));
  $('#newSchedule').onclick = scheduleForm;
  document.querySelectorAll('[data-cancel-job]').forEach(button => { button.onclick = () => confirmDialog('إلغاء الرسالة المجدولة؟', 'ستبقى في السجل ولن تُرسل في الموعد القادم.', 'إلغاء الجدولة', async () => { await api(`/api/workspace/${encodeURIComponent(guild)}/schedules/${button.dataset.cancelJob}/cancel`, { method: 'POST', body: '{}' }); closeDialog(); await automation(); }); });
}
function scheduleForm() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  modal('جهّز رسالتك', `<form id="scheduleForm" class="form-grid"><label>القناة<select id="scheduleChannel" required>${(state.data.channels || []).filter(channel => [0, 5].includes(channel.type)).map(channel => `<option value="${esc(channel.id)}"># ${esc(channel.name)}</option>`).join('')}</select></label><label>نص الرسالة<textarea id="scheduleText" rows="4" required maxlength="2000" placeholder="ما الذي تريد إخبار مجتمعك به؟"></textarea></label><div class="form-grid two"><label>موعد الإرسال<input id="scheduleTime" type="datetime-local" required></label><label>التكرار<select id="scheduleRepeat"><option value="once">مرة واحدة</option><option value="daily">كل 24 ساعة</option><option value="weekly">كل 7 أيام</option></select></label></div><p class="form-note">الموعد حسب جهازك: ${esc(timezone)}. التكرار بفواصل زمنية ثابتة، وليس حسب تغيّر التوقيت الصيفي.</p><div class="preview"><b>معاينة الرسالة</b><div class="message" id="schedulePreview">ستظهر رسالتك هنا…</div></div><label class="check-row"><input id="scheduleConfirm" type="checkbox" required>أوافق على إرسال هذه الرسالة في القناة والموعد المحددين.</label></form>`, '<button class="btn primary" form="scheduleForm" type="submit">تأكيد الجدولة</button>');
  $('#scheduleText').oninput = event => { $('#schedulePreview').textContent = event.target.value || 'ستظهر رسالتك هنا…'; };
  $('#scheduleForm').onsubmit = async event => { event.preventDefault(); event.submitter.disabled = true; try { await api(`/api/workspace/${encodeURIComponent(state.guild)}/schedules`, { method: 'POST', body: JSON.stringify({ channel_id: $('#scheduleChannel').value, content: $('#scheduleText').value, run_at: new Date($('#scheduleTime').value).toISOString(), repeat: $('#scheduleRepeat').value, timezone, confirmed: $('#scheduleConfirm').checked }) }); closeDialog(); await automation(); toast('حُفظت الرسالة المجدولة.'); } catch (error) { modalError(error); event.submitter.disabled = false; } };
}
async function analytics() {
  const guild = state.guild; const days = state.days; const d = state.data;
  $('#workspace').innerHTML = head('تعرّف على نبض مجتمعك.', 'مؤشرات نشاط مفهومة، من البيانات التي يجمعها البوت.') + '<div class="loading" role="status">جارٍ قراءة النشاط…</div>';
  const data = await api(`/api/workspace/${encodeURIComponent(guild)}/analytics?days=${days}`);
  if (guild !== state.guild || screen() !== 'analytics' || days !== state.days) return;
  const max = Math.max(1, ...data.members.map(member => member.messages));
  $('#workspace').innerHTML = head('تعرّف على نبض مجتمعك.', 'العضو النشط هو من أرسل رسالة واحدة على الأقل خلال الفترة.', `<select id="period" class="filter-select" aria-label="فترة التحليلات">${[7, 14, 30].map(n => `<option value="${n}" ${days === n ? 'selected' : ''}>آخر ${n} أيام</option>`).join('')}</select>`) + (!d.preferences.analytics_enabled ? `<div class="notice info"><div><b>جمع النشاط غير مفعّل.</b><p>عند تفعيله نحتفظ بأعداد الرسائل وأسماء أصحابها لمدة 30 يومًا، دون تخزين محتوى الرسائل. لا نجلب رسائل الماضي.</p></div><button class="btn primary" id="enableAnalytics">تفعيل جمع النشاط</button></div>` : `<div class="notice info"><div><b>يُجمع النشاط منذ ${date(d.preferences.analytics_started_at)}</b><p>تُستبعد رسائل البوتات. تظهر القنوات التي يستطيع البوت استقبال أحداثها. حدود الأيام حسب UTC.</p></div>${badge('جمع النشاط مفعّل', 'good')}</div>`) + `<div class="metrics">${metric('أعضاء نشطون', data.totals.active_members, `خلال ${days} أيام`, '♧')}${metric('رسائل مسجلة', data.totals.messages, 'دون رسائل البوتات', '#')}${metric('إجمالي الأعضاء', d.members, 'العدد التقريبي الحالي', '◇')}${metric('متصلون الآن', d.onlineMembers, 'العدد التقريبي من Discord', '◉')}</div><div class="grid-2">${panel('الأعضاء الأكثر مشاركة', data.members.length ? `<div class="rows">${data.members.map((member, index) => `<div class="row"><span class="rank">${fmt(index + 1)}</span><div class="row-main"><b>${esc(member.display_name)}</b><small>${fmt(member.active_days)} أيام نشاط</small><div class="rank-bar"><span style="--width:${Math.round(member.messages / max * 100)}%"></span></div></div><span>${fmt(member.messages)} <small>رسالة</small></span></div>`).join('')}</div>` : empty('لا يوجد نشاط مسجل خلال هذه الفترة', d.preferences.analytics_enabled ? 'تبدأ النتائج مع وصول رسائل جديدة يراها البوت.' : 'فعّل جمع النشاط لبدء القياس.'))}${panel('القنوات الأكثر نشاطًا', data.channels.length ? `<div class="rows">${data.channels.map(channel => `<div class="row"><span class="row-icon">#</span><div class="row-main"><b>${esc(d.channels?.find(item => item.id === channel.channel_id)?.name || 'قناة غير متاحة')}</b></div><span>${fmt(channel.messages)} <small>رسالة</small></span></div>`).join('')}</div>` : empty('لا توجد بيانات قنوات بعد', 'ستظهر القنوات بحسب عدد الرسائل المسجلة.'))}</div>${panel('النشاط اليومي', `<div class="panel-body">${data.daily.length ? `<div class="bars" role="img" aria-label="عدد الرسائل يوميًا">${data.daily.map(day => `<div class="bar" title="${esc(day.day)}: ${day.messages}" style="--height:${Math.max(3, day.messages / Math.max(...data.daily.map(item => item.messages)) * 100)}%"><span>${fmt(day.messages)}</span></div>`).join('')}</div><div class="chart-caption"><span>الأيام ذات النشاط المسجل</span><span>آخر ${days} أيام · UTC</span></div>` : '<p>لم تُسجّل رسائل بعد.</p>'}</div>`, '<button class="btn text" id="exportAnalytics">تصدير البيانات ↓</button>')}`;
  $('#period').onchange = run(event => { state.days = Number(event.target.value); return analytics(); });
  $('#enableAnalytics')?.addEventListener('click', () => confirmDialog('تفعيل قياس نشاط المجتمع', 'سيبدأ البوت بتجميع أعداد الرسائل وأسماء المشاركين من الآن. لا يتم حفظ محتوى الرسائل، وتُحفظ الإحصاءات لمدة 30 يومًا.', 'تفعيل جمع النشاط', async () => { await api(`/api/workspace/${encodeURIComponent(guild)}/preferences`, { method: 'PUT', body: JSON.stringify({ analytics_enabled: true }) }); closeDialog(); await loadGuild(); }));
  $('#exportAnalytics').onclick = () => download(`diskoko-activity-${days}-days.json`, { guild: { id: guild, name: d.guild.name }, exported_at: new Date().toISOString(), ...data });
}
function download(name, data) { const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = objectUrl; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
function permissionSummary(value) { const bits = BigInt(value || '0'); const known = [[8n, 'تحكم كامل'], [32n, 'إدارة السيرفر'], [16n, 'إدارة القنوات'], [268435456n, 'إدارة الرتب'], [8192n, 'إدارة الرسائل'], [4n, 'حظر الأعضاء'], [2n, 'طرد الأعضاء'], [1099511627776n, 'إدارة الأعضاء']]; const names = known.filter(([bit]) => (bits & bit) !== 0n).map(([, name]) => name); return names.length ? names.join(' · ') : 'صلاحيات عادية'; }
function activity() {
  const names = { 'change_set.create': 'حُفظت خطة تغييرات', 'change_set.apply': 'طُبقت خطة تغييرات', 'change_set.failed': 'تعثر تطبيق خطة', 'bot.settings.update': 'حُدثت إعدادات البوت', 'guild.verify': 'تم التحقق من الربط', 'guild.rename': 'تغيّر اسم السيرفر', 'schedule.create': 'جُدولت رسالة', 'schedule.cancel': 'أُلغيت رسالة مجدولة', 'analytics.settings': 'حُدث إعداد جمع النشاط' };
  const publications = state.data.publications || [];
  const applied = (state.data.changeSets || []).filter(change => change.status === 'succeeded').map(change => ({ kind: 'plan', at: change.updated_at, name: changeName(change), id: change.id }));
  const published = publications.map(item => ({ kind: 'publication', at: item.published_at, name: item.interactive_kind === 'giveaway' ? `نُشر جيف آواي: ${item.proposal?.interactive?.prize || 'جائزة'}` : item.interactive_kind === 'tickets' ? `نُشرت لوحة تذاكر: ${item.proposal?.interactive?.title || 'الدعم'}` : item.interactive_kind === 'poll' ? `نُشر استطلاع: ${item.proposal?.interactive?.question || 'استطلاع'}` : item.interactive_kind === 'scheduled_event' ? `أُنشئ حدث Discord: ${item.proposal?.interactive?.title || 'حدث'}` : item.interactive_kind === 'event' ? `نُشرت فعالية: ${item.proposal?.interactive?.title || 'فعالية'}` : item.interactive_kind === 'welcome' ? `فُعّل الترحيب التلقائي: ${item.proposal?.interactive?.title || 'ترحيب'}` : item.interactive_kind === 'rules' ? `نُشرت قوانين السيرفر: ${item.proposal?.interactive?.title || 'القوانين'}` : 'نُشرت رسالة', channelId: item.interactive_channel_id || item.sent_channel_id, messageId: item.interactive_message_id || item.sent_message_id }));
  const completed = [...applied, ...published].sort((a, b) => new Date(b.at) - new Date(a.at));
  const completedRows = completed.length ? `<div class="rows">${completed.map(item => `<div class="row"><span class="row-icon">✓</span><div class="row-main"><b>${esc(item.name)}</b><small>${date(item.at)}</small></div>${item.kind === 'plan' ? `<button class="btn text" data-plan="${esc(item.id)}">عرض ←</button>` : item.messageId ? `<a class="btn text" href="https://discord.com/channels/${encodeURIComponent(state.guild)}/${encodeURIComponent(item.channelId)}/${encodeURIComponent(item.messageId)}" target="_blank" rel="noopener noreferrer">عرض في Discord ↗</a>` : '<span class="badge good">مفعّل</span>'}</div>`).join('')}</div>` : empty('لا توجد تغييرات منفذة بعد', 'بعد تأكيد التنفيذ أو النشر ستظهر النتيجة هنا.');
  $('#workspace').innerHTML = head('كل تغيير، وقصته.', 'راجع ما طُبق وما نُشر، ثم الخطط التي لم تنفذها بعد.', '<button class="btn secondary" id="exportActivity">تصدير السجل ↓</button>') + panel(`العمليات المنفذة · ${fmt(completed.length)}`, completedRows) + panel('خطط تنتظر موافقتك', changeRows((state.data.changeSets || []).filter(change => change.status !== 'succeeded'))) + panel('سجل إجراءاتك', state.data.activity.length ? `<div class="rows">${state.data.activity.map(event => `<div class="row"><span class="row-icon">◷</span><div class="row-main"><b>${esc(names[event.action] || 'إجراء على السيرفر')}</b><small>${date(event.created_at)}${event.details?.error ? ` · ${esc(event.details.error)}` : ''}</small></div></div>`).join('')}</div>` : empty('لا توجد إجراءات مسجلة لك بعد', 'ستظهر هنا الإجراءات الجديدة التي تنفذها من لوحة السيرفر.'));
  bindPlans(); $('#exportActivity').onclick = () => download('diskoko-change-history.json', { guild: state.data.guild.name, changeSets: state.data.changeSets, publications, activity: state.data.activity });
}
function safety() {
  const d = state.data; const roles = d.roles || []; const adminRoles = roles.filter(role => (BigInt(role.permissions || '0') & 8n) !== 0n);
  $('#workspace').innerHTML = head('وضوح الصلاحيات، بداية الأمان.', 'افحص بنية الصلاحيات وتحقق من التغييرات قبل تنفيذها.') + connectionNotice() + `<div class="safety-grid">${panel('مراجعة قبل التطبيق', '<div class="panel-body"><span class="badge good">ضمن رحلة التعديل</span><p>إضافة القنوات والرتب وتعديلها تمر بخطة محفوظة وتأكيد منك قبل التنفيذ. تظهر العمليات المكتملة والمتعثرة منفصلة.</p></div>')}${panel('حالة قراءة السيرفر', `<div class="panel-body">${badge(d.connection.readable ? 'القنوات والرتب متاحة' : 'تعذر التحقق', d.connection.readable ? 'good' : 'warn')}<p>نجاح القراءة لا يضمن صلاحية تعديل كل رتبة. يتحقق Discord من الصلاحيات وترتيب رتبة البوت أثناء التنفيذ.</p></div>`)}</div>${panel('رتب تملك صلاحية Administrator', !d.roles ? empty('تعذر قراءة الرتب', 'أكمل التحقق من الاتصال لعرض الصلاحيات.') : adminRoles.length ? `<div class="notice info"><div><b>${fmt(adminRoles.length)} رتب لديها صلاحية واسعة.</b><p>راجع الحاجة لهذه الصلاحية في Discord. لا يتم تعديلها تلقائيًا.</p></div></div><div class="rows">${adminRoles.map(role => `<div class="row"><span class="row-icon">◇</span><div class="row-main"><b>${esc(role.name)}</b><small>${role.managed ? 'رتبة يديرها تطبيق' : 'رتبة في السيرفر'}</small></div>${badge('Administrator', 'warn')}</div>`).join('')}</div>` : empty('لا توجد رتب بهذه الصلاحية', 'هذا فحص للرتب المقروءة فقط، وليس تقييمًا كاملًا لأمان السيرفر.'))}<div class="notice info"><div><b>حماية الرسائل والسبام</b><p>استخدم AutoMod في Discord لإدارة قواعد منع السبام. هذه اللوحة لا تدّعي تشغيل حماية غير مفعلة.</p></div><a class="btn secondary" href="https://discord.com/channels/${encodeURIComponent(state.guild)}" target="_blank" rel="noopener">فتح السيرفر ↗</a></div>`;
}
function settings() {
  const d = state.data;
  $('#workspace').innerHTML = head('إعدادات مساحة مجتمعك.', 'اتصال السيرفر وتفضيلات النشاط، في مكان واحد.') + `<div class="steps"><span class="step done">✓ الحساب مرتبط</span><span class="step ${d.connection.status === 'installed' ? 'done' : ''}">${d.connection.status === 'installed' ? '✓' : '2'} ربط بوت التنفيذ</span><span class="step ${d.connection.readable ? 'done' : ''}">${d.connection.readable ? '✓' : '3'} قراءة السيرفر</span></div><div class="grid-2">${panel('الاتصال بـ Discord', `<div class="panel-body form-grid"><div class="server-title"><span class="server-image">${esc(d.guild.name.slice(0, 1))}</span><div><h3>${esc(d.guild.name)}</h3><small>${d.guild.owner ? 'أنت مالك السيرفر' : 'لديك صلاحية الإدارة'}</small></div></div><div class="row"><div class="row-main"><b>حالة الربط</b><small>آخر تحقق: ${date(d.connection.checked_at)}</small></div>${status(d.connection.status)}</div><div class="actions"><button class="btn primary" id="installBot">${d.connection.status === 'installed' ? 'مراجعة ربط البوت ↗' : 'إضافة Diskoko إلى السيرفر ↗'}</button><button class="btn secondary" id="verifyBot">إعادة التحقق</button></div><p class="form-note">بعد العودة من Discord سنعيد التحقق تلقائيًا. لا نطلب صلاحية Administrator.</p><details><summary>تفاصيل السيرفر</summary><p><code>${esc(state.guild)}</code></p><button class="btn text" id="copyGuild">نسخ المعرّف</button></details></div>`)}${panel('خصوصية إحصاءات النشاط', `<div class="panel-body form-grid"><div>${badge(d.preferences.analytics_enabled ? 'جمع النشاط مفعّل' : 'جمع النشاط غير مفعّل', d.preferences.analytics_enabled ? 'good' : 'neutral')}</div><p>يجمع البوت عدد الرسائل وأسماء المشاركين فقط، دون محتوى الرسائل، لمدة 30 يومًا. الإيقاف يمنع جمع أحداث جديدة.</p><button class="btn secondary" id="toggleAnalytics">${d.preferences.analytics_enabled ? 'إيقاف جمع النشاط' : 'تفعيل جمع النشاط'}</button>${action('عرض التحليلات', 'analytics', 'text')}</div>`)}</div>${panel('نسخة من البنية الحالية', '<div class="panel-body"><p>نزّل القنوات والرتب للمراجعة أو التوثيق. الملف لا يحتوي رسائل الأعضاء، ولا يوفّر استعادة تلقائية للسيرفر.</p><div class="actions" style="margin-top:18px"><button class="btn secondary" id="exportStructure">تصدير بنية السيرفر ↓</button></div></div>')}`;
  $('#workspace .grid-2').insertAdjacentHTML('beforebegin', panel('بوت التنفيذ لهذا السيرفر', '<div class="panel-body form-grid"><p>اختر بوت ديسكوكو أو اربط بوتك الخاص. البوت المختار ينفذ القوالب، إعدادات السيرفر، ورسائل AI بعد مراجعتك.</p><div id="settingsBotConnection" role="status">جارٍ التحقق من البوت المختار…</div><a href="/ai-bot-guide.html" target="_blank" rel="noopener noreferrer">شرح إنشاء بوتك وربطه ↗</a></div>'));
  void loadSettingsBotConnection();
  $('#installBot').onclick = run(async () => { const result = await api(`/api/guilds/${encodeURIComponent(state.guild)}/install-url`); window.open(result.url, '_blank', 'noopener'); state.awaitingInstall = true; });
  $('#verifyBot').onclick = run(async event => { event.currentTarget.disabled = true; try { await loadGuild(); } finally { $('#verifyBot') && ($('#verifyBot').disabled = false); } });
  $('#copyGuild').onclick = run(async () => { await navigator.clipboard.writeText(state.guild); toast('نُسخ معرّف السيرفر.'); });
  $('#toggleAnalytics').onclick = () => confirmDialog(d.preferences.analytics_enabled ? 'إيقاف جمع النشاط؟' : 'تفعيل جمع النشاط؟', 'يؤثر التغيير في جمع أحداث الرسائل الجديدة. لا يُحفظ محتوى الرسائل، وتبقى الأعداد السابقة حتى نهاية مدة الاحتفاظ البالغة 30 يومًا.', 'تأكيد', async () => { await api(`/api/workspace/${encodeURIComponent(state.guild)}/preferences`, { method: 'PUT', body: JSON.stringify({ analytics_enabled: !d.preferences.analytics_enabled }) }); closeDialog(); await loadGuild(); });
  $('#exportStructure').disabled = !d.connection.readable;
  $('#exportStructure').onclick = () => download('diskoko-server-structure.json', { exported_at: new Date().toISOString(), guild: { id: state.guild, name: d.guild.name }, channels: d.channels, roles: d.roles });
}
async function loadSettingsBotConnection() {
  const guild = state.guild, epoch = state.epoch, target = $('#settingsBotConnection');
  if (!target) return;
  try {
    const { bot } = await api(`/api/ai/bot-connection?guildId=${encodeURIComponent(guild)}`);
    if (guild !== state.guild || epoch !== state.epoch || screen() !== 'settings') return;
    const retryAt = bot?.retryAt && new Date(bot.retryAt).getTime() > Date.now()
      ? `؛ المحاولة التالية ${new Date(bot.retryAt).toLocaleString('ar-SA')}` : '';
    target.innerHTML = bot
      ? `<div class="row"><div class="row-main"><b>${esc(bot.name)}</b><small>بوتك الخاص · ${bot.online ? 'متصل وجاهز لتنفيذ أدوات السيرفر' : `غير متصل${retryAt || '؛ أعد الربط أو انتظر عودة الاتصال'}`}</small></div>${badge(bot.online ? 'متصل' : 'غير متصل', bot.online ? 'good' : 'warn')}</div><button class="btn secondary" id="settingsBotDisconnect" type="button">فصل بوتي والعودة لبوت ديسكوكو</button>`
      : `<div class="row"><div class="row-main"><b>بوت ديسكوكو</b><small>البوت الافتراضي لهذا السيرفر</small></div>${badge(state.data.bot.online ? 'متصل' : 'غير متصل', state.data.bot.online ? 'good' : 'warn')}</div><button class="btn primary" id="settingsBotConnect" type="button">ربط بوتي الخاص</button>`;
    if (bot) $('#settingsBotDisconnect').onclick = run(async () => {
      if (!window.confirm('سيعود التنفيذ إلى بوت ديسكوكو. المنشورات التفاعلية السابقة التي أنشأها بوتك قد تتوقف. هل تريد المتابعة؟')) return;
      await api('/api/ai/bot-connection', { method: 'DELETE', body: JSON.stringify({ guildId: guild }) });
      await loadGuild();
      toast('فُصل بوتك الخاص عن هذا السيرفر.');
    });
    else $('#settingsBotConnect').onclick = () => {
      modal('ربط بوت التنفيذ الخاص بسيرفرك', `<p>أنشئ بوتًا في Discord Developer Portal وأضفه إلى ${esc(state.data.guild.name)}، ثم انسخ رمزه هنا. يُحفظ الرمز مشفرًا ولا يظهر بعد الحفظ.</p><label>رمز البوت<input id="settingsBotToken" type="password" autocomplete="off" spellcheck="false" placeholder="ألصق Bot Token هنا"></label><p class="form-note">فعّل Server Members Intent إن أردت الترحيب التلقائي. لا ترسل الرمز في المحادثة.</p><a href="/ai-bot-guide.html" target="_blank" rel="noopener noreferrer">شرح الربط ↗</a>`, '<button class="btn secondary" id="settingsBotCancel" type="button">إلغاء</button><button class="btn primary" id="settingsBotSave" type="button">تحقق واربط</button>');
      $('#settingsBotCancel').onclick = closeDialog;
      $('#settingsBotSave').onclick = run(async () => {
        const button = $('#settingsBotSave'); button.disabled = true;
        try {
          const result = await api('/api/ai/bot-connection', { method: 'POST', body: JSON.stringify({ guildId: guild, token: $('#settingsBotToken').value }) });
          closeDialog(); await loadGuild(); toast(result.pending ? 'حُفظ الربط؛ سيتصل بوتك تلقائيًا بعد انتهاء مهلة Discord.' : 'اتصل بوتك الخاص وأصبح بوت التنفيذ لهذا السيرفر.');
        } catch (error) {
          const message = $('#dialogError'); message.textContent = error.message;
          if (error.inviteUrl?.startsWith('https://discord.com/oauth2/authorize?')) { const link = document.createElement('a'); link.href = error.inviteUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'أضف البوت إلى السيرفر ↗'; message.append(document.createElement('br'), link); }
          message.hidden = false; button.disabled = false;
        }
      });
    };
  } catch (error) { if (guild === state.guild && screen() === 'settings') target.textContent = error.message; }
}
async function start() {
  try { state.account = await api('/api/account/overview'); await loadGuild(); }
  catch (error) { state.loading = false; state.error = error; render(); }
}
$('#guildSelect').onchange = event => { if (event.target.value) location.href = url('overview', event.target.value); };
$('#refresh').onclick = run(loadGuild);
$('#menuToggle').onclick = () => { const open = $('#sidebar').classList.toggle('open'); $('#menuToggle').setAttribute('aria-expanded', String(open)); };
document.addEventListener('click', event => { const link = event.target.closest('a[href]'); if (!link) return; const target = new URL(link.href, location.href); if (target.pathname === '/studio' && target.search === location.search) { $('#sidebar').classList.remove('open'); $('#menuToggle').setAttribute('aria-expanded', 'false'); } });
window.addEventListener('hashchange', () => { render(); $('#workspace').focus({ preventScroll: true }); });
window.addEventListener('focus', () => { if (state.awaitingInstall) { state.awaitingInstall = false; loadGuild(); } });
$('#dialog').addEventListener('cancel', event => { if ($('#applyPlan')?.textContent === 'جارٍ التطبيق…') event.preventDefault(); });
start();



