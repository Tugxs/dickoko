const reportEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const reportHost = document.querySelector('.article-content');
const reportPanel = document.createElement('section');
reportPanel.className = 'legal-card wide-card';
reportHost.prepend(reportPanel);
async function reportApi(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...options });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'تعذر إكمال الطلب.'), { status: response.status });
  return body;
}
async function showReports() {
  try {
    const { reports } = await reportApi('/api/reports');
    const labels = { open: 'مستلم', in_progress: 'قيد المراجعة', resolved: 'تم الحل', closed: 'مغلق' };
    reportPanel.innerHTML = `<div class="card-kicker">من حسابك مباشرة</div><h2>إرسال بلاغ</h2><p>سيصل البلاغ إلى لوحة الإدارة ويمكنك متابعة حالته هنا. لا ترسل كلمة مرور أو رمز دخول.</p><form id="reportForm" class="report-form"><label>نوع البلاغ<select name="category"><option value="technical">مشكلة تقنية</option><option value="account">الحساب</option><option value="subscription">الاشتراك</option><option value="safety">سلامة المجتمع</option><option value="general">أخرى</option></select></label><label>العنوان<input name="subject" required minlength="5" maxlength="120" placeholder="وصف مختصر للمشكلة"></label><label>التفاصيل<textarea name="details" required minlength="20" maxlength="4000" rows="6" placeholder="ماذا حدث؟ ومتى؟ وما السيرفر المتأثر؟"></textarea></label><button class="primary-btn" type="submit">إرسال البلاغ</button><p id="reportMessage" role="status"></p></form><h3>بلاغاتك الأخيرة</h3><div class="report-history">${reports.length ? reports.map(item => `<div><b>${reportEsc(item.subject)}</b><span>${reportEsc(labels[item.status] || item.status)} · ${new Date(item.created_at).toLocaleDateString('ar-SA')}</span></div>`).join('') : '<p>لم ترسل بلاغًا بعد.</p>'}</div>`;
    document.querySelector('#reportForm').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button');
      const message = document.querySelector('#reportMessage');
      button.disabled = true;
      message.textContent = 'جارٍ إرسال البلاغ…';
      try {
        const { token } = await reportApi('/api/csrf-token');
        const data = Object.fromEntries(new FormData(form));
        const result = await reportApi('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(data) });
        await showReports();
        document.querySelector('#reportMessage').textContent = `تم استلام البلاغ رقم ${result.report.id}.`;
      } catch (error) { message.textContent = error.message; button.disabled = false; }
    };
  } catch (error) {
    reportPanel.innerHTML = error.status === 401 ? '<h2>سجّل دخولك لإرسال بلاغ ومتابعته</h2><p>ربط الحساب يتيح لنا الرد على طلبك وتتبع حالته.</p><a class="primary-btn" href="/auth/discord?returnTo=%2Freports.html">المتابعة باستخدام Discord ←</a>' : `<h2>تعذر تحميل البلاغات</h2><p>${reportEsc(error.message)}</p><button class="primary-btn" id="retryReports">إعادة المحاولة</button>`;
    document.querySelector('#retryReports')?.addEventListener('click', showReports);
  }
}
showReports();
