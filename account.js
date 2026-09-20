const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let account;
function target() { return ['servers', 'create', 'subscription'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'servers'; }
async function api(path, options) { const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...options }); const data = await response.json(); if (!response.ok) throw Object.assign(Error(data.error || 'تعذر تحميل البيانات.'), { status: response.status }); return data; }
function render() {
  const view = target();
  document.querySelectorAll('[data-view]').forEach(link => { link.classList.toggle('active', link.dataset.view === view); if (link.dataset.view === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('#breadcrumb').textContent = { servers: 'سيرفراتي', create: 'تجهيز سيرفر', subscription: 'الاشتراك والاستخدام' }[view];
  $('#accountName').textContent = account.user.displayName || account.user.username;
  const plan = account.plan?.plan || account.user.plan;
  $('#planBadge').textContent = ({ trial: 'تجريبية', starter: 'Starter', growth: 'Growth', complete: 'Complete' }[plan]) || plan;
  if (view === 'servers') {
    const linked = account.servers.filter(guild => guild.connection?.install_status === 'installed').length;
    $('#workspace').innerHTML = `<div class="page-head"><div><span class="eyebrow">أهلًا، ${esc(account.user.displayName || account.user.username)}</span><h1>مجتمعاتك، في مكان واحد.</h1><p>اختر السيرفر. الباقي صار أقرب.</p></div><a class="btn primary" href="#create">＋ تجهيز سيرفر جديد</a></div><section class="hero"><div><span class="eyebrow">مساحة عملك</span><h2>ابدأ من مجتمعك.</h2><p>من ترتيب القنوات إلى متابعة النشيطين، كل سيرفر له مساحة واضحة وتغييرات تمر بمراجعتك.</p></div><div class="hero-art" aria-hidden="true"><span>◈</span></div></section><div class="section-title"><h3>سيرفراتي <span class="badge purple">${account.servers.length}</span></h3><small>${linked} مرتبطة · ${account.servers.length - linked} تحتاج تحققًا أو ربطًا</small></div><div class="server-grid">${account.servers.map(guild => {
      const ready = guild.connection?.install_status === 'installed';
      return `<article class="server-card"><div class="server-title"><span class="server-image">${guild.icon ? `<img src="https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=96" alt="">` : esc(guild.name.slice(0, 1))}</span><div class="row-main"><h3>${esc(guild.name)}</h3><small>${guild.owner ? 'أنت مالك السيرفر' : 'لديك صلاحية الإدارة'}</small></div><span class="badge ${ready ? 'good' : 'warn'}">${ready ? 'البوت مثبت' : 'أكمل الربط'}</span></div><p class="form-note">${ready ? 'افتح مساحة سيرفرك للتحقق من حالته وإدارته.' : 'أضف Diskoko وتحقق من الاتصال في خطوات واضحة.'}</p><a class="btn ${ready ? 'primary' : 'secondary'}" href="/studio?guild=${encodeURIComponent(guild.id)}#${ready ? 'overview' : 'settings'}">${ready ? 'فتح لوحة السيرفر' : 'إكمال الربط'} ←</a></article>`;
    }).join('') || '<div class="panel"><div class="empty"><h3>لم نجد سيرفرات قابلة للإدارة</h3><p>تأكد من الحساب وصلاحية إدارة السيرفر، أو أنشئ سيرفرًا جديدًا في Discord.</p><a class="btn primary" href="#create">ابدأ من هنا</a></div></div>'}</div>`;
  } else if (view === 'create') {
    $('#workspace').innerHTML = `<div class="page-head"><div><span class="eyebrow">بداية جديدة</span><h1>من فكرة، إلى مجتمع.</h1><p>أنشئ السيرفر في Discord، ثم جهّزه هنا بالقنوات والرتب التي تناسبه.</p></div><a class="btn secondary" href="#servers">سيرفراتي ←</a></div><div class="panel"><div class="row"><span class="row-icon">1</span><div class="row-main"><b>أنشئ السيرفر في Discord</b><small>افتح Discord، واختر إضافة سيرفر ثم إنشاء سيرفر خاص بك.</small></div><a class="btn primary" href="https://discord.com/app" target="_blank" rel="noopener">فتح Discord ↗</a></div><div class="row"><span class="row-icon">2</span><div class="row-main"><b>ارجع وحدّث قائمة السيرفرات</b><small>سنبحث عن السيرفرات التي تملكها أو تستطيع إدارتها.</small></div><button class="btn secondary" id="syncServers">تحديث السيرفرات</button></div><div class="row"><span class="row-icon">3</span><div class="row-main"><b>اربط Diskoko وابدأ التجهيز</b><small>اختر «إكمال الربط»، ثم راجع القنوات والرتب أو جرّب قالبًا.</small></div><a class="btn secondary" href="#servers">اختيار السيرفر</a></div></div><div class="notice info"><div><b>خطوات واضحة، وصلاحيات محددة.</b><p>يمكنك معاينة التغييرات قبل تطبيقها. لا نطلب صلاحية Administrator.</p></div></div>`;
    $('#syncServers').onclick = async () => { await load(); location.hash = 'servers'; };
  } else {
    const custom = account.usage.customBots; const changes = account.usage.changeSetsPerMonth;
    const linked = account.servers.filter(guild => guild.connection?.install_status === 'installed').length;
    const names = { active: 'نشطة', trial: 'تجريبية', expired: 'منتهية', cancelled: 'ملغاة', past_due: 'تحتاج متابعة الدفع' };
    $('#workspace').innerHTML = `<div class="page-head"><div><span class="eyebrow">حسابك</span><h1>خطة واضحة، واستخدام معروف.</h1><p>اعرف حدود حسابك قبل بدء المهمة التالية.</p></div><a class="btn secondary" href="/plans.html">تفاصيل الباقات ↗</a></div><section class="hero"><div><span class="eyebrow">خطتك الحالية</span><h2>${esc($('#planBadge').textContent)}</h2><p>${esc(names[account.plan.status] || 'تحقق من حالة الاشتراك')} · ${account.plan.current_period_end ? `حتى ${new Date(account.plan.current_period_end).toLocaleDateString('ar-SA')}` : 'لا يوجد تاريخ انتهاء محدد'}</p></div><span class="badge purple">${esc(names[account.plan.status] || 'الخطة الحالية')}</span></section><div class="metrics"><article class="metric"><span>السيرفرات المرتبطة</span><b>${linked} / ${account.limits.servers}</b><small>المستخدمة / حد الخطة</small></article><article class="metric"><span>خطط التغييرات</span><b>${changes.used} / ${changes.limit}</b><small>خلال هذا الشهر</small></article><article class="metric"><span>ملفات البوت المحفوظة</span><b>${custom.used} / ${custom.limit}</b><small>ملفات تصميم، وليست بوتات مثبتة</small></article></div>`;
  }
}
async function load() {
  $('#workspace').innerHTML = '<div class="loading" role="status">جارٍ تحميل حسابك…</div>';
  try { account = await api('/api/account/overview'); render(); }
  catch (error) {
    const returnTo = new URLSearchParams(location.search).get('returnTo') || '/account.html#servers';
    $('#workspace').innerHTML = `<div class="panel"><div class="empty"><div class="empty-symbol">◈</div><h1>${error.status === 401 ? 'مجتمعك يبدأ من هنا.' : 'تعذر تحميل حسابك'}</h1><p>${esc(error.status === 401 ? 'اربط حساب Discord لعرض السيرفرات التي تستطيع إدارتها.' : error.message)}</p>${error.status === 401 ? `<a class="btn primary" href="/auth/discord?returnTo=${encodeURIComponent(returnTo)}">المتابعة باستخدام Discord ←</a>` : '<button class="btn primary" id="retryAccount">إعادة المحاولة</button>'}</div></div>`;
    $('#retryAccount')?.addEventListener('click', load);
  }
}
$('#refresh').onclick = load;
$('#menuToggle').onclick = () => { const open = $('#sidebar').classList.toggle('open'); $('#menuToggle').setAttribute('aria-expanded', String(open)); };
$('#logout').onclick = async () => { try { const { token } = await api('/api/csrf-token'); await api('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}' }); location.href = '/'; } catch (error) { $('#accountError').textContent = error.message; } };
window.addEventListener('hashchange', () => { if (account) render(); $('#sidebar').classList.remove('open'); $('#menuToggle').setAttribute('aria-expanded', 'false'); });
load();
