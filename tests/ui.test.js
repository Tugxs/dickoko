import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { fixtureResponse, guild, workspace } from './fixtures.js';
import { aiPromptLibrary } from '../ai-library-catalog.js';
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 5)); };
async function page(hash = 'overview', response = fixtureResponse, file = 'studio.html', script = 'workspace.js', setup = () => {}) {
  const dom = new JSDOM(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { url: `https://diskoko.test/studio?guild=${guild.id}#${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const requests = [];
  dom.window.fetch = async (url, options = {}) => { requests.push({ url, options }); const body = response(url); return { ok: !body?.error, status: body?.error ? 502 : 200, json: async () => structuredClone(body) }; };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  setup(dom.window);
  const source = fs.readFileSync(new URL(`../${script}`, import.meta.url), 'utf8');
  dom.window.eval(script === 'workspace.js' ? `const aiPromptLibrary = ${JSON.stringify(aiPromptLibrary)};\n${source.replace("import { aiPromptLibrary } from './ai-library-catalog.js';", '')}` : source); await settle();
  return { dom, requests, doc: dom.window.document };
}
test('voice recognition resumes after a browser pause and stops only when the user asks', async () => {
  const sessions = [];
  class Recognition {
    start() { sessions.push(this); this.onstart?.(); }
    stop() { this.onend?.(); }
  }
  const { dom, doc } = await page('assistant', fixtureResponse, 'studio.html', 'workspace.js', window => {
    window.SpeechRecognition = Recognition;
    Object.defineProperty(window.navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }), enumerateDevices: async () => [] } });
  });
  doc.querySelector('#aiVoice').click(); await settle();
  doc.querySelector('#aiVoiceStart').click();
  assert.equal(sessions.length, 1); assert.equal(sessions[0].continuous, true);
  sessions[0].onresult({ results: [[{ transcript: 'مرحبا' }]] });
  sessions[0].onend();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(sessions.length, 2); assert.equal(doc.querySelector('#aiRecording').hidden, false);
  sessions[1].onresult({ results: [[{ transcript: 'يا جماعة' }]] });
  assert.match(doc.querySelector('#assistantPrompt').value, /مرحبا يا جماعة/);
  doc.querySelector('#aiStopVoice').click();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(sessions.length, 2); assert.equal(doc.querySelector('#aiRecording').hidden, true);
  dom.window.close();
});
test('deep link opens the requested guild with true live data and one navigation controller', async () => {
  const { dom, doc, requests } = await page('builder');
  assert.match(doc.querySelector('h1').textContent, /مساحة مرتبة/); assert.match(doc.body.textContent, /الدردشة/);
  assert.equal(doc.querySelectorAll('.nav-link').length, 11); assert.equal(requests.filter(r => r.url === '/api/account/overview').length, 1); dom.window.close();
});
test('community alerts show actionable paused giveaways and failed schedules', async () => {
  const response = url => url === `/api/workspace/${guild.id}` ? { ...workspace, alerts: [
    { id: 'giveaway', kind: 'giveaway', title: 'توقف إعلان الجيف أوي', detail: 'الرسالة الأصلية غير متاحة', channelId: 'channel', retryable: false },
    { id: 'pending', kind: 'giveaway', title: 'تأخر إعلان الجيف أوي', detail: 'تنتظر إعادة محاولة', channelId: 'channel', stoppable: true },
    { id: '5', kind: 'schedule', title: 'توقفت رسالة مجدولة', detail: 'القناة غير متاحة', target: 'automation' },
  ] } : fixtureResponse(url);
  const { dom, doc } = await page('alerts', response);
  assert.match(doc.body.textContent, /توقف إعلان الجيف أوي/);
  assert.equal(doc.querySelectorAll('[data-alert-dismiss]').length, 2);
  assert.ok(doc.querySelector('[data-alert-pause="pending"]'));
  assert.ok(doc.querySelector('[data-alert-cancel="5"]'));
  assert.equal(doc.querySelector('[data-alert-retry]'), null, 'missing Discord messages cannot be retried');
  dom.window.close();
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
test('bot pages separate designs, live commands and AI connection state', async () => {
  const { dom, doc } = await page('bots'); assert.equal(doc.querySelectorAll('[data-create-bot]').length, 6); assert.match(doc.body.textContent, /تصميم محفوظ|تصميم قابل للتخصيص/); dom.window.close();
  const commandPage = await page('commands'); assert.equal(commandPage.doc.querySelectorAll('.command-check').length, 3); assert.equal(commandPage.doc.querySelector('#botEnabled').checked, true); commandPage.dom.window.close();
  const assistantPage = await page('assistant'); assert.match(assistantPage.doc.body.textContent, /الجهاز المحلي غير متصل/); assert.match(assistantPage.doc.body.textContent, /AI ديسكوكو/); assistantPage.dom.window.close();
});

test('change history counts applied structure and published giveaway as two completed actions', async () => {
  const response = url => url === `/api/workspace/${guild.id}` ? {
    ...workspace,
    changeSets: [{ id: 5, template_key: 'custom', status: 'succeeded', plan: { name: 'تغييرات AI ديسكوكو' }, updated_at: '2026-09-23T08:00:00Z' }],
    publications: [{ id: 'request', interactive_kind: 'giveaway', proposal: { interactive: { prize: 'اشتراك' } }, interactive_channel_id: 'channel', interactive_message_id: 'message', published_at: '2026-09-23T08:01:00Z' }],
  } : fixtureResponse(url);
  const { dom, doc } = await page('activity', response);
  assert.match(doc.body.textContent, /العمليات المنفذة · ٢/);
  assert.match(doc.body.textContent, /نُشر جيف آواي: اشتراك/);
  assert.match(doc.body.textContent, /تغييرات AI ديسكوكو/);
  dom.window.close();
});
test('community ideas are selectable for follow-up without a publish-the-list button', async () => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const response = url => {
    if (url === '/api/ai/status') return { available: true, planEnabled: true };
    if (url.startsWith('/api/ai/conversations?')) return { conversations: [{ id: conversationId, title: 'أفكار نشاط', updated_at: '2026-09-23T00:00:00Z' }] };
    if (url === `/api/ai/conversations/${conversationId}/messages`) return { messages: [{ id: '22222222-2222-4222-8222-222222222222', prompt: 'اقترح 10 أفكار لتنشيط الأعضاء', answer: '1. تحدي صورة الأسبوع\n2. استطلاع نشاط الأسبوع', status: 'completed', proposal: null, can_publish_answer: false, can_select_step: true }] };
    return fixtureResponse(url);
  };
  const { dom, doc } = await page('assistant', response);
  doc.querySelector('.ai-conversation').click(); await settle();
  assert.equal(doc.querySelectorAll('[data-ai-choice]').length, 2);
  assert.equal(doc.querySelector('[data-ai-publish-answer]'), null);
  doc.querySelector('[data-ai-choice]').click();
  assert.match(doc.querySelector('#assistantPrompt').value, /تحدي صورة الأسبوع/);
  assert.match(doc.querySelector('#assistantPrompt').value, /لا تنشر شرح الفكرة نفسه/);
  dom.window.close();
});
test('an untouched library prompt with brackets can be submitted for an editable review card', async () => {
  const response = url => url === '/api/ai/status' ? { available: true, planEnabled: true }
    : url.startsWith('/api/ai/conversations?') ? { conversations: [] }
      : url === '/api/ai/requests' ? { id: '22222222-2222-4222-8222-222222222222', conversationId: '11111111-1111-4111-8111-111111111111' }
        : fixtureResponse(url);
  const { dom, doc, requests } = await page('assistant', response);
  doc.querySelector('[data-ai-template="0"]').click();
  doc.querySelector('#assistantForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  const submitted = requests.find(entry => entry.url === '/api/ai/requests');
  assert.ok(submitted);
  const body = JSON.parse(submitted.options.body);
  assert.match(body.prompt, /\[القناة\]/);
  assert.equal(body.libraryTitle, 'جيف آواي سريع');
  assert.equal(body.libraryCategory, 'الجيف آواي');
  assert.equal(body.libraryMode, 'execute');
  dom.window.close();
});
test('AI chat exposes reviewed Discord actions, image attachment and voice transcription control', async () => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const response = url => {
    if (url === '/api/ai/status') return { available: true, planEnabled: true };
    if (url.startsWith('/api/ai/conversations?')) return { conversations: [{ id: conversationId, title: 'رسالة ترحيب', updated_at: '2026-09-22T00:00:00Z' }] };
    if (url === `/api/ai/conversations/${conversationId}/messages`) return { messages: [{ id: '22222222-2222-4222-8222-222222222222', prompt: 'أرسل ترحيبًا', answer: 'جهزت الرسالة للمراجعة.', status: 'completed', proposal: { operations: [{ resource_type: 'role', name: 'عضو جديد', action: 'create' }], message: { channel: 'الدردشة', content: 'أهلًا بالجميع!' }, interactive: { kind: 'giveaway', prize: 'اشتراك', channel: 'الدردشة', durationMinutes: 60, winnerCount: 1 } } }] };
    return fixtureResponse(url);
  };
  const { dom, doc } = await page('assistant', response);
  doc.querySelector('.ai-conversation').click(); await settle();
  assert.ok(doc.querySelector('[data-ai-delete]'));
  assert.equal(doc.querySelectorAll('.ai-library-item').length, 10);
  assert.equal(doc.querySelectorAll('.ai-library-item').length, doc.querySelectorAll('.ai-library-item span').length);
  assert.ok(doc.querySelector('#aiVoice'));
  assert.equal(doc.querySelector('[data-ai-plan]'), null);
  doc.querySelector('[data-ai-message]').click();
  assert.ok(doc.querySelector('#aiMessageImage'));
  assert.ok(doc.querySelector('#aiMessageImageStyle'));
  assert.equal(doc.querySelector('#aiMessageChannel').value, 'c2');
  assert.equal(doc.querySelector('#aiMessageSend').disabled, true);
  doc.querySelector('#aiMessageCancel').click();
  doc.querySelector('[data-ai-interactive]').click();
  assert.equal(doc.querySelector('#aiInteractiveChannel').value, 'c2');
  assert.match(doc.querySelector('.ai-discord-preview').textContent, /اشتراك/);
  assert.match(doc.querySelector('.ai-discord-server-channels').textContent, new RegExp(guild.name));
  assert.ok(doc.querySelector('.ai-discord-members'));
  doc.querySelector('#aiInteractiveImageStyle').value = 'design';
  doc.querySelector('#aiInteractiveImageStyle').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('#aiInteractiveImageDesign').hidden, false);
  doc.querySelector('#aiPrize').value = 'جائزة جديدة';
  doc.querySelector('#aiPrize').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(doc.querySelector('#aiPreviewDescription').textContent, /جائزة جديدة/);
  doc.querySelector('#aiGiveawayTitle').value = 'عنوان جديد';
  doc.querySelector('#aiGiveawayTitle').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(doc.querySelector('#aiPreviewTitle').textContent, /عنوان جديد/);
  assert.equal(doc.querySelector('#aiInteractiveLaunch').disabled, true);
  doc.querySelector('#aiInteractiveCancel').click();
  doc.querySelector('[data-ai-template="0"]').click();
  assert.match(doc.querySelector('#assistantPrompt').value, /جيف آواي/);
  assert.equal(doc.querySelector('#aiTemplateDraft').hidden, false);
  assert.match(doc.querySelector('#aiNotice').textContent, /مسودة جديدة/);
  dom.window.close();
});
test('retired staff template has no structure action in AI chat', async () => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const response = url => {
    if (url === '/api/ai/status') return { available: true, planEnabled: true };
    if (url.startsWith('/api/ai/conversations?')) return { conversations: [{ id: conversationId, title: 'فريق خاص', updated_at: '2026-09-23T00:00:00Z' }] };
    if (url === `/api/ai/conversations/${conversationId}/messages`) return { messages: [{ id: '22222222-2222-4222-8222-222222222222', prompt: 'قسم فريق خاص', answer: 'هذا القالب من نسخة قديمة وأُزيل من المكتبة.', status: 'completed', library_mode: 'execute', library_title: 'قسم فريق خاص', library_category: 'بناء السيرفر', proposal: null }] };
    return fixtureResponse(url);
  };
  const { dom, doc } = await page('assistant', response);
  doc.querySelector('.ai-conversation').click(); await settle();
  assert.equal(doc.querySelector('[data-ai-structure]'), null);
  assert.match(doc.querySelector('#aiMessages').textContent, /أُزيل من المكتبة/);
  dom.window.close();
});
test('poll, event and welcome open distinct live review cards', async () => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  for (const kind of ['poll', 'event', 'welcome']) {
    const task = aiPromptLibrary.find(item => item.kind === kind);
    const interactive = kind === 'poll' ? { kind, channel: 'general', question: 'أي صورة تفضل؟', options: ['الأولى', 'الثانية'] } : { kind, channel: 'general', title: 'بطاقة مميزة', description: 'مرحبًا {member}' };
    const response = url => {
      if (url === '/api/ai/status') return { available: true, planEnabled: true };
      if (url.startsWith('/api/ai/conversations?')) return { conversations: [{ id: conversationId, title: task.title, updated_at: '2026-09-23T00:00:00Z' }] };
      if (url === `/api/ai/conversations/${conversationId}/messages`) return { messages: [{ id: '22222222-2222-4222-8222-222222222222', prompt: task.prompt, answer: 'بطاقة مراجعة', status: 'completed', library_mode: 'execute', library_title: task.title, library_category: task.category, proposal: { interactive, draft: true } }] };
      return fixtureResponse(url);
    };
    const { dom, doc } = await page('assistant', response);
    doc.querySelector('.ai-conversation').click(); await settle();
    doc.querySelector('[data-ai-interactive]').click();
    assert.ok(doc.querySelector('#aiSpecialColor'));
    assert.ok(doc.querySelector('.ai-discord-members'));
    doc.querySelector('#aiSpecialColor').value = '#123456';
    doc.querySelector('#aiSpecialColor').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(doc.querySelector('#aiSpecialPreviewCard').style.borderColor, 'rgb(18, 52, 86)');
    if (kind === 'poll') {
      doc.querySelector('#aiAddPollOption').click();
      assert.equal(doc.querySelectorAll('[data-poll-text]').length, 3);
      assert.ok(doc.querySelector('#aiQuestionImage'));
      assert.ok(doc.querySelector('#aiQuestionImageStyle'));
    } else if (kind === 'event') {
      assert.ok(doc.querySelector('#aiEventSignup'));
      assert.ok(doc.querySelector('#aiEventButton'));
      assert.ok(doc.querySelector('#aiSpecialImageStyle'));
    } else {
      assert.match(doc.querySelector('#aiSpecialPreviewBody').textContent, /@عضو جديد/);
      assert.ok(doc.querySelector('#aiWelcomeAvatarPosition'));
      doc.querySelector('#aiWelcomeAvatarPosition').value = 'top';
      doc.querySelector('#aiWelcomeAvatarPosition').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      assert.equal(doc.querySelector('#aiSpecialPreviewCard').dataset.avatarPosition, 'top');
      dom.window.URL.createObjectURL = () => 'blob:welcome-design';
      dom.window.URL.revokeObjectURL = () => {};
      Object.defineProperty(doc.querySelector('#aiSpecialImage'), 'files', { value: [new dom.window.File(['design'], 'design.png', { type: 'image/png' })] });
      doc.querySelector('#aiWelcomeComposite').checked = true;
      doc.querySelector('#aiWelcomeComposite').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      assert.equal(doc.querySelector('#aiWelcomeAvatarPosition').value, 'center');
      assert.equal(doc.querySelector('#aiWelcomeCompositeControls').hidden, false);
      assert.ok(doc.querySelector('#aiWelcomeServerLogo'));
      assert.equal(doc.querySelector('.ai-welcome-image-composite img').getAttribute('src'), 'blob:welcome-design');
      doc.querySelector('#aiWelcomeAvatarPosition').value = 'left';
      doc.querySelector('#aiWelcomeAvatarPosition').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      assert.match(doc.querySelector('.ai-welcome-image-avatar').getAttribute('style'), /left:15\.416/);
    }
    dom.window.close();
  }
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
test('admin dashboard remains usable when one section fails to load', async () => {
  const dom = new JSDOM(fs.readFileSync(new URL('../admin-console.html', import.meta.url), 'utf8'), { url: 'https://diskoko.test/admin', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.fetch = async url => {
    if (url === '/api/admin/reports') throw new Error('temporary database failure');
    const body = url === '/api/me' ? { user: { isAdmin: true, username: 'owner' } }
      : url === '/api/admin/stats' ? { stats: { users: 2, active: 2, free: 2 } }
      : String(url).startsWith('/api/admin/users?') ? { users: [], pagination: { page: 1, pages: 1, total: 0 } }
      : url === '/api/admin/finance' ? { invoices: [], upgradeRequests: [] }
      : url === '/api/admin/coupons' ? { coupons: [] } : {};
    return { ok: true, json: async () => body };
  };
  dom.window.eval(fs.readFileSync(new URL('../admin-console.20260921.js', import.meta.url), 'utf8'));
  await settle();
  assert.match(dom.window.document.querySelector('#content').textContent, /إجمالي المستخدمين/);
  assert.match(dom.window.document.querySelector('#adminError').textContent, /تعذر تحميل بعض بيانات الإدارة/);
  dom.window.close();
});
test('admin audit view shows the actor, action and request ID', async () => {
  const dom = new JSDOM(fs.readFileSync(new URL('../admin-console.html', import.meta.url), 'utf8'), { url: 'https://diskoko.test/admin', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.fetch = async url => {
    const body = url === '/api/me' ? { user: { isAdmin: true, username: 'owner' } }
      : String(url).startsWith('/api/admin/audit?') ? { logs: [{ id: 1, actor: 'owner', action: 'admin.subscription.update', target_type: 'user', target_id: '42', details: { requestId: 'req-123' }, created_at: '2026-09-21T00:00:00Z' }], pagination: { page: 1, pages: 1, total: 1 } }
      : url === '/api/admin/stats' ? { stats: {} }
      : String(url).startsWith('/api/admin/users?') ? { users: [], pagination: { page: 1, pages: 1, total: 0 } }
      : url === '/api/admin/finance' ? { invoices: [], upgradeRequests: [] }
      : url === '/api/admin/coupons' ? { coupons: [] }
      : url === '/api/admin/reports' ? { reports: [] } : {};
    return { ok: true, json: async () => body };
  };
  dom.window.eval(fs.readFileSync(new URL('../admin-console.20260921.js', import.meta.url), 'utf8'));
  await settle();
  dom.window.document.querySelector('[data-view="audit"]').click();
  assert.match(dom.window.document.querySelector('#content').textContent, /admin.subscription.update/);
  assert.match(dom.window.document.querySelector('#content').textContent, /req-123/);
  dom.window.close();
});

