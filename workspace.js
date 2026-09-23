const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fmt = value => new Intl.NumberFormat('ar-SA').format(value ?? 0);
const date = value => value ? new Date(value).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : 'لم يتم بعد';
const state = { account: null, guild: new URLSearchParams(location.search).get('guild'), data: null, loading: true, error: null, tab: 'channels', draft: [], templates: null, epoch: 0, days: 7 };
const sections = [ ['overview', '⌂', 'نظرة عامة'], ['builder', '▤', 'القنوات والرتب'], ['bots', '◈', 'بوتاتي'], ['commands', '⌘', 'الأوامر'], ['assistant', '✦', 'AI ديسكوكو'], ['automation', '◷', 'الرسائل المجدولة'], ['analytics', '⌁', 'النشاط والتحليلات'], ['safety', '◇', 'الأمان والصلاحيات'], ['activity', '≡', 'سجل التغييرات'], ['settings', '⚙', 'إعدادات السيرفر'] ];
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
  if (!response.ok) throw Object.assign(new Error(body.error || 'تعذر إكمال الطلب. أعد المحاولة.'), { status: response.status });
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
  $('#closeDialog').onclick = closeDialog;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() { $('#dialog').close(); }
function modalError(error) { $('#dialogError').hidden = false; $('#dialogError').textContent = error.message; }
function confirmDialog(title, description, label, callback) { modal(title, `<p>${esc(description)}</p>`, `<button class="btn secondary" id="cancelConfirm">إلغاء</button><button class="btn primary" id="confirmAction">${label}</button>`); $('#cancelConfirm').onclick = closeDialog; $('#confirmAction').onclick = async event => { event.currentTarget.disabled = true; try { await callback(); } catch (error) { modalError(error); $('#confirmAction').disabled = false; } }; }
function shell() {
  $('#navigation').innerHTML = `<div class="nav-label">إدارة مجتمعك</div>${sections.map(([key, icon, label]) => `<a class="nav-link ${screen() === key ? 'active' : ''}" href="${url(key)}" ${screen() === key ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</a>`).join('')}`;
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
  const pages = { overview: overview, builder: builder, bots: bots, commands: commands, assistant: assistant, automation: automation, analytics: analytics, activity: activity, settings: settings, safety: safety };
  Promise.resolve(pages[selected]?.()).catch(error => { if (screen() === selected) area.innerHTML = head('تعذر تحميل القسم', 'حاول مرة أخرى دون تغيير إعداداتك.') + `<div class="panel">${empty('البيانات غير متاحة الآن', esc(error.message), '<button class="btn primary" id="retrySection">إعادة المحاولة</button>')}</div>`; $('#retrySection')?.addEventListener('click', render); });
}
function renderServers() {
  $('#workspace').innerHTML = head('كل مجتمع يبدأ من هنا', 'اختر سيرفرك، وكل أدواته ستكون في مكان واحد.', '<a class="btn primary" href="/account.html#create">＋ تجهيز سيرفر جديد</a>') + `<div class="server-grid">${(state.account?.servers || []).map(guild => `<article class="server-card"><div class="server-title"><span class="server-image">${guild.icon ? `<img src="https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=96" alt="">` : esc(guild.name.slice(0, 1))}</span><div><h3>${esc(guild.name)}</h3><small>${guild.owner ? 'أنت مالك السيرفر' : 'لديك صلاحية الإدارة'}</small></div></div>${status(guild.connection?.install_status)}<br><a class="btn primary" href="${url(guild.connection?.install_status === 'installed' ? 'overview' : 'settings', guild.id)}">${guild.connection?.install_status === 'installed' ? 'فتح لوحة السيرفر' : 'إكمال الربط'} ←</a></article>`).join('') || empty('لا توجد سيرفرات قابلة للإدارة', 'أنشئ سيرفرًا في Discord أو تأكد من صلاحية إدارة السيرفر في حسابك.')}</div>`;
}
function connectionNotice() {
  const d = state.data; if (d.connection.status === 'installed' && d.connection.readable) return '';
  const messages = { install_required: 'أكمل ربط Diskoko لتظهر القنوات والرتب وتبدأ إدارة سيرفرك.', permissions_insufficient: 'لم يتمكن البوت من الوصول إلى السيرفر. راجع الربط والصلاحيات.', unavailable: 'تعذر الاتصال بـ Discord الآن. هذا لا يعني أن البوت غير مثبت.' };
  return `<div class="notice"><div><b>${messages[d.connection.status] || 'تعذر قراءة بعض بيانات السيرفر.'}</b><p>لن تتاح التعديلات حتى يكتمل التحقق من السيرفر.</p></div>${action('مراجعة الاتصال', 'settings')}</div>`;
}
function changeName(change) { return change.plan?.name || ({ gaming: 'قالب مجتمع ألعاب', support: 'قالب مركز دعم', study: 'قالب مساحة دراسة', custom: 'تعديلات القنوات والرتب' }[change.template_key]) || 'خطة تغييرات'; }
function changeRows(changes) { return changes.length ? `<div class="rows">${changes.map(change => `<div class="row"><span class="row-icon">≡</span><div class="row-main"><b>${esc(changeName(change))}</b><small>${date(change.updated_at)}</small></div>${status(change.status)}<button class="btn text" data-plan="${esc(change.id)}">عرض ←</button></div>`).join('')}</div>` : empty('لم تبدأ أي تغييرات بعد', 'عدّل القنوات أو اختر قالبًا، وستجد المراجعة والنتيجة هنا.', action('استكشف القنوات والرتب', 'builder')); }
function bindPlans() { document.querySelectorAll('[data-plan]').forEach(button => { button.onclick = run(() => showPlan(button.dataset.plan)); }); }
function overview() {
  const d = state.data; const channels = d.channels?.filter(channel => channel.type !== 4); const pending = d.changeSets.filter(change => change.status !== 'succeeded');
  $('#workspace').innerHTML = head('مجتمعك، تحت نظرك.', 'كل ما تحتاجه لتبني، تنظّم، وتتابع مجتمعك من مكان واحد.', `<a class="btn secondary" href="https://discord.com/channels/${encodeURIComponent(state.guild)}" target="_blank" rel="noopener">فتح Discord ↗</a>`) + connectionNotice() + `<section class="hero"><div><span class="eyebrow">مساحة ${esc(d.guild.name)}</span><h2>${pending.length ? 'لديك تغييرات تستحق المراجعة.' : 'خطوتك القادمة تصنع الفرق.'}</h2><p>${pending.length ? 'راجع ما جهزته لسيرفرك، وشاهد تفاصيل كل تغيير قبل تطبيقه.' : 'ابدأ بتنظيم قنواتك ورتبك، أو أضف قالبًا يناسب مجتمعك. كل تغيير يمر بمراجعتك أولًا.'}</p><div class="actions">${action(pending.length ? 'مراجعة التغييرات ←' : 'تنظيم السيرفر ←', pending.length ? 'activity' : 'builder', 'primary')}${action('إعداد البوت', 'bots')}</div></div><div class="hero-art" aria-hidden="true"><span>◈</span></div></section><div class="metrics">${metric('أعضاء المجتمع', d.members, 'العدد التقريبي من Discord', '♧')}${metric('القنوات', channels?.length, `${fmt(d.channels?.filter(channel => channel.type === 4).length)} تصنيفات`, '▤')}${metric('الرتب', d.roles?.length, 'بنية السيرفر الحالية', '◇')}${metric('بانتظار المراجعة', pending.length, 'مسودات وعمليات تحتاج متابعة', '≡')}</div><div class="section-title"><h3>ماذا تريد أن تنجز؟</h3><small>اختصارات ليوم أسهل</small></div><div class="quick-actions">${[['builder', '＋', 'رتّب مساحة مجتمعك', 'القنوات، الرتب، والقوالب'], ['automation', '◷', 'جهّز إعلانك القادم', 'رسالة تصل في الوقت المناسب'], ['analytics', '⌁', 'تعرّف على النشيطين', 'مؤشرات واضحة من مجتمعك']].map(([key, icon, title, sub]) => `<a class="quick-action" href="${url(key)}"><span class="quick-icon">${icon}</span><span><strong>${title}</strong><small>${sub}</small></span><em>←</em></a>`).join('')}</div><div class="grid-2">${panel('آخر التغييرات', changeRows(d.changeSets.slice(0, 4)), action('عرض الكل', 'activity', 'text'))}${panel('جاهزية مجتمعك', `<div class="rows"><div class="row"><span class="row-icon">◈</span><div class="row-main"><b>ربط السيرفر</b><small>آخر تحقق مباشر من Discord</small></div>${status(d.connection.status)}</div><div class="row"><span class="row-icon">⌁</span><div class="row-main"><b>تشغيل البوت</b><small>اتصال البوت بخدمة Discord</small></div>${badge(d.bot.online ? 'متصل' : 'غير متصل', d.bot.online ? 'good' : 'warn')}</div><div class="row"><span class="row-icon">▥</span><div class="row-main"><b>جمع إحصاءات النشاط</b><small>أعداد الرسائل دون محتواها</small></div>${badge(d.preferences.analytics_enabled ? 'مفعّل' : 'غير مفعّل', d.preferences.analytics_enabled ? 'good' : 'neutral')}</div></div><div class="panel-body">${action('إدارة الاتصال والإعدادات', 'settings', 'secondary')}</div>`)}</div>`;
  bindPlans();
}
function builder() {
  const d = state.data; const labels = { channels: 'القنوات والتصنيفات', roles: 'الرتب', templates: 'القوالب' };
  $('#workspace').innerHTML = head('مساحة مرتبة. مجتمع أوضح.', 'ابدأ من البنية الموجودة، واحفظ تعديلاتك للمراجعة قبل تطبيقها.') + connectionNotice() + `<div class="tabs" role="tablist" aria-label="بنية السيرفر">${Object.entries(labels).map(([key, label]) => `<button role="tab" aria-selected="${state.tab === key}" class="tab ${state.tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}</div><div id="builderContent"></div>`;
  document.querySelectorAll('[data-tab]').forEach(button => { button.onclick = () => { state.tab = button.dataset.tab; builder(); }; });
  if (state.tab === 'templates') { renderTemplates().catch(error => { $('#builderContent').innerHTML = empty('تعذر تحميل القوالب', esc(error.message)); }); return; }
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
  return `<div class="table-wrap"><table><thead><tr><th>الإجراء</th><th>العنصر والتغيير</th>${removable ? '<th>إزالة</th>' : ''}</tr></thead><tbody>${operations.map((op, index) => `<tr><td>${badge(op.action === 'update' ? 'تعديل' : 'إضافة / مطابقة', op.action === 'update' ? 'warn' : 'purple')}</td><td><b>${esc(op.name)}</b><small>${{ channel: op.type === 2 ? 'قناة صوتية' : op.type === 15 ? 'منتدى' : 'قناة', category: 'تصنيف', role: 'رتبة' }[op.resource_type] || ''}${op.before?.name && op.before.name !== op.name ? ` · <span class="before">${esc(op.before.name)}</span> ← <span class="after">${esc(op.name)}</span>` : ''}${Object.hasOwn(op, 'parent_id') ? ` · التصنيف: ${esc(state.data.channels?.find(c => c.id === op.parent_id)?.name || 'دون تصنيف')}` : ''}${Object.hasOwn(op, 'color') ? ` · اللون: #${Number(op.color).toString(16).padStart(6, '0')}` : ''}</small></td>${removable ? `<td><button class="btn text" data-remove="${index}" aria-label="إزالة ${esc(op.name)} من قائمة المراجعة">×</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function reviewLocal() {
  modal('مراجعة مسودتك', `<p class="form-note">السيرفر المستهدف: <b>${esc(state.data.guild.name)}</b>. حفظ الخطة لا يطبق التغييرات.</p>${operationTable(state.draft, true)}`, '<button class="btn primary" id="savePlan">حفظ خطة التغييرات</button>');
  document.querySelectorAll('[data-remove]').forEach(button => { button.onclick = () => { state.draft.splice(Number(button.dataset.remove), 1); saveDraft(); if (state.draft.length) reviewLocal(); else closeDialog(); }; });
  $('#savePlan').onclick = async event => { event.currentTarget.disabled = true; try { const created = await api('/api/change-sets', { method: 'POST', body: JSON.stringify({ guildId: state.guild, operations: state.draft }) }); state.draft = []; saveDraft(); closeDialog(); await loadGuild(); await showPlan(created.changeSet.id); } catch (error) { modalError(error); $('#savePlan').disabled = false; } };
}
async function showPlan(id) {
  const expectedGuild = state.guild;
  const data = await api(`/api/change-sets/${encodeURIComponent(id)}`);
  if (state.guild !== expectedGuild || data.changeSet.guild_id !== state.guild) throw Error('هذه الخطة تخص سيرفرًا آخر.');
  const done = data.operations.filter(op => op.status === 'succeeded').length;
  const complete = data.changeSet.status === 'succeeded';
  modal('مراجعة التغييرات', `<div class="notice info"><div><b>${esc(state.data.guild.name)}</b><p>${fmt(done)} من ${fmt(data.operations.length)} عمليات مكتملة. ${complete ? 'اكتمل التطبيق.' : 'سيُنفّذ غير المكتمل فقط.'}</p></div>${status(data.changeSet.status)}</div>${operationTable(data.changeSet.plan.operations)}<div class="rows">${data.operations.map(op => `<div class="row"><div class="row-main"><b>${esc(data.changeSet.plan.operations.find(item => item.operation_key === op.operation_key)?.name || op.operation_key)}</b>${op.result?.error ? `<small>${esc(op.result.error)}</small>` : ''}</div>${status(op.status)}</div>`).join('')}</div>${!complete ? '<label class="check-row"><input type="checkbox" id="confirmApply">راجعت التغييرات وأوافق على تطبيقها على هذا السيرفر.</label>' : ''}`, complete ? '<button class="btn primary" id="donePlan">تم</button>' : `<button class="btn secondary" id="laterPlan">لاحقًا</button><button class="btn primary" id="applyPlan" disabled>نعم، أؤكد التنفيذ</button>`);
  if (complete) { $('#donePlan').onclick = closeDialog; return; }
  $('#laterPlan').onclick = closeDialog;
  $('#confirmApply').onchange = event => { $('#applyPlan').disabled = !event.target.checked || !state.data.connection.readable; };
  $('#applyPlan').onclick = async event => {
    event.currentTarget.disabled = true; event.currentTarget.textContent = 'جارٍ التطبيق…'; $('#closeDialog').disabled = true; $('#laterPlan').disabled = true;
    try { await api(`/api/change-sets/${encodeURIComponent(id)}/apply`, { method: 'POST', body: JSON.stringify({ confirmed: true, guildId: state.guild }) }); closeDialog(); await loadGuild(); await showPlan(id); toast('اكتملت التغييرات على سيرفرك.'); }
    catch (error) { closeDialog(); await loadGuild(); await showPlan(id); modalError(error); }
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
  $('#workspace').innerHTML = head('بوتات تحمل اسم مجتمعك', 'اختر وظيفة البوت، احفظ تصميمه، ثم اربط تطبيق Discord الذي تملكه.') + '<div class="loading" role="status">جارٍ تحميل بوتاتك…</div>';
  const { bots: items } = await api(`/api/custom-bots?guildId=${encodeURIComponent(guild)}`);
  if (guild !== state.guild || epoch !== state.epoch || screen() !== 'bots') return;
  const capacity = state.account?.usage?.customBots || { used: items.length, limit: state.account?.limits?.customBots || 1 };
  const available = capacity.used < capacity.limit;
  const free = (state.account?.limits?.plan || state.account?.user?.plan) === 'free';
  const cards = items.map(bot => {
    const preset = botPresets.find(item => item.kind === bot.definition?.kind) || botPresets[0];
    return `<article class="server-card bot-instance"><div class="server-title"><span class="server-image">${preset.icon}</span><div class="row-main"><h3>${esc(bot.name)}</h3><small>${esc(preset.title)} · ${esc(state.data.guild.name)}</small></div>${badge('تصميم محفوظ', 'purple')}</div><p class="form-note">${esc(bot.description || preset.description)}</p><div class="bot-command-tags">${(bot.definition?.commands || []).map(key => `<span>/${esc(key)}</span>`).join('') || '<small>لا أوامر مختارة</small>'}</div><div class="notice info"><div><b>خطوة الربط التالية</b><p>أنشئ تطبيق البوت في Discord Developer Portal باسمك. الربط والتشغيل المستقل سيظهران هنا بعد تجهيز عامل البوتات؛ هذا التصميم لم يُثبت في Discord بعد.</p></div></div><div class="actions"><button class="btn secondary" data-edit-bot="${bot.id}">تعديل التصميم</button><a class="btn text" href="https://discord.com/developers/applications" target="_blank" rel="noopener">فتح بوابة Discord ↗</a></div></article>`;
  }).join('');
  $('#workspace').innerHTML = head('بوتات تحمل اسم مجتمعك', 'لكل بوت وظيفة واسم مستقلان. تصاميم البوتات هنا لا تعني أنها مثبتة أو تعمل بعد.') + connectionNotice() + `<div class="notice info"><div><b>${fmt(capacity.used)} من ${fmt(capacity.limit)} تصاميم بوت في باقتك</b><p>Free: 1 · Starter: 5 · Growth: 10 · Business: 20. إنشاء التطبيق وربطه وتشغيله خطوات منفصلة.</p></div>${!available ? '<a class="btn secondary" href="/account.html#subscription">عرض الباقات</a>' : ''}</div><div class="section-title"><h3>بوتات هذا السيرفر</h3><small>هويتك، أوامرك، ومسار ربط واضح</small></div><div class="server-grid">${cards || `<div class="panel">${empty('لم تصمم بوتًا لهذا السيرفر بعد', 'اختر نوعًا من البوتات الجاهزة أدناه وسمّه باسم مجتمعك.')}</div>`}</div><div class="section-title"><h3>ابدأ بنوع جاهز</h3><small>يحفظ تصميم البوت لتخصيصه وربطه لاحقًا</small></div><div class="server-grid bot-gallery">${botPresets.map(preset => `<article class="server-card bot-preset"><div class="server-title"><span class="server-image">${preset.icon}</span><div><h3>${preset.title}</h3><small>${preset.kind === 'assistant' && free ? 'يتطلب Starter أو أعلى' : 'تصميم قابل للتخصيص'}</small></div></div><p>${preset.description}</p><button class="btn ${preset.kind === 'assistant' ? 'secondary' : 'primary'}" data-create-bot="${preset.kind}" ${!available ? 'disabled' : ''}>${!available ? 'وصلت لحد الباقة' : preset.kind === 'assistant' && free ? 'ترقية الباقة' : 'اختيار هذا النوع'}</button></article>`).join('')}</div>`;
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
const aiSuggestionGroups = [
  { name: 'الجيف آواي', mode: 'execute', prompts: [
    ['جيف آواي سريع', 'جهز جيف آواي في #[القناة] لجائزة [الجائزة] لمدة [المدة بالدقائق] دقيقة، مع [عدد الفائزين] فائز. اعرض التفاصيل ثم أنتظر مني «يلا نفّذ».'],
    ['جائزة اشتراك', 'جهز جيف آواي لجائزة اشتراك [المدة] في #[القناة]، ينتهي بعد [عدد الساعات] ساعة، وفائز واحد.'],
    ['جائزة لأكثر من فائز', 'نظم جيف آواي في #[القناة] لجائزة [الجائزة]، لمدة [المدة] دقيقة، واختر [عدد الفائزين] فائزين.'],
    ['صياغة إعلان الجيف آواي', 'اكتب إعلانًا واضحًا وحماسيًا لجيف آواي جائزته [الجائزة]، مدته [المدة]، وشروطه [الشروط]. لا تنشره قبل مراجعتي.', 'advice'],
    ['مراجعة شروط المسابقة', 'راجع شروط هذا الجيف آواي واقترح صياغة عادلة ومفهومة للأعضاء: [الشروط].', 'advice'],
    ['خطة جوائز شهرية', 'اقترح جدول جيف آواي شهريًا لمجتمع [نوع المجتمع] بميزانية [الميزانية]، مع أفكار جوائز مناسبة.', 'advice'],
  ] },
  { name: 'تذاكر الدعم', mode: 'execute', prompts: [
    ['لوحة تذاكر الدعم', 'جهز لوحة تذاكر دعم في #[القناة] بعنوان [العنوان]، ووصفها [الوصف]. اعرض الخطة قبل النشر.'],
    ['دعم العملاء', 'صمم نص لوحة دعم للعملاء في #[القناة]، بعنوان [اسم الخدمة]، واشرح متى يفتح العضو تذكرة.'],
    ['قسم طلب المساعدة', 'جهز لوحة تذاكر لطلبات المساعدة في #[القناة]. اجعل العنوان واضحًا والوصف ودودًا ومختصرًا.'],
    ['سياسة الرد على التذاكر', 'اكتب سياسة مختصرة لفريق الدعم: أولوية التذاكر، نبرة الرد، ومتى نصعد المشكلة.', 'advice'],
    ['رد افتتاحي للتذكرة', 'اكتب ردًا افتتاحيًا محترمًا يظهر للعضو عند فتح تذكرة، ويطلب منه وصف المشكلة دون مشاركة بيانات حساسة.', 'advice'],
    ['أسئلة الدعم الشائعة', 'رتب لي أسئلة وأجوبة شائعة عن [الخدمة] لتقليل التذاكر المتكررة.', 'advice'],
  ] },
  { name: 'القنوات', mode: 'execute', prompts: [
    ['قناة نصية جديدة', 'أريد إنشاء قناة نصية باسم [الاسم] لغرض [الغرض]. اقترح وصفًا مناسبًا ثم اعرض خطة المراجعة عندما أقول «يلا نفّذ».'],
    ['قناة صوتية', 'جهز قناة صوتية باسم [الاسم] لمجتمع [نوع المجتمع]، واعرض ما سيُنشأ قبل التنفيذ.'],
    ['تصنيف للقنوات', 'اقترح تصنيفًا باسم [الاسم] ينظم قنوات [الغرض]، ثم جهزه للمراجعة.'],
    ['هيكلة مجتمع ألعاب', 'اقترح هيكلة قنوات لسيرفر ألعاب فيه [عدد الأعضاء] عضوًا. ابدأ بالقنوات الأساسية فقط.', 'advice'],
    ['هيكلة متجر', 'اقترح ترتيب قنوات لسيرفر متجر يبيع [المنتج]، من الترحيب حتى الدعم.', 'advice'],
    ['تقليل ازدحام القنوات', 'هذه قنوات سيرفري الحالية. اقترح كيف أجعلها أبسط وأسهل للعضو الجديد دون حذف شيء تلقائيًا.', 'advice'],
    ['وصف قناة', 'اكتب وصفًا واضحًا لقناة #[القناة] يشرح ما ينشر فيها وما لا ينشر.', 'advice'],
    ['قناة إعلان', 'اقترح اسم قناة إعلانات مناسبًا لمجتمع [النوع] واكتب أول منشور تعريفي لها.', 'advice'],
  ] },
  { name: 'الرتب', mode: 'execute', prompts: [
    ['رتبة جديدة', 'جهز رتبة باسم [اسم الرتبة] لفئة [الفئة]. اشرح الغرض منها ثم اعرض خطة المراجعة.'],
    ['رتبة أعضاء', 'اقترح اسم رتبة للأعضاء الجدد ثم جهز إنشاءها فقط؛ لا تقل إنها توزع تلقائيًا.'],
    ['رتبة فريق الدعم', 'جهز رتبة باسم [اسم الرتبة] لفريق الدعم، واشرح الصلاحيات التي ينبغي مراجعتها يدويًا.'],
    ['سلم رتب المجتمع', 'اقترح سلم رتب بسيطًا لمجتمع [النوع] دون منح صلاحيات إدارية تلقائيًا.', 'advice'],
    ['أسماء رتب إبداعية', 'اقترح 10 أسماء رتب متدرجة لمجتمع [النوع] مع وصف مختصر لكل رتبة.', 'advice'],
    ['مراجعة الصلاحيات', 'اشرح كيف أراجع صلاحيات رتب السيرفر وأقلل الصلاحيات العالية دون تعطيل فريق الإدارة.', 'advice'],
  ] },
  { name: 'الرسائل', mode: 'execute', prompts: [
    ['إعلان مع صورة', 'اكتب رسالة أنيقة عن [الموضوع] للنشر في #[القناة]. سأرفق صورة مع الرسالة؛ اعرض النص للمراجعة قبل النشر.'],
    ['رسالة ترحيب واحدة', 'اكتب رسالة ترحيب واحدة للأعضاء في #[القناة] بنبرة [رسمية أو ودودة]، ثم جهزها للمراجعة.'],
    ['تحديث مهم', 'صغ إعلانًا واضحًا عن [التحديث] لأعضاء السيرفر في #[القناة] مع أهم ثلاث نقاط.'],
    ['افتتاح سيرفر', 'اكتب منشور افتتاح لسيرفر [الاسم] في #[القناة] يشرح الفكرة ويدعو الأعضاء للمشاركة.'],
    ['تذكير بالقوانين', 'اكتب تذكيرًا لطيفًا بالقوانين التالية لنشره في #[القناة]: [القوانين].'],
    ['رسالة شكر', 'اكتب رسالة شكر لأعضاء مجتمع [الاسم] بمناسبة [الحدث]، دون مبالغة.'],
    ['إعلان فعالية', 'صغ إعلان فعالية [الاسم] بتاريخ [الوقت] في #[القناة] مع طريقة المشاركة.'],
    ['إعلان صيانة', 'اكتب إعلان صيانة للخدمة [الاسم] في #[القناة]، يبدأ [الوقت] وينتهي [الوقت].'],
  ] },
  { name: 'إدارة المجتمع', mode: 'advice', prompts: [
    ['رحلة العضو الجديد', 'صمم رحلة بسيطة للعضو الجديد من لحظة دخوله حتى أول مشاركة مفيدة.'],
    ['تنشيط الأعضاء', 'اقترح 10 أفكار عملية لتنشيط أعضاء سيرفر [نوع المجتمع] دون إزعاجهم بالمنشن.'],
    ['تقويم فعاليات', 'ابن لي تقويم فعاليات لأربعة أسابيع لمجتمع [النوع] مع هدف كل فعالية.'],
    ['قوانين مختصرة', 'اكتب قوانين سيرفر مختصرة وواضحة تناسب مجتمع [النوع].'],
    ['إرشادات المشرفين', 'ضع دليلًا عمليًا للمشرفين للتعامل مع الخلافات والبلاغات باحترام.'],
    ['استطلاع رأي', 'جهز استطلاعًا تفاعليًا في #[القناة] عن [السؤال] بخيارات [الخيار الأول] و[الخيار الثاني]. اعرض التفاصيل قبل النشر.', 'execute'],
    ['برنامج سفراء', 'اقترح برنامج سفراء أو مساهمين لمجتمع [النوع] مع معايير اختيار واضحة.'],
    ['قياس نجاح المجتمع', 'اقترح مؤشرات أسبوعية مفيدة لمجتمع [النوع] وكيف أقرأها دون الاعتماد على عدد الرسائل فقط.'],
  ] },
  { name: 'البوتات والأوامر', mode: 'advice', prompts: [
    ['أوامر مفيدة', 'اقترح أوامر بوت أساسية تناسب سيرفر [النوع]، وبيّن ما يتطلب برمجة قبل تفعيله.'],
    ['بوت موسيقى', 'صمم تجربة بوت موسيقى لسيرفري: الأوامر، الصلاحيات، والقيود اللازمة قبل التشغيل.'],
    ['بوت ألعاب', 'اقترح ثلاث ألعاب بسيطة يمكن تقديمها داخل Discord واشرح تجربة العضو.'],
    ['تقليل تداخل البوتات', 'ساعدني أراجع البوتات الموجودة وأوزع المسؤوليات بينها لتجنب الأوامر المكررة.'],
    ['أمان البوتات', 'اعطني قائمة مراجعة لصلاحيات البوتات المثبتة في السيرفر.'],
    ['تصميم بوت خاص', 'ساعدني أصمم بوت باسم [الاسم] لمهمة [المهمة]، وحدد ما هو جاهز الآن وما يحتاج تطويرًا.'],
  ] },
  { name: 'المحتوى والهوية', mode: 'advice', prompts: [
    ['وصف السيرفر', 'اكتب وصفًا جذابًا وصادقًا لسيرفر [الاسم] المهتم بـ[المجال].'],
    ['شعار لفظي', 'اقترح 10 شعارات قصيرة لمجتمع [الاسم] تعكس [القيمة].'],
    ['أسلوب الرسائل', 'صمم أسلوب كتابة موحدًا لإعلانات سيرفر [الاسم]: النبرة، الطول، والتنسيق.'],
    ['قالب إعلان', 'اكتب قالب إعلان قابل للتعبئة للفعاليات الأسبوعية.'],
    ['تعريف الرتب', 'اكتب وصفًا قصيرًا لكل رتبة في هذا السلم: [الرتب].'],
    ['مراجعة نص', 'حسّن النص التالي ليكون واضحًا وودودًا لأعضاء Discord دون تغيير معناه: [النص].'],
  ] },
  { name: 'الأمان والإشراف', mode: 'advice', prompts: [
    ['خطة مكافحة السبام', 'ضع خطة عملية لتقليل السبام في سيرفر [النوع] تشمل الإعدادات والتعامل البشري.'],
    ['التعامل مع بلاغ', 'اقترح طريقة عادلة للتعامل مع بلاغ عن [نوع المشكلة] دون كشف هوية المبلّغ.'],
    ['صلاحيات آمنة', 'راجع معي الحد الأدنى المناسب لصلاحيات المشرفين والمساعدين.'],
    ['سياسة الروابط', 'اكتب سياسة مختصرة لنشر الروابط والإعلانات في المجتمع.'],
    ['خطة طوارئ', 'ضع خطوات عملية إذا تعرض السيرفر لموجة سبام أو حسابات مخترقة.'],
    ['رسالة تحذير', 'اكتب رسالة تحذير مهذبة وواضحة لعضو خالف قاعدة [القاعدة].'],
  ] },
  { name: 'الترحيب والانضمام', mode: 'advice', prompts: [
    ['رسالة دخول أولى', 'اكتب رسالة دخول أولى لعضو جديد في مجتمع [النوع]، واضحة وقصيرة.'],
    ['خطوات البداية', 'رتب ثلاث خطوات بسيطة للعضو الجديد بعد دخول سيرفر [الاسم].'],
    ['تعريف القنوات', 'اكتب دليلًا سريعًا للقنوات التالية مع وظيفة كل قناة: [القنوات].'],
    ['رسالة اختيار الاهتمامات', 'صغ رسالة تدعو العضو لتحديد اهتماماته من الخيارات التالية: [الخيارات].'],
    ['تعريف فريق الإدارة', 'اكتب رسالة تعريف ودودة لفريق الإدارة وأدوارهم: [الأسماء والأدوار].'],
    ['سؤال تعارف', 'اقترح سؤال تعارف بسيطًا يشجع الأعضاء الجدد على المشاركة.'],
    ['دليل أول مشاركة', 'اكتب دليلًا قصيرًا يساعد العضو على كتابة أول مشاركة مفيدة في مجتمع [النوع].'],
    ['تحسين الترحيب', 'راجع رسالة الترحيب الحالية وحسن وضوحها ونبرتها: [النص].'],
  ] },
  { name: 'الفعاليات', mode: 'advice', prompts: [
    ['مسابقة أسئلة', 'صمم مسابقة أسئلة لمجتمع [النوع] مع قواعد المشاركة و10 أسئلة مناسبة.'],
    ['ليلة ألعاب', 'خطط لليلة ألعاب مدتها [المدة] لمجتمع [النوع] مع جدول واضح.'],
    ['تحدي أسبوعي', 'اقترح تحديًا أسبوعيًا منخفض التكلفة يناسب أعضاء مجتمع [النوع].'],
    ['فعالية صوتية', 'صمم فعالية صوتية في Discord عن [الموضوع] مع جدول وفقرات وأسئلة.'],
    ['نص دعوة فعالية', 'اكتب دعوة مختصرة لفعالية [الاسم] في [الوقت] مع سبب جذاب للمشاركة.'],
    ['قواعد الفعالية', 'اكتب قواعد عادلة وواضحة لفعالية [الاسم]، تشمل التسجيل والنتائج.'],
    ['تقييم فعالية', 'جهز استبيانًا قصيرًا لتقييم فعالية [الاسم] بعد انتهائها.'],
    ['تقرير الفعالية', 'اكتب قالب تقرير بعد فعالية يتضمن الحضور وما نجح وما يحتاج تحسينًا.'],
  ] },
  { name: 'التحليلات والتحسين', mode: 'advice', prompts: [
    ['قراءة النشاط', 'ساعدني أفهم أرقام نشاط السيرفر التي سأرسلها، وحدد ثلاثة إجراءات عملية.'],
    ['تفسير هدوء القنوات', 'اقترح أسبابًا محتملة لهدوء قناة [الاسم] وكيف أختبرها دون افتراضات قاطعة.'],
    ['مقارنة الأسابيع', 'اعمل لي قالب مقارنة أسبوعية للنشاط: الرسائل، المشاركون، والفعاليات.'],
    ['مؤشرات الدعم', 'اقترح مؤشرات بسيطة لقياس جودة تذاكر الدعم ووقت الاستجابة.'],
    ['قياس الانضمام', 'صمم طريقة لقياس تجربة العضو الجديد خلال أول سبعة أيام.'],
    ['تقرير شهري', 'اكتب قالب تقرير شهري لصاحب سيرفر Discord مع خلاصة وتوصيات.'],
    ['أهداف نمو واقعية', 'ساعدني أحدد أهداف نمو واقعية لمجتمع فيه [عدد الأعضاء] عضوًا.'],
    ['تحليل ملاحظات', 'صنف ملاحظات الأعضاء التالية إلى مشكلات وفرص وخطوات عمل: [الملاحظات].'],
  ] },
  { name: 'التواصل والإعلانات', mode: 'advice', prompts: [
    ['رسالة اعتذار', 'اكتب اعتذارًا واضحًا للأعضاء عن [المشكلة] مع إجراء التصحيح المتوقع.'],
    ['رد على اعتراض', 'صغ ردًا مهنيًا على اعتراض عضو بخصوص [الموضوع] دون دفاعية.'],
    ['إعلان تغيير القوانين', 'اكتب إعلانًا عن تغيير قاعدة [القاعدة] وسبب التغيير وتاريخ سريانها.'],
    ['رسالة غياب', 'اكتب رسالة تخبر الأعضاء بغياب فريق الإدارة من [الوقت] إلى [الوقت] وكيف يطلبون المساعدة.'],
    ['استقبال اقتراحات', 'صغ منشورًا يدعو الأعضاء لتقديم اقتراحات قابلة للتنفيذ للسيرفر.'],
    ['توضيح سوء فهم', 'اكتب توضيحًا هادئًا لسوء فهم حول [الموضوع] مع الخطوة التالية.'],
    ['إعلان شراكة', 'اكتب إعلان شراكة مع [الجهة] يشرح فائدتها للأعضاء دون مبالغة.'],
    ['تلخيص نقاش', 'لخص النقاش التالي إلى قرارات ونقاط مفتوحة ومسؤوليات: [النقاش].'],
  ] },
  { name: 'التخطيط والتشغيل', mode: 'advice', prompts: [
    ['خطة إطلاق', 'ابن خطة إطلاق لسيرفر [النوع] خلال أسبوعين مع مهام يومية مختصرة.'],
    ['توزيع مهام الفريق', 'اقترح توزيع مهام لفريق إدارة من [العدد] أشخاص في مجتمع [النوع].'],
    ['قائمة مراجعة يومية', 'جهز قائمة مراجعة يومية للمشرفين لا تتجاوز 10 دقائق.'],
    ['قائمة مراجعة أسبوعية', 'جهز قائمة مراجعة أسبوعية لصاحب السيرفر تشمل النشاط والدعم والأمان.'],
    ['خطة إعادة تنشيط', 'اقترح خطة أربعة أسابيع لإعادة تنشيط سيرفر هادئ دون إعلانات مزعجة.'],
    ['أولويات التطوير', 'رتب هذه الأفكار حسب أثرها وجهدها لمجتمعي: [الأفكار].'],
    ['توثيق الإجراءات', 'اكتب إجراءً واضحًا لفريق الإدارة عند [الموقف] مع المسؤول والخطوة التالية.'],
    ['مراجعة تجربة العضو', 'اعمل مراجعة لمسار العضو من الدعوة حتى طلب الدعم، وحدد نقاط التعقيد.'],
  ] },
];
const aiPromptLibrary = aiSuggestionGroups.flatMap(group => group.prompts.map(([title, prompt, mode]) => ({ title, prompt, category: group.name, mode: mode || group.mode })));
async function assistant() {
  const guild = state.guild, epoch = state.epoch;
  const active = () => guild === state.guild && epoch === state.epoch && screen() === 'assistant';
  const storageKey = `diskoko-ai-conversation:${guild}`;
  let selected = sessionStorage.getItem(storageKey) || '';
  let conversations = [], messages = [], available = false, planEnabled = true, busy = false;
  $('#workspace').innerHTML = head('AI ديسكوكو', 'مساعدك لتنظيم السيرفر. محادثاتك محفوظة لهذا السيرفر ويمكنك الرجوع إليها.') + connectionNotice() + `<div class="ai-chat-layout"><aside class="panel ai-chat-sidebar"><div class="panel-head"><h3>المحادثات</h3><button id="aiNew" class="btn small primary" type="button">+ جديدة</button></div><div id="aiConversations" class="ai-conversations"></div></aside><section class="panel ai-chat-main"><div class="panel-head"><div><h3 id="aiChatTitle">محادثة جديدة</h3><small>التغييرات على Discord تظهر للمراجعة قبل تطبيقها.</small></div><span id="aiStatus" class="badge neutral">جارٍ التحقق…</span></div><div id="aiMessages" class="ai-messages" role="log" aria-live="polite"></div><div id="aiNotice" class="ai-notice" role="status"></div><div id="aiRecording" class="ai-recording" role="status" hidden><span class="ai-recording-dot"></span><b>جارٍ تسجيل كلامك</b><span id="aiRecordingTime">00:00</span><button id="aiStopVoice" type="button" class="btn small secondary">إيقاف التسجيل</button></div><div id="aiAttachment" class="ai-attachment" hidden></div><form id="assistantForm" class="ai-composer"><label for="assistantPrompt" class="sr-only">رسالتك إلى AI ديسكوكو</label><textarea id="assistantPrompt" rows="2" maxlength="1500" placeholder="اكتب ما تحتاجه لسيرفرك…"></textarea><div class="ai-composer-tools"><button id="aiAttach" class="btn secondary" type="button" aria-label="إرفاق صورة أو ملف نصي">📎 <span>إرفاق</span></button><input id="aiFile" type="file" accept="image/png,image/jpeg,image/webp,.txt,text/plain" hidden><button id="aiVoice" class="btn secondary" type="button" aria-label="تسجيل صوت وتحويله إلى نص">🎙 <span>مايك</span></button><button id="aiSend" class="btn primary" type="submit">إرسال</button></div></form></section></div>`;
  $('#workspace .ai-chat-layout').insertAdjacentHTML('beforeend', `<aside class="panel ai-library"><div class="panel-head"><div><h3>مكتبة AI ديسكوكو</h3><small>${fmt(aiPromptLibrary.length)} مهمة جاهزة للتخصيص</small></div></div><div class="ai-library-controls"><label for="aiLibrarySearch" class="sr-only">ابحث في الاقتراحات</label><input id="aiLibrarySearch" type="search" placeholder="ابحث عن مهمة…"><div id="aiLibraryCategories" class="ai-library-categories"></div></div><div id="aiLibraryList" class="ai-library-list"></div><p class="ai-library-note">«قابل للتنفيذ» يعرض بطاقة مراجعة. «ناتج داخل الدردشة» يكتب محتوى أو خطة، ويمكنك تحويل الرد إلى منشور بعد تحريره وتأكيده.</p></aside>`);
  $('#assistantForm').insertAdjacentHTML('afterbegin', '<div id="aiTemplateDraft" class="ai-template-draft" hidden></div>');
  const list = $('#aiConversations'), thread = $('#aiMessages'), notice = $('#aiNotice'), input = $('#assistantPrompt');
  let libraryCategory = 'الكل', selectedTemplate = null;
  const renderLibrary = () => {
    $('#aiLibraryCategories').innerHTML = ['الكل', ...aiSuggestionGroups.map(group => group.name)].map(category => `<button type="button" class="${category === libraryCategory ? 'active' : ''}" data-ai-category="${esc(category)}">${esc(category)}</button>`).join('');
    $('#aiLibraryCategories').querySelectorAll('[data-ai-category]').forEach(button => button.onclick = () => { libraryCategory = button.dataset.aiCategory; renderLibrary(); });
    const query = $('#aiLibrarySearch').value.trim().toLocaleLowerCase('ar');
    const matched = aiPromptLibrary.map((item, index) => ({ ...item, index })).filter(item => (libraryCategory === 'الكل' || item.category === libraryCategory) && (!query || `${item.title} ${item.category} ${item.prompt}`.toLocaleLowerCase('ar').includes(query)));
    $('#aiLibraryList').innerHTML = matched.length ? matched.map(item => `<button type="button" class="ai-library-item" data-ai-template="${item.index}"><span>${item.mode === 'execute' ? '⚡ قابل للتنفيذ بعد التأكيد' : '✦ ناتج داخل الدردشة'}</span><b>${esc(item.title)}</b><small>${esc(item.prompt)}</small></button>`).join('') : '<p class="ai-library-empty">لا توجد نتائج. جرّب كلمة أخرى.</p>';
    $('#aiLibraryList').querySelectorAll('[data-ai-template]').forEach(button => button.onclick = () => {
      selectedTemplate = aiPromptLibrary[Number(button.dataset.aiTemplate)];
      if (selected && messages.length) {
        selected = ''; messages = []; sessionStorage.removeItem(storageKey); renderList(); renderMessages();
        notice.textContent = 'بدأت مسودة جديدة حتى لا تختلط المهمة بسياق محادثة سابقة.';
      }
      input.value = selectedTemplate.prompt;
      $('#aiTemplateDraft').hidden = false;
      $('#aiTemplateDraft').innerHTML = `<div><b>مسودة: ${esc(selectedTemplate.title)}</b><small>${selectedTemplate.mode === 'execute' ? 'ناقش التفاصيل مع AI، ثم اطلب التنفيذ بأي صيغة تناسبك لتظهر بطاقة المراجعة.' : 'هذه مهمة كتابة أو تخطيط؛ سيظهر الناتج في الدردشة دون تغيير السيرفر.'} استبدل ما بين [ ] بتفاصيلك.</small></div><button id="aiClearTemplate" type="button" class="btn small secondary">مسح المسودة</button>`;
      $('#aiClearTemplate').onclick = () => { selectedTemplate = null; input.value = ''; $('#aiTemplateDraft').hidden = true; input.focus(); };
      input.focus(); input.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  };
  $('#aiLibrarySearch').oninput = renderLibrary;
  renderLibrary();
  let attachedFile = null;
  let previewUrl = '';
  const showAttachment = () => { const bar = $('#aiAttachment'); if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = attachedFile?.type.startsWith('image/') ? URL.createObjectURL(attachedFile) : ''; bar.hidden = !attachedFile; bar.innerHTML = attachedFile ? `${previewUrl ? `<img src="${previewUrl}" alt="معاينة الصورة المرفقة">` : '📎'}<span>${esc(attachedFile.name)} · ${previewUrl ? 'ستظهر مع رسالتك ويمكن إرفاقها عند النشر في Discord. المساعد النصي لا يرى تفاصيلها.' : 'سيضاف محتواه إلى سؤالك'}</span><button id="aiRemoveFile" type="button" class="btn small secondary">إزالة</button>` : ''; if (attachedFile) $('#aiRemoveFile').onclick = () => { attachedFile = null; $('#aiFile').value = ''; showAttachment(); }; };
  $('#aiAttach').onclick = () => $('#aiFile').click();
  $('#aiFile').onchange = event => { const file = event.target.files[0]; if (!file) return; if (file.size > 10 * 1024 * 1024) { toast('الملف أكبر من 10 ميجابايت.'); event.target.value = ''; return; } attachedFile = file; showAttachment(); };
  const renderProposal = item => {
    const proposal = item.status === 'completed' ? item.proposal : null;
    if (!proposal) return '';
    const operations = proposal.operations || [];
    const interactiveSummary = proposal.interactive?.kind === 'giveaway' ? `🎉 جيف آواي: ${esc(proposal.interactive.prize)} · ${esc(proposal.interactive.winnerCount)} فائز · ${esc(proposal.interactive.durationMinutes)} دقيقة` : proposal.interactive?.kind === 'poll' ? `📊 استطلاع: ${esc(proposal.interactive.question)} · ${proposal.interactive.options.length} خيارات` : `🎫 لوحة تذاكر: ${esc(proposal.interactive?.title || '')}`;
    return `<div class="ai-action-card"><span class="ai-action-step">الخطوة الأخيرة قبل التنفيذ</span><b>راجع ما سيتغير في ${esc(state.data?.guild?.name || 'سيرفرك')}</b>${operations.length ? `<p>${operations.map(op => `${op.action === 'update' ? 'تعديل' : 'إنشاء'} ${op.resource_type === 'role' ? 'رتبة' : op.resource_type === 'category' ? 'تصنيف' : 'قناة'}: ${esc(op.name)}`).join(' · ')}</p><button class="btn primary small" type="button" data-ai-plan="${esc(item.id)}">مراجعة التغييرات وتأكيدها</button>` : ''}${proposal.message ? `<p>رسالة إلى #${esc(proposal.message.channel)}: ${esc(proposal.message.content)}</p>${item.sent_message_id ? `<a class="btn small secondary" href="https://discord.com/channels/${encodeURIComponent(guild)}/${encodeURIComponent(item.sent_channel_id)}/${encodeURIComponent(item.sent_message_id)}" target="_blank" rel="noopener noreferrer">تم الإرسال · عرض في Discord</a>` : `<button class="btn primary small" type="button" data-ai-message="${esc(item.id)}">مراجعة الرسالة وتأكيد النشر</button>`}` : ''}${proposal.interactive ? `<p>${interactiveSummary}${item.has_attachment && proposal.interactive.kind !== 'poll' ? ' · 🖼️ مع بنر' : ''}</p>${item.interactive_message_id ? `<a class="btn small secondary" href="https://discord.com/channels/${encodeURIComponent(guild)}/${encodeURIComponent(item.interactive_channel_id)}/${encodeURIComponent(item.interactive_message_id)}" target="_blank" rel="noopener noreferrer">تم النشر · عرض في Discord</a>` : `<button class="btn primary small" type="button" data-ai-interactive="${esc(item.id)}">مراجعة النظام التفاعلي وتشغيله</button>`}` : ''}<small>${item.sent_message_id || item.interactive_message_id ? 'راجع رابط العملية المنفذة أعلاه.' : 'لم يُنفّذ شيء بعد. يمكنك مراجعة التفاصيل قبل التأكيد.'}</small></div>`;
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
    thread.innerHTML = messages.length ? messages.map(item => `<div class="ai-turn"><div class="ai-bubble user"><b>أنت</b><div>${esc(item.prompt)}</div>${item.has_attachment ? `<img class="ai-sent-image" src="/api/ai/requests/${encodeURIComponent(item.id)}/attachment" alt="الصورة المرفقة بهذه الرسالة">` : ''}</div><div class="ai-bubble assistant"><b>AI ديسكوكو</b><div>${esc(item.status === 'completed' ? item.answer || '' : item.status === 'failed' ? item.error || 'تعذر توليد الرد. حاول مجددًا.' : 'جارٍ تجهيز الرد…')}</div>${item.status === 'completed' && item.answer && !item.proposal && !item.sent_message_id ? `<button class="btn small secondary" type="button" data-ai-publish-answer="${esc(item.id)}">حوّل الرد إلى رسالة للمراجعة</button>` : ''}${item.sent_message_id && !item.proposal ? `<a class="btn small secondary" href="https://discord.com/channels/${encodeURIComponent(guild)}/${encodeURIComponent(item.sent_channel_id)}/${encodeURIComponent(item.sent_message_id)}" target="_blank" rel="noopener noreferrer">عرض الرسالة المنشورة في Discord</a>` : ''}</div>${renderProposal(item)}</div>`).join('') : `<div class="ai-welcome"><span>✦</span><h2>أهلًا، أنا AI ديسكوكو</h2><p>قل لي وش تحتاج في سيرفرك، وبساعدك بخطوات واضحة. تقدر تتابع معي في نفس المحادثة، وسأفهم سياق كلامنا.</p><div class="ai-suggestions"><button type="button" data-ai-suggestion="اقترح لي ترتيب رومات لسيرفر ألعاب">رتب لي الرومات</button><button type="button" data-ai-suggestion="اقترح رتب وصلاحيات مناسبة لمجتمعي">نظّم الرتب</button></div></div>`;
    thread.querySelectorAll('[data-ai-suggestion]').forEach(button => button.onclick = () => { input.value = button.dataset.aiSuggestion; input.focus(); });
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
    thread.querySelectorAll('[data-ai-plan]').forEach(button => button.onclick = run(async () => {
      const item = messages.find(entry => entry.id === button.dataset.aiPlan);
      if (!item?.proposal?.operations?.length) return;
      const created = await api('/api/change-sets', { method: 'POST', body: JSON.stringify({ guildId: guild, operations: item.proposal.operations }) });
      await showPlan(created.changeSet.id);
    }));
    thread.querySelectorAll('[data-ai-message]').forEach(button => button.onclick = () => {
      const item = messages.find(entry => entry.id === button.dataset.aiMessage);
      if (!item?.proposal?.message) return;
      const textChannels = (state.data.channels || []).filter(channel => [0, 5].includes(channel.type));
      modal('مراجعة الرسالة قبل إرسالها', `<label>قناة النشر<select id="aiMessageChannel"><option value="">اختر قناة نصية</option>${textChannels.map(channel => `<option value="${esc(channel.id)}" ${channel.name.toLowerCase() === item.proposal.message.channel.toLowerCase() ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}</select></label><label>نص الرسالة<textarea id="aiMessageContent" rows="5" maxlength="1800">${esc(item.proposal.message.content)}</textarea></label>${item.has_attachment ? `<div class="ai-review-image"><img src="/api/ai/requests/${encodeURIComponent(item.id)}/attachment" alt="الصورة المرفقة مع طلبك"><span>ستُرسل هذه الصورة مع الرسالة إلى Discord</span></div>` : ''}<label>تغيير الصورة أو إرفاق صورة (اختياري)<input id="aiMessageImage" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="form-note">ستُنشر مرة واحدة بواسطة بوت ديسكوكو، ولن تُرسل إشارات جماعية.</p><label class="check-row"><input id="aiMessageConfirmed" type="checkbox">راجعت الرسالة والقناة وأوافق على نشرها.</label>`, '<button class="btn secondary" id="aiMessageCancel">إلغاء</button><button class="btn primary" id="aiMessageSend" disabled>نعم، أؤكد التنفيذ</button>');
      $('#aiMessageCancel').onclick = closeDialog;
      $('#aiMessageConfirmed').onchange = event => { $('#aiMessageSend').disabled = !event.target.checked; };
      $('#aiMessageSend').onclick = async event => { event.currentTarget.disabled = true; try {
        if (!$('#aiMessageChannel').value) throw Error('اختر القناة التي ستُنشر فيها الرسالة.');
        const file = $('#aiMessageImage').files[0];
        const image = file ? await prepareAiImage(file) : undefined;
        await api(`/api/ai/requests/${encodeURIComponent(item.id)}/send-message`, { method: 'POST', body: JSON.stringify({ confirmed: true, channelId: $('#aiMessageChannel').value, content: $('#aiMessageContent').value, image }) });
        closeDialog(); await loadMessages(); toast('نُشرت الرسالة في Discord.');
      } catch (error) { modalError(error); $('#aiMessageSend').disabled = false; } };
    });
    thread.querySelectorAll('[data-ai-interactive]').forEach(button => button.onclick = () => {
      const item = messages.find(entry => entry.id === button.dataset.aiInteractive);
      const plan = item?.proposal?.interactive; if (!plan) return;
      const channels = (state.data.channels || []).filter(channel => [0, 5].includes(channel.type));
      const knownChannel = channels.some(channel => channel.name.toLowerCase() === String(plan.channel || '').toLowerCase());
      const channelField = `<label>قناة النشر<select id="aiInteractiveChannel"><option value="">اختر قناة نصية</option>${channels.map(channel => `<option value="${esc(channel.id)}" ${channel.name.toLowerCase() === String(plan.channel || '').toLowerCase() ? 'selected' : ''}>#${esc(channel.name)}</option>`).join('')}${plan.kind === 'tickets' ? `<option value="__create__" ${knownChannel ? '' : 'selected'}>＋ أنشئ قناة دعم جديدة</option>` : ''}</select></label>${plan.kind === 'tickets' ? `<label>اسم القناة الجديدة (إذا اخترت إنشاءها)<input id="aiNewSupportChannel" maxlength="100" value="${esc(!knownChannel && plan.channel ? plan.channel : 'الدعم')}"></label>` : ''}`;
      const fields = plan.kind === 'giveaway' ? `${channelField}<label>الجائزة<input id="aiPrize" maxlength="160" value="${esc(plan.prize)}"></label><div class="form-grid two"><label>المدة بالدقائق<input id="aiDuration" type="number" min="5" max="43200" value="${Number(plan.durationMinutes)}"></label><label>عدد الفائزين<input id="aiWinners" type="number" min="1" max="20" value="${Number(plan.winnerCount)}"></label></div><p class="form-note">ينشر البوت زر مشاركة ويسحب الفائزين عشوائيًا عند انتهاء المدة.</p>` : plan.kind === 'poll' ? `${channelField}<label>السؤال<input id="aiPollQuestion" maxlength="180" value="${esc(plan.question)}"></label>${plan.options.map((option, index) => `<label>الخيار ${index + 1}<input data-ai-poll-option maxlength="70" value="${esc(option)}"></label>`).join('')}<p class="form-note">يسمح الاستطلاع بصوت واحد لكل عضو، ويمكنه تغيير اختياره. تظهر النتائج له بعد التصويت.</p>` : `${channelField}<label>عنوان لوحة الدعم<input id="aiTicketTitle" maxlength="100" value="${esc(plan.title)}"></label><label>الوصف<textarea id="aiTicketDescription" maxlength="800" rows="3">${esc(plan.description)}</textarea></label><label>تصنيف التذاكر (اختياري)<select id="aiTicketCategory"><option value="">دون تصنيف</option>${(state.data.channels || []).filter(channel => channel.type === 4).map(channel => `<option value="${esc(channel.id)}">${esc(channel.name)}</option>`).join('')}</select></label><label>رتبة فريق الدعم (مطلوبة)<select id="aiStaffRole"><option value="">اختر رتبة الدعم</option>${(state.data.roles || []).filter(role => role.id !== guild).map(role => `<option value="${esc(role.id)}">${esc(role.name)}</option>`).join('')}</select></label><p class="form-note">يفتح زر الدعم قناة خاصة لكل عضو. التذكرة خاصة بصاحبها ورتبة الدعم المحددة.</p>`;
      modal(plan.kind === 'giveaway' ? 'مراجعة الجيف آواي' : plan.kind === 'poll' ? 'مراجعة الاستطلاع' : 'مراجعة لوحة تذاكر الدعم', `${fields}${item.has_attachment && plan.kind !== 'poll' ? `<div class="ai-review-image"><img src="/api/ai/requests/${encodeURIComponent(item.id)}/attachment" alt="بنر النظام التفاعلي"><span>سيظهر هذا البنر مع اللوحة في Discord</span></div>` : ''}<label class="check-row"><input id="aiInteractiveConfirmed" type="checkbox">راجعت الإعدادات وأوافق على النشر في Discord.</label>`, '<button class="btn secondary" id="aiInteractiveCancel">إلغاء</button><button class="btn primary" id="aiInteractiveLaunch" disabled>نعم، أؤكد التنفيذ</button>');
      $('#aiInteractiveCancel').onclick = closeDialog;
      $('#aiInteractiveConfirmed').onchange = event => { $('#aiInteractiveLaunch').disabled = !event.target.checked; };
      $('#aiInteractiveLaunch').onclick = async event => { event.currentTarget.disabled = true; try {
        const creatingSupportChannel = plan.kind === 'tickets' && $('#aiInteractiveChannel').value === '__create__';
        const body = { confirmed: true, channelId: creatingSupportChannel ? '' : $('#aiInteractiveChannel').value, ...(plan.kind === 'giveaway' ? { prize: $('#aiPrize').value, durationMinutes: Number($('#aiDuration').value), winnerCount: Number($('#aiWinners').value) } : plan.kind === 'poll' ? { question: $('#aiPollQuestion').value, options: [...document.querySelectorAll('[data-ai-poll-option]')].map(field => field.value) } : { title: $('#aiTicketTitle').value, description: $('#aiTicketDescription').value, categoryId: $('#aiTicketCategory').value, staffRoleId: $('#aiStaffRole').value, ...(creatingSupportChannel ? { createChannelName: $('#aiNewSupportChannel').value } : {}) }) };
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
    if (!available) { toast(planEnabled ? 'الجهاز المحلي غير متصل حاليًا.' : 'طوّر باقتك لاستخدام AI ديسكوكو.'); return; }
    let prompt = input.value.trim(); if (!prompt) return;
    if (/\[[^\]]{2,60}\]/.test(prompt)) { toast('استبدل العبارات بين [ ] بتفاصيل طلبك قبل الإرسال.'); input.focus(); return; }
    if (attachedFile?.type === 'text/plain' || attachedFile?.name.toLowerCase().endsWith('.txt')) { const content = await attachedFile.text(); if (content.length > 800) { toast('الملف النصي طويل. الحد 800 حرف.'); return; } prompt = `${prompt}\n\nمحتوى الملف ${attachedFile.name}:\n${content}`; if (prompt.length > 1500) { toast('سؤالك مع الملف يتجاوز 1500 حرف. اختصر النص.'); return; } attachedFile = null; $('#aiFile').value = ''; showAttachment(); }
    busy = true; $('#aiSend').disabled = true; notice.textContent = '';
    try {
      const image = attachedFile?.type.startsWith('image/') ? await prepareAiImage(attachedFile) : undefined;
      const result = await api('/api/ai/requests', { method: 'POST', body: JSON.stringify({ guildId: guild, conversationId: selected || undefined, prompt, image }) });
      if (!active()) return;
      selected = result.conversationId; sessionStorage.setItem(storageKey, selected); input.value = ''; selectedTemplate = null; $('#aiTemplateDraft').hidden = true; attachedFile = null; $('#aiFile').value = ''; showAttachment();
      messages.push({ id: result.id, prompt, status: 'pending', has_attachment: !!image }); renderMessages();
      try { await refreshList(); await loadMessages(); }
      catch (error) { notice.textContent = 'حُفظت رسالتك، لكن تعذر تحديث السجل الآن. أعد فتح المحادثة بعد قليل.'; poll(result.id, selected); }
    } finally { busy = false; if (active()) $('#aiSend').disabled = false; }
  });
  input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#assistantForm').requestSubmit(); } };
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, recordingTimer = null, recordingStart = 0;
  const endRecordingUi = () => { clearInterval(recordingTimer); $('#aiRecording').hidden = true; $('#aiVoice').classList.remove('recording'); };
  $('#aiStopVoice').onclick = () => recognition?.stop();
  $('#aiVoice').onclick = async () => {
    if (recognition) { recognition.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { notice.textContent = 'المايك غير متاح هنا. افتح الموقع في Chrome.'; return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); }
    catch (error) { notice.textContent = ['NotAllowedError','PermissionDeniedError'].includes(error.name) ? 'المايك محظور. اسمح له من أيقونة الموقع بجانب الرابط.' : error.name === 'NotFoundError' ? 'لا يوجد مايك متصل بالجهاز.' : 'تعذر تشغيل المايك. جرّب Chrome مباشرة.'; return; }
    if (!Recognition) { notice.textContent = 'تم السماح بالمايك، لكن تحويل الصوت غير مدعوم هنا.'; return; }
    let devices = []; try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput'); } catch {}
    modal('اختيار الميكروفون', `<p class="form-note">يستخدم تحويل الكلام إلى نص ميكروفون المتصفح الافتراضي. إذا عندك أكثر من جهاز، اختر الميكروفون الافتراضي من إعدادات المتصفح أو النظام قبل البدء.</p><div class="ai-device-list">${devices.map(device => `<div>🎙 ${esc(device.label || 'ميكروفون')}</div>`).join('') || '<div>الميكروفون الافتراضي</div>'}</div><p class="form-note">بعد السماح، سيظهر شريط التسجيل والكلام المكتوب قبل أن تضغط إرسال.</p>`, '<button id="aiVoiceCancel" class="btn secondary" type="button">إلغاء</button><button id="aiVoiceStart" class="btn primary" type="button">ابدأ التسجيل</button>');
    $('#aiVoiceCancel').onclick = closeDialog;
    $('#aiVoiceStart').onclick = () => { closeDialog(); startRecognition(); };
  };
  const startRecognition = () => {
    recognition = new Recognition(); recognition.lang = 'ar-SA'; recognition.interimResults = true; recognition.continuous = false;
    const before = input.value.trim();
    recognition.onstart = () => { $('#aiVoice').classList.add('recording'); $('#aiRecording').hidden = false; recordingStart = Date.now(); $('#aiRecordingTime').textContent = '00:00'; recordingTimer = setInterval(() => { const seconds = Math.floor((Date.now() - recordingStart) / 1000); $('#aiRecordingTime').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }, 1000); notice.textContent = 'تكلّم الآن… سيظهر النص قبل الإرسال. قد يستخدم المتصفح خدمته للتعرف على الصوت.'; };
    recognition.onresult = event => { const spoken = [...event.results].map(result => result[0].transcript).join(' ').trim(); input.value = [before, spoken].filter(Boolean).join(' '); };
    recognition.onerror = event => { notice.textContent = event.error === 'not-allowed' ? 'اسمح للمتصفح باستخدام الميكروفون ثم حاول مجددًا.' : 'تعذر تحويل الصوت إلى نص. حاول مجددًا أو اكتب رسالتك.'; };
    recognition.onend = () => { recognition = null; endRecordingUi(); if (notice.textContent.startsWith('تكلّم')) notice.textContent = 'راجع النص ثم اضغط إرسال.'; input.focus(); };
    try { recognition.start(); } catch { recognition = null; toast('تعذر بدء التسجيل الصوتي.'); }
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
  $('#workspace').innerHTML = head('أوامر ديسكوكو', 'هذه الأوامر تعمل الآن داخل Discord. إعدادات البوتات الخاصة تظهر في بوتاتي.') + connectionNotice() + `<div class="grid-2">${panel('إعدادات Diskoko', `<form id="botForm" class="panel-body form-grid"><label class="check-row"><input id="botEnabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>تفعيل أوامر Diskoko في هذا السيرفر</label><div class="form-grid two"><label>لغة الردود<select id="botLocale"><option value="ar" ${settings.locale === 'ar' ? 'selected' : ''}>العربية</option><option value="en" ${settings.locale === 'en' ? 'selected' : ''}>English</option></select></label><label>قناة سجل الأوامر<select id="logChannel"><option value="">دون سجل رسائل</option>${textChannels.map(channel => `<option value="${esc(channel.id)}" ${settings.log_channel_id === channel.id ? 'selected' : ''}># ${esc(channel.name)}</option>`).join('')}</select></label></div><div>${commands.map(([key, title, description]) => `<div class="row"><label class="check-row"><input class="command-check" type="checkbox" value="${key}" ${settings.command_keys.includes(key) ? 'checked' : ''}></label><div class="row-main"><b>${title} <code>/diskoko ${key}</code></b><small>${description}</small></div><button class="btn text" type="button" data-preview="${key}">معاينة</button></div>`).join('')}</div><p class="form-note">حفظ الإعدادات يغيّر سلوك البوت مباشرة. لا يمنحه صلاحيات جديدة.</p><div class="actions"><button class="btn primary" ${!state.data.connection.readable ? 'disabled' : ''}>حفظ إعدادات البوت</button></div></form>`)}${panel('معاينة الرد', '<div class="panel-body"><div class="preview"><b>◈ Diskoko</b> <span class="badge purple">مثال توضيحي</span><div class="message" id="botPreview">أهلًا! اعرض أوامر مجتمعك باستخدام /diskoko help.</div></div><p class="export-note">المعاينة لا ترسل رسالة إلى Discord.</p></div>')}</div>`;
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
  $('#workspace').innerHTML = head('كل تغيير، وقصته.', 'راجع المسودات، ونتائج التطبيق، وآخر إجراءاتك على هذا السيرفر.', '<button class="btn secondary" id="exportActivity">تصدير السجل ↓</button>') + panel('خطط التغييرات', changeRows(state.data.changeSets)) + panel('سجل إجراءاتك', state.data.activity.length ? `<div class="rows">${state.data.activity.map(event => `<div class="row"><span class="row-icon">◷</span><div class="row-main"><b>${esc(names[event.action] || 'إجراء على السيرفر')}</b><small>${date(event.created_at)}${event.details?.error ? ` · ${esc(event.details.error)}` : ''}</small></div></div>`).join('')}</div>` : empty('لا توجد إجراءات مسجلة لك بعد', 'ستظهر هنا الإجراءات الجديدة التي تنفذها من لوحة السيرفر.'));
  bindPlans(); $('#exportActivity').onclick = () => download('diskoko-change-history.json', { guild: state.data.guild.name, changeSets: state.data.changeSets, activity: state.data.activity });
}
function safety() {
  const d = state.data; const roles = d.roles || []; const adminRoles = roles.filter(role => (BigInt(role.permissions || '0') & 8n) !== 0n);
  $('#workspace').innerHTML = head('وضوح الصلاحيات، بداية الأمان.', 'افحص بنية الصلاحيات وتحقق من التغييرات قبل تنفيذها.') + connectionNotice() + `<div class="safety-grid">${panel('مراجعة قبل التطبيق', '<div class="panel-body"><span class="badge good">ضمن رحلة التعديل</span><p>إضافة القنوات والرتب وتعديلها تمر بخطة محفوظة وتأكيد منك قبل التنفيذ. تظهر العمليات المكتملة والمتعثرة منفصلة.</p></div>')}${panel('حالة قراءة السيرفر', `<div class="panel-body">${badge(d.connection.readable ? 'القنوات والرتب متاحة' : 'تعذر التحقق', d.connection.readable ? 'good' : 'warn')}<p>نجاح القراءة لا يضمن صلاحية تعديل كل رتبة. يتحقق Discord من الصلاحيات وترتيب رتبة البوت أثناء التنفيذ.</p></div>`)}</div>${panel('رتب تملك صلاحية Administrator', !d.roles ? empty('تعذر قراءة الرتب', 'أكمل التحقق من الاتصال لعرض الصلاحيات.') : adminRoles.length ? `<div class="notice info"><div><b>${fmt(adminRoles.length)} رتب لديها صلاحية واسعة.</b><p>راجع الحاجة لهذه الصلاحية في Discord. لا يتم تعديلها تلقائيًا.</p></div></div><div class="rows">${adminRoles.map(role => `<div class="row"><span class="row-icon">◇</span><div class="row-main"><b>${esc(role.name)}</b><small>${role.managed ? 'رتبة يديرها تطبيق' : 'رتبة في السيرفر'}</small></div>${badge('Administrator', 'warn')}</div>`).join('')}</div>` : empty('لا توجد رتب بهذه الصلاحية', 'هذا فحص للرتب المقروءة فقط، وليس تقييمًا كاملًا لأمان السيرفر.'))}<div class="notice info"><div><b>حماية الرسائل والسبام</b><p>استخدم AutoMod في Discord لإدارة قواعد منع السبام. هذه اللوحة لا تدّعي تشغيل حماية غير مفعلة.</p></div><a class="btn secondary" href="https://discord.com/channels/${encodeURIComponent(state.guild)}" target="_blank" rel="noopener">فتح السيرفر ↗</a></div>`;
}
function settings() {
  const d = state.data;
  $('#workspace').innerHTML = head('إعدادات مساحة مجتمعك.', 'اتصال السيرفر وتفضيلات النشاط، في مكان واحد.') + `<div class="steps"><span class="step done">✓ الحساب مرتبط</span><span class="step ${d.connection.status === 'installed' ? 'done' : ''}">${d.connection.status === 'installed' ? '✓' : '2'} إضافة Diskoko</span><span class="step ${d.connection.readable ? 'done' : ''}">${d.connection.readable ? '✓' : '3'} قراءة السيرفر</span></div><div class="grid-2">${panel('الاتصال بـ Discord', `<div class="panel-body form-grid"><div class="server-title"><span class="server-image">${esc(d.guild.name.slice(0, 1))}</span><div><h3>${esc(d.guild.name)}</h3><small>${d.guild.owner ? 'أنت مالك السيرفر' : 'لديك صلاحية الإدارة'}</small></div></div><div class="row"><div class="row-main"><b>حالة الربط</b><small>آخر تحقق: ${date(d.connection.checked_at)}</small></div>${status(d.connection.status)}</div><div class="actions"><button class="btn primary" id="installBot">${d.connection.status === 'installed' ? 'مراجعة ربط البوت ↗' : 'إضافة Diskoko إلى السيرفر ↗'}</button><button class="btn secondary" id="verifyBot">إعادة التحقق</button></div><p class="form-note">بعد العودة من Discord سنعيد التحقق تلقائيًا. لا نطلب صلاحية Administrator.</p><details><summary>تفاصيل السيرفر</summary><p><code>${esc(state.guild)}</code></p><button class="btn text" id="copyGuild">نسخ المعرّف</button></details></div>`)}${panel('خصوصية إحصاءات النشاط', `<div class="panel-body form-grid"><div>${badge(d.preferences.analytics_enabled ? 'جمع النشاط مفعّل' : 'جمع النشاط غير مفعّل', d.preferences.analytics_enabled ? 'good' : 'neutral')}</div><p>يجمع البوت عدد الرسائل وأسماء المشاركين فقط، دون محتوى الرسائل، لمدة 30 يومًا. الإيقاف يمنع جمع أحداث جديدة.</p><button class="btn secondary" id="toggleAnalytics">${d.preferences.analytics_enabled ? 'إيقاف جمع النشاط' : 'تفعيل جمع النشاط'}</button>${action('عرض التحليلات', 'analytics', 'text')}</div>`)}</div>${panel('نسخة من البنية الحالية', '<div class="panel-body"><p>نزّل القنوات والرتب للمراجعة أو التوثيق. الملف لا يحتوي رسائل الأعضاء، ولا يوفّر استعادة تلقائية للسيرفر.</p><div class="actions" style="margin-top:18px"><button class="btn secondary" id="exportStructure">تصدير بنية السيرفر ↓</button></div></div>')}`;
  $('#installBot').onclick = run(async () => { const result = await api(`/api/guilds/${encodeURIComponent(state.guild)}/install-url`); window.open(result.url, '_blank', 'noopener'); state.awaitingInstall = true; });
  $('#verifyBot').onclick = run(async event => { event.currentTarget.disabled = true; try { await loadGuild(); } finally { $('#verifyBot') && ($('#verifyBot').disabled = false); } });
  $('#copyGuild').onclick = run(async () => { await navigator.clipboard.writeText(state.guild); toast('نُسخ معرّف السيرفر.'); });
  $('#toggleAnalytics').onclick = () => confirmDialog(d.preferences.analytics_enabled ? 'إيقاف جمع النشاط؟' : 'تفعيل جمع النشاط؟', 'يؤثر التغيير في جمع أحداث الرسائل الجديدة. لا يُحفظ محتوى الرسائل، وتبقى الأعداد السابقة حتى نهاية مدة الاحتفاظ البالغة 30 يومًا.', 'تأكيد', async () => { await api(`/api/workspace/${encodeURIComponent(state.guild)}/preferences`, { method: 'PUT', body: JSON.stringify({ analytics_enabled: !d.preferences.analytics_enabled }) }); closeDialog(); await loadGuild(); });
  $('#exportStructure').disabled = !d.connection.readable;
  $('#exportStructure').onclick = () => download('diskoko-server-structure.json', { exported_at: new Date().toISOString(), guild: { id: state.guild, name: d.guild.name }, channels: d.channels, roles: d.roles });
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






