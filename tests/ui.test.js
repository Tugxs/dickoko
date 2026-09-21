import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { fixtureResponse, guild, workspace } from './fixtures.js';
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 5)); };
async function page(hash = 'overview', response = fixtureResponse, file = 'studio.html', script = 'workspace.js') {
  const dom = new JSDOM(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { url: `https://diskoko.test/studio?guild=${guild.id}#${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const requests = [];
  dom.window.fetch = async (url, options = {}) => { requests.push({ url, options }); const body = response(url); return { ok: !body?.error, status: body?.error ? 502 : 200, json: async () => structuredClone(body) }; };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.eval(fs.readFileSync(new URL(`../${script}`, import.meta.url), 'utf8')); await settle();
  return { dom, requests, doc: dom.window.document };
}
test('deep link opens the requested guild with true live data and one navigation controller', async () => {
  const { dom, doc, requests } = await page('builder');
  assert.match(doc.querySelector('h1').textContent, /مساحة مرتبة/); assert.match(doc.body.textContent, /الدردشة/);
  assert.equal(doc.querySelectorAll('.nav-link').length, 8); assert.equal(requests.filter(r => r.url === '/api/account/overview').length, 1); dom.window.close();
});
test('upstream failure renders retry, never empty guild list', async () => {
  const { dom, doc } = await page('overview', url => url.startsWith('/api/workspace/') ? { error: 'Discord unavailable' } : fixtureResponse(url));
  assert.match(doc.body.textContent, /Discord unavailable/); assert.ok(doc.querySelector('#retry')); assert.doesNotMatch(doc.body.textContent, /لا توجد سيرفرات/); dom.window.close();
});
test('adding a resource stages a guild-specific draft without calling mutation API', async () => {
  const { dom, doc, requests } = await page('builder'); doc.querySelector('#newResource').click();
  doc.querySelector('#resourceName').value = 'ترحيب'; doc.querySelector('#resourceForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(doc.querySelector('#draftBar').hidden, false); assert.match(dom.window.localStorage.getItem(`diskoko:review:1:${guild.id}`), /ترحيب/);
  assert.equal(requests.filter(req => req.options.method && req.options.method !== 'GET').length, 0); dom.window.close();
});
test('bot form reflects actual settings, supported commands only', async () => {
  const { dom, doc } = await page('bots'); assert.equal(doc.querySelectorAll('.command-check').length, 3); assert.equal(doc.querySelector('#botEnabled').checked, true); assert.match(doc.body.textContent, /diskoko ping/); dom.window.close();
});
test('analytics opt-in is separate from viewing analytics', async () => {
  const { dom, doc, requests } = await page('analytics'); assert.ok(doc.querySelector('#enableAnalytics')); assert.match(doc.body.textContent, /دون تخزين محتوى الرسائل/); assert.equal(requests.filter(req => req.options.method === 'PUT').length, 0); dom.window.close();
});
test('hash navigation changes active section without losing guild context', async () => {
  const { dom, doc } = await page(); dom.window.location.hash = 'activity'; await settle(); assert.match(doc.querySelector('h1').textContent, /كل تغيير/); assert.equal(doc.querySelector('#guildSelect').value, guild.id); dom.window.close();
});
test('unreadable guild does not enable editing', async () => {
  const { dom, doc } = await page('builder', url => url === `/api/workspace/${guild.id}` ? { ...workspace, channels: null, roles: null, connection: { status: 'unavailable', readable: false } } : fixtureResponse(url));
  assert.equal(doc.querySelector('#newResource'), null); assert.match(doc.body.textContent, /ننتظر اكتمال الاتصال/); dom.window.close();
});
test('account offers one direct primary route per guild', async () => {
  const { dom, doc } = await page('servers', fixtureResponse, 'account.html', 'account.js');
  assert.equal(doc.querySelectorAll('.server-card .btn').length, 2); assert.match(doc.querySelector('.server-card a').href, /studio\?guild=.*#overview/); assert.doesNotMatch(doc.body.textContent, /فتح Studio/); dom.window.close();
});
test('subscription page shows four plans, annual savings and real usage', async () => {
  const { dom, doc } = await page('subscription', fixtureResponse, 'account.html', 'account.js');
  assert.equal(doc.querySelectorAll('.billing-plan').length, 4);
  assert.match(doc.body.textContent, /خطط التغييرات/);
  assert.ok(doc.body.textContent.includes((15000).toLocaleString('ar-SA')));
  doc.querySelector('[data-interval="annual"]').click();
  assert.ok(doc.body.textContent.includes((2990).toLocaleString('ar-SA')));
  assert.match(doc.body.textContent, /شهران مجانًا/);
  dom.window.close();
});
test('projects page exposes create, bind, rename, duplicate and archive actions without prompts', async () => {
  const { dom, doc } = await page('projects', fixtureResponse, 'account.html', 'account.js');
  assert.match(doc.body.textContent, /مشروع المجتمع/);
  assert.ok(doc.querySelector('#createProject'));
  assert.ok(doc.querySelector('.bind-project'));
  assert.ok(doc.querySelector('.save-project'));
  assert.ok(doc.querySelector('.duplicate-project'));
  assert.ok(doc.querySelector('.archive-project'));
  dom.window.close();
});
test('admin dashboard renders all current plan totals without a missing element crash', async () => {
  const dom = new JSDOM(fs.readFileSync(new URL('../admin-console.html', import.meta.url), 'utf8'), { url: 'https://diskoko.test/admin.html', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.alert = () => assert.fail('admin dashboard raised an alert');
  dom.window.fetch = async url => ({ ok: true, json: async () => url === '/api/me' ? { user: { isAdmin: true, username: 'owner', displayName: 'Owner' } } : url === '/api/admin/stats' ? { stats: { users: 4, active: 4, free: 1, starter: 1, growth: 1, business: 1, projects: 2, active_subscriptions: 3, revenue_month: 0, connected_servers: 2, active_bots: 2 } } : String(url).startsWith('/api/admin/users?') ? { users: [], pagination: { page: 1, pages: 1, total: 0 } } : url === '/api/admin/finance' ? { invoices: [], upgradeRequests: [] } : url === '/api/admin/coupons' ? { coupons: [] } : url === '/api/admin/reports' ? { reports: [] } : { token: 'test' } });
  dom.window.eval(fs.readFileSync(new URL('../admin-console.20260921.js', import.meta.url), 'utf8')); await settle();
  assert.match(dom.window.document.querySelector('#content').textContent, /إجمالي المستخدمين/);
  assert.match(dom.window.document.querySelector('#content').textContent, /اشتراكات نشطة/);
  assert.equal(dom.window.document.querySelectorAll('.admin-kpis .metric').length, 8);
  dom.window.close();
});
test('admin users search and pagination query the server', async () => {
  const dom = new JSDOM(fs.readFileSync(new URL('../admin-console.html', import.meta.url), 'utf8'), { url: 'https://diskoko.test/admin', runScripts: 'outside-only', pretendToBeVisual: true });
  const urls = [];
  dom.window.fetch = async url => {
    urls.push(String(url));
    const page = new URL(String(url), 'https://diskoko.test').searchParams.get('page');
    const body = String(url).startsWith('/api/admin/users?') ? { users: [{ id: page === '2' ? 2 : 1, username: page === '2' ? 'second' : 'first', plan: 'free', status: 'active', serverCount: 0, botCount: 0 }], pagination: { page: Number(page), pages: 2, total: 51 } }
      : url === '/api/me' ? { user: { isAdmin: true, username: 'owner' } }
      : url === '/api/admin/stats' ? { stats: { users: 51 } }
      : url === '/api/admin/finance' ? { invoices: [], upgradeRequests: [] }
      : url === '/api/admin/coupons' ? { coupons: [] }
      : url === '/api/admin/reports' ? { reports: [] } : { token: 'test' };
    return { ok: true, json: async () => body };
  };
  dom.window.eval(fs.readFileSync(new URL('../admin-console.20260921.js', import.meta.url), 'utf8'));
  await settle();
  dom.window.document.querySelector('[data-view="users"]').click();
  assert.match(dom.window.document.querySelector('#userTable').textContent, /first/);
  dom.window.document.querySelector('.admin-page[data-page="2"]').click();
  await settle();
  assert.match(dom.window.document.querySelector('#userTable').textContent, /second/);
  assert.ok(urls.some(url => url.includes('page=2')));
  dom.window.close();
});
