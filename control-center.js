(() => {
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const rail = $('.toolrail');
  const panel = $('#panelContent');
  if (!rail || !panel) return;

  const nav = [
    ['overview','⌂','Overview'],
    ['servers','◫','Servers'],
    ['templates','▦','Templates'],
    ['botstudio','◈','Scooco Bot']
  ];
  const existing = new Set($$('.rail-item', rail).map(x => x.dataset.panel));
  nav.forEach(([id, icon, label]) => {
    if (existing.has(id)) return;
    const button = document.createElement('button');
    button.className = 'rail-item product-rail-item';
    button.dataset.panel = id;
    button.innerHTML = `<span class="rail-icon">${icon}</span><span>${label}</span>`;
    button.addEventListener('click', () => {
      $$('.rail-item', rail).forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      render(id);
    });
    rail.insertBefore(button, $('.rail-spacer'));
  });

  function shell(eyebrow, title, description, body) {
    panel.innerHTML = `<div class="product-panel-head"><div><span class="product-eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div><span class="product-live">LIVE PREVIEW</span></div><div class="product-panel-body">${body}</div>`;
  }

  function renderOverview() {
    shell('WORKSPACE OVERVIEW','Build your Discord world','Choose a starting point, connect your server when ready, and design everything from one calm workspace.', `
      <div class="workspace-banner"><div><span class="banner-kicker">YOUR NEXT STEP</span><h2>Turn NOVA WORLD into a real community.</h2><p>Your visual preview is ready. Continue with a template, or open any section to shape the details.</p></div><button class="product-cta" data-go="templates">Browse templates <span>↗</span></button></div>
      <div class="overview-stats"><div><small>SETUP PROGRESS</small><b>42%</b><i><em style="width:42%"></em></i></div><div><small>DESIGN BLOCKS</small><b>08</b><span>ready to edit</span></div><div><small>PREVIEW STATUS</small><b class="green">LIVE</b><span>local workspace</span></div></div>
      <div class="section-label"><b>Continue building</b><span>4 steps to launch</span></div>
      <div class="build-steps"><button data-go="templates"><span>01</span><div><b>Pick a foundation</b><small>Start from a Gaming, Creator, or Study template.</small></div><strong>→</strong></button><button data-go="structure"><span>02</span><div><b>Shape the structure</b><small>Arrange categories, channels, and the member journey.</small></div><strong>→</strong></button><button data-go="botstudio"><span>03</span><div><b>Train your assistant</b><small>Build commands and a personality for Scooco Bot.</small></div><strong>→</strong></button><button data-go="security"><span>04</span><div><b>Prepare the guardrails</b><small>Design moderation rules before connecting Discord.</small></div><strong>→</strong></button></div>
      <div class="section-label"><b>Quick actions</b><span>Jump into the workspace</span></div>
      <div class="quick-actions"><button data-go="ai">✦ <b>AI World Designer</b><small>Describe your ideal community</small></button><button data-go="identity">◉ <b>Brand Kit</b><small>Colors, welcome, and identity</small></button><button data-go="analytics">⌁ <b>Community Insights</b><small>Readiness and activity overview</small></button><button data-go="servers">◫ <b>Manage servers</b><small>Plan, bots, AI, and schedules</small></button></div>`);
    bindProductActions();
  }

  function renderServers() {
    shell('SERVER HUB','Manage every server from one place','Your plan decides how many servers you can connect. Each server gets its own bots, AI workspace, automations, and usage controls.', `
      <div class="server-plan-card"><div><span class="product-eyebrow">CURRENT PLAN</span><h2>Growth <span>monthly</span></h2><p>Up to 3 connected servers, 10 active bots, and advanced community automations.</p></div><div class="plan-usage"><b>01 <small>/ 03</small></b><span>servers connected</span><i><em style="width:33%"></em></i><button class="mini upgrade-plan">Manage plan ↗</button></div></div>
      <div class="server-toolbar"><div><div class="section-label"><b>Your servers</b><span>1 connected · 1 draft</span></div><p>Choose a server to open its workspace.</p></div><button class="product-cta" data-connect="true">＋ Connect server</button></div>
      <div class="server-grid"><article class="server-card connected"><div class="server-card-top"><div class="server-mark">N</div><span class="server-status">CONNECTED</span></div><h3>NOVA WORLD</h3><p>Gaming community · 1,248 members</p><div class="server-metrics"><span><b>03</b>bots</span><span><b>12</b>automations</span><span><b>72%</b>health</span></div><div class="server-card-actions"><button class="server-open" data-server="NOVA WORLD">Open workspace ↗</button><button class="server-more">•••</button></div></article><article class="server-card draft"><div class="server-card-top"><div class="server-mark cyan-mark">C</div><span class="server-status draft-status">DRAFT</span></div><h3>CREATOR LAB</h3><p>Creator community · preview only</p><div class="server-metrics"><span><b>01</b>bot draft</span><span><b>05</b>channels</span><span><b>—</b>not linked</span></div><div class="server-card-actions"><button class="server-open" data-go="templates">Continue design ↗</button><button class="server-more">•••</button></div></article><article class="server-card add-server"><div class="add-icon">＋</div><h3>Connect another server</h3><p>Your Growth plan has 2 server slots remaining.</p><button class="mini" data-connect="true">Start connection</button></article></div>
      <div class="section-label"><b>NOVA WORLD workspace</b><span>connected services</span></div><div class="server-workspace"><div class="service-list"><button class="service-tab active" data-service="bots"><span>◈</span><div><b>Bot control</b><small>3 bots · 2 online</small></div><strong>→</strong></button><button class="service-tab" data-service="ai"><span>✦</span><div><b>AI assistant</b><small>Scooco · ready to configure</small></div><strong>→</strong></button><button class="service-tab" data-service="schedule"><span>◷</span><div><b>Automations</b><small>12 scheduled actions</small></div><strong>→</strong></button></div><div class="service-detail" id="serverServiceDetail"><span class="detail-kicker">BOT CONTROL</span><h3>Your bots are the operating layer.</h3><p>Choose what each bot can do, where it can speak, and which actions require human approval.</p><div class="service-toggles"><label><span><b>Scooco assistant</b><small>AI chat, drafts, and community help</small></span><input type="checkbox" checked><i></i></label><label><span><b>Guardian moderation</b><small>Safety suggestions and incident alerts</small></span><input type="checkbox" checked><i></i></label><label><span><b>Event host</b><small>Reminders, RSVP, and announcements</small></span><input type="checkbox"><i></i></label></div><button class="product-cta" data-go="botstudio">Configure bots in Scooco Studio ↗</button></div></div>
      <div class="section-label"><b>Scheduled actions</b><span>server timezone · Riyadh</span></div><div class="schedule-list"><div><span class="schedule-time">TODAY<br><b>20:00</b></span><div><b>Tournament reminder</b><small>Send to #announcements · Nova World</small></div><span class="schedule-badge">ACTIVE</span></div><div><span class="schedule-time">FRI<br><b>18:30</b></span><div><b>Weekly community digest</b><small>Scooco draft → human approval</small></div><span class="schedule-badge paused">PAUSED</span></div></div>`);
    $$('.server-open').forEach(button=>button.addEventListener('click',()=>toastProduct(`${button.dataset.server||'Creator Lab'} workspace opened`)));
    $$('.service-tab').forEach(button=>button.addEventListener('click',()=>{
      $$('.service-tab').forEach(x=>x.classList.remove('active'));button.classList.add('active');
      const detail=$('#serverServiceDetail'); const mode=button.dataset.service;
      const data={bots:['BOT CONTROL','Your bots are the operating layer.','Choose what each bot can do, where it can speak, and which actions require human approval.','Configure bots in Scooco Studio ↗'],ai:['AI ASSISTANT','Give Scooco a role in your community.','Set context, allowed actions, approval rules, and the channels where AI can assist.','Open AI assistant settings ↗'],schedule:['AUTOMATIONS','Make the community run on time.','Schedule announcements, reminders, digests, and AI drafts for review.','Open automation calendar ↗']}[mode];
      detail.querySelector('.detail-kicker').textContent=data[0];detail.querySelector('h3').textContent=data[1];detail.querySelector('p').textContent=data[2];detail.querySelector('.product-cta').textContent=data[3];
    }));
    $$('.upgrade-plan').forEach(button=>button.onclick=()=>toastProduct('Plan management will open after billing is connected'));
    bindProductActions();
  }

  function renderTemplates() {
    shell('FOUNDATION LIBRARY','Choose a template','Every template gives you a strong starting point. You can edit every block before you connect Discord.', `
      <div class="template-hero"><div><span class="product-eyebrow">CURATED STARTING POINTS</span><h2>Start with a world that already feels alive.</h2><p>Pick a direction, preview the structure, and customize the personality.</p></div><span class="template-count">03<br><small>templates</small></span></div>
      <div class="product-template-grid"><article class="product-template gaming"><span class="template-symbol">✦</span><div class="template-meta"><span>FOR COMPETITIVE COMMUNITIES</span><h3>Gaming Arena</h3><p>Teams, tournaments, clips, voice rooms, and a fast-moving lobby.</p></div><div class="template-tags"><i>Events</i><i>Teams</i><i>Voice</i></div><button class="product-cta apply-template" data-template="gaming">Use template <span>↗</span></button></article><article class="product-template creator"><span class="template-symbol">◒</span><div class="template-meta"><span>FOR CREATORS & STUDIOS</span><h3>Creator Studio</h3><p>Showcase work, collect feedback, and keep production conversations organized.</p></div><div class="template-tags"><i>Portfolio</i><i>Feedback</i><i>Live</i></div><button class="product-cta apply-template" data-template="creator">Use template <span>↗</span></button></article><article class="product-template study"><span class="template-symbol">✎</span><div class="template-meta"><span>FOR FOCUS & LEARNING</span><h3>Focus Space</h3><p>Quiet rooms, study goals, shared resources, and gentle accountability.</p></div><div class="template-tags"><i>Focus</i><i>Goals</i><i>Resources</i></div><button class="product-cta apply-template" data-template="study">Use template <span>↗</span></button></article></div>
      <div class="template-note"><span>✦</span><div><b>Templates are editable</b><small>Nothing is published until you review the preview and confirm the next step.</small></div></div>`);
    $$('.apply-template').forEach(button => button.addEventListener('click', () => {
      const aiButton = $('[data-panel="ai"]', rail);
      if (aiButton) { aiButton.click(); setTimeout(() => { const source = $(`[data-t="${button.dataset.template}"]`); if (source) source.click(); setTimeout(() => renderTemplates(), 80); }, 40); }
      toastProduct(`${button.dataset.template} foundation applied to the preview`);
    }));
  }

  function renderBotStudio() {
    shell('SCOOCO BOT STUDIO','Build a bot that works your way','Define a personality, choose capabilities, and test commands in a safe workspace before connecting Discord.', `
      <div class="bot-studio-layout"><div class="bot-config"><div class="bot-identity"><div class="bot-orb">S</div><div><span>BOT WORKSPACE</span><h2>Scooco Bot</h2><small>Draft • not connected</small></div><button class="mini product-edit">Edit</button></div><label class="field"><span>Bot personality</span><textarea id="scoocoPersonality" rows="3">You are a calm, helpful community assistant. Be concise, kind, and explain your actions before you take them.</textarea></label><div class="bot-capabilities"><div class="section-label"><b>Capabilities</b><span>Toggle what Scooco can suggest</span></div><label class="capability"><input type="checkbox" checked><span><b>Welcome & onboarding</b><small>Guide new members to the right channels.</small></span><i></i></label><label class="capability"><input type="checkbox" checked><span><b>Moderation suggestions</b><small>Flag patterns for human review.</small></span><i></i></label><label class="capability"><input type="checkbox" checked><span><b>Events & reminders</b><small>Create event drafts and announcement copy.</small></span><i></i></label><label class="capability"><input type="checkbox"><span><b>Community insights</b><small>Explain activity trends and next steps.</small></span><i></i></label></div><button class="product-cta wide-product" id="saveScooco">Save bot draft <span>✓</span></button></div><div class="bot-chat"><div class="chat-heading"><div><b>Scooco command room</b><small>Ask for a design, command, or community action</small></div><span class="online-badge">READY</span></div><div class="bot-messages" id="scoocoMessages"><div class="bot-message bot"><span class="bot-avatar">S</span><div><small>Scooco Bot • just now</small><p>Hi! I can help you build your community. Try asking me to create a welcome flow, draft a tournament announcement, or design a moderation rule.</p></div></div></div><div class="suggested-prompts"><button data-prompt="Create a welcome flow for new gaming members">Welcome flow</button><button data-prompt="Draft a tournament announcement">Tournament post</button><button data-prompt="Suggest safe anti-spam rules">Safety rules</button></div><form class="bot-composer" id="scoocoForm"><input id="scoocoInput" placeholder="Ask Scooco to build something..." autocomplete="off"><button>Send ↗</button></form></div></div>`);
    const messages=$('#scoocoMessages'), input=$('#scoocoInput');
    const reply=(prompt) => { const safe=prompt.toLowerCase(); let answer='I drafted a clear next step for your workspace. Review it in the preview, then adjust the details before publishing.'; if(safe.includes('welcome')) answer='I drafted a 3-step welcome flow: Rules → Choose roles → Introduce yourself. I also suggest a #start-here channel and a friendly first message.'; if(safe.includes('tournament')) answer='I drafted a tournament post with title, date, registration CTA, team rules, and a reminder schedule. It is ready to open in the Events editor.'; if(safe.includes('spam')||safe.includes('safety')) answer='I suggest three review-first rules: repeated-message detection, invite-link review, and mention-spam thresholds. No punishment is automatic in this draft.'; messages.insertAdjacentHTML('beforeend',`<div class="bot-message bot"><span class="bot-avatar">S</span><div><small>Scooco Bot • now</small><p>${answer}</p><button class="inline-action" data-go="security">Open the related editor →</button></div></div>`);messages.scrollTop=messages.scrollHeight;bindProductActions() };
    $('#scoocoForm').onsubmit=(event)=>{event.preventDefault();const value=input.value.trim();if(!value)return;messages.insertAdjacentHTML('beforeend',`<div class="bot-message user"><div><small>You • now</small><p>${value.replace(/[<>]/g,'')}</p></div></div>`);input.value='';setTimeout(()=>reply(value),220)};
    $$('.suggested-prompts').forEach(group=>$$('button',group).forEach(button=>button.onclick=()=>{input.value=button.dataset.prompt;input.focus()}));
    $('#saveScooco').onclick=()=>toastProduct('Scooco Bot draft saved locally');
  }

  function render(id) { if (id==='overview') renderOverview(); else if (id==='servers') renderServers(); else if (id==='templates') renderTemplates(); else if (id==='botstudio') renderBotStudio(); }
  function bindProductActions() {
    $$('[data-go]').forEach(button => { if (button.dataset.bound) return; button.dataset.bound='true'; button.addEventListener('click',()=>{ const target=$(`[data-panel="${button.dataset.go}"]`,rail); if(target) target.click(); }); });
    $$('[data-connect]').forEach(button=>{button.onclick=()=>$('#connectBtn')?.click()});
  }
  function toastProduct(message) { const target=$('#toast'); if(!target)return; target.textContent=message; target.classList.add('show'); setTimeout(()=>target.classList.remove('show'),2400); }
  const overviewButton=$('[data-panel="overview"]',rail); if (overviewButton) { overviewButton.classList.add('active'); renderOverview(); }
})();
