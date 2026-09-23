const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = halalas => `${(Number(halalas || 0) / 100).toLocaleString('ar-SA')} ر.س`;
const params = new URLSearchParams(location.search);
let plan = ['starter', 'growth', 'business'].includes(params.get('plan')) ? params.get('plan') : 'growth';
let interval = params.get('interval') === 'annual' ? 'annual' : 'monthly';
let coupon = (params.get('coupon') || '').trim().toUpperCase().slice(0, 32);
let account;
let quote;
let quoteVersion = 0;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'تعذر تحميل البيانات.'), { status: response.status });
  return data;
}
async function post(path, body) {
  const { token } = await api('/api/csrf-token');
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
}
function selectedPlan() { return account.plans.find(item => item.key === plan); }
function updateUrl() { history.replaceState(null, '', `/checkout.html?${new URLSearchParams({ plan, interval, ...(coupon ? { coupon } : {}) })}`); }
function render() {
  const current = account.limits.plan || account.plan.plan;
  $('#checkout').innerHTML = `<div class="checkout-heading"><div class="checkout-step"><span>1</span> اختيار الباقة <span>2</span> مراجعة المبلغ <span>3</span> طلب الترقية</div><h1>باقة تناسب الخطوة الجاية لمجتمعك.</h1><p>راجع الخطة والفترة والخصم قبل تسجيل الطلب. الدفع الإلكتروني لم يُفعّل بعد ولن يُخصم منك شيء الآن.</p></div><div class="checkout-grid"><div><section class="checkout-card"><h2>اختر الباقة</h2><div class="checkout-plan-list">${account.plans.filter(item => item.key !== 'free').map(item => `<label class="checkout-plan ${item.key === plan ? 'selected' : ''}"><input type="radio" name="plan" value="${esc(item.key)}" ${item.key === plan ? 'checked' : ''}><strong>${esc(item.name)}</strong><small>${item.servers} سيرفر · ${item.customBots} تصاميم بوتات</small><small>${(interval === 'annual' ? item.annualPrice : item.monthlyPrice).toLocaleString('ar-SA')} ر.س ${interval === 'annual' ? '/ سنة' : '/ شهر'}</small></label>`).join('')}</div></section><section class="checkout-card"><h2>مدة الاشتراك</h2><div class="checkout-cycle"><label class="${interval === 'monthly' ? 'selected' : ''}"><input type="radio" name="interval" value="monthly" ${interval === 'monthly' ? 'checked' : ''}>شهري</label><label class="${interval === 'annual' ? 'selected' : ''}"><input type="radio" name="interval" value="annual" ${interval === 'annual' ? 'checked' : ''}>سنوي · شهران مجانًا</label></div></section><section class="checkout-card"><h2>رمز الخصم</h2><div class="checkout-coupon"><label>لديك كوبون؟<input id="checkoutCoupon" maxlength="32" autocomplete="off" placeholder="اكتب الرمز هنا" value="${esc(coupon)}"></label><button class="btn secondary" id="applyCoupon">تطبيق</button></div><small id="couponFeedback"></small></section><section class="checkout-card"><h2>وسائل الدفع المخطط لها</h2><div class="checkout-methods"><div class="checkout-method"><b>مدى والبطاقات</b><small>قيد الربط</small></div><div class="checkout-method"><b>Apple Pay</b><small>قيد الربط</small></div><div class="checkout-method"><b>تمارا</b><small>قيد الربط</small></div></div><div class="checkout-note">هذه ليست شاشة تحصيل. اختيار الباقة يسجل طلب ترقية فقط، ولا تتغير خطتك حتى يُفعّل الدفع وتؤكد العملية عبر مزود معتمد.</div></section></div><aside class="checkout-card checkout-summary"><span class="eyebrow">ملخص الترقية</span><h2>${esc(selectedPlan().name)}</h2><p>خطتك الحالية: ${esc(account.plan.plan)} · ${interval === 'annual' ? 'سنة' : 'شهر'}</p><div class="checkout-summary-row"><span>سعر الباقة</span><strong id="subtotal">—</strong></div><div class="checkout-summary-row"><span>الخصم</span><strong id="discount">—</strong></div><div class="checkout-summary-row checkout-total"><span>مبلغ الطلب التقديري</span><strong id="total">—</strong></div><small>ستظهر تفاصيل الضريبة ووسيلة الدفع النهائية عند تفعيل بوابة الدفع.</small><button class="btn primary" id="confirmUpgrade" disabled>تسجيل طلب الترقية</button><div class="checkout-error" id="checkoutError" role="alert"></div><a class="btn text" href="/account.html#subscription">العودة للاشتراك والاستخدام</a></aside></div>`;
  document.querySelectorAll('input[name="plan"]').forEach(input => input.onchange = () => { plan = input.value; updateUrl(); render(); refreshQuote(); });
  document.querySelectorAll('input[name="interval"]').forEach(input => input.onchange = () => { interval = input.value; updateUrl(); render(); refreshQuote(); });
  $('#applyCoupon').onclick = () => { coupon = $('#checkoutCoupon').value.trim().toUpperCase(); updateUrl(); refreshQuote(); };
  $('#confirmUpgrade').onclick = submit;
  if (current === plan) $('#checkoutError').textContent = 'هذه باقتك الحالية. اختر باقة مختلفة للترقية.';
}
async function refreshQuote() {
  const version = ++quoteVersion;
  quote = null;
  $('#confirmUpgrade').disabled = true;
  $('#checkoutError').textContent = '';
  $('#couponFeedback').textContent = '';
  try {
    const result = await post('/api/billing/quote', { plan, billing_interval: interval, coupon_code: coupon });
    if (version !== quoteVersion) return;
    quote = result.quote;
    $('#subtotal').textContent = money(quote.subtotal);
    $('#discount').textContent = quote.discount ? `− ${money(quote.discount)}` : 'لا يوجد';
    $('#total').textContent = money(quote.total);
    $('#couponFeedback').textContent = quote.coupon_code ? `تم تطبيق ${quote.coupon_code}` : '';
    $('#confirmUpgrade').disabled = (account.limits.plan || account.plan.plan) === plan;
  } catch (error) { if (version === quoteVersion) $('#checkoutError').textContent = error.message; }
}
async function submit() {
  if (!quote) return;
  const button = $('#confirmUpgrade');
  button.disabled = true; button.textContent = 'جارٍ تسجيل الطلب…';
  try {
    const result = await post('/api/billing/upgrade-requests', { plan, billing_interval: interval, coupon_code: coupon });
    $('#checkout').innerHTML = `<section class="checkout-card checkout-success"><span class="eyebrow">تم استلام الطلب</span><h1>خطوتك القادمة محفوظة.</h1><p>سجّلنا طلب ${esc(selectedPlan().name)} بقيمة تقديرية ${money(result.request.total)}. لم تُجرَ عملية دفع ولم تتغير الباقة بعد. سنوضح طريقة الإكمال عند تفعيل بوابة الدفع.</p><div class="actions" style="margin-top:22px"><a class="btn primary" href="/account.html#subscription">العودة إلى الاشتراك</a><a class="btn secondary" href="/account.html#servers">سيرفراتي</a></div></section>`;
  } catch (error) { $('#checkoutError').textContent = error.message; button.disabled = false; button.textContent = 'إعادة المحاولة'; }
}
async function load() {
  try { account = await api('/api/account/overview'); render(); await refreshQuote(); }
  catch (error) {
    const returnTo = `/checkout.html${location.search}`;
    $('#checkout').innerHTML = `<section class="checkout-card"><h1>${error.status === 401 ? 'ادخل بحسابك لإكمال الترقية' : 'تعذر تحميل صفحة الترقية'}</h1><p>${esc(error.status === 401 ? 'سنحفظ اختيار الباقة ونرجعك هنا بعد تسجيل الدخول.' : error.message)}</p><div class="actions" style="margin-top:20px"><a class="btn primary" href="${error.status === 401 ? `/auth/discord?returnTo=${encodeURIComponent(returnTo)}` : '/checkout.html'}">${error.status === 401 ? 'المتابعة باستخدام Discord' : 'إعادة المحاولة'}</a></div></section>`;
  }
}
load();
