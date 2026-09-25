import { randomUUID } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord.js';
import sharp from 'sharp';
import { connectedBotMetadata } from './ai-bot-connections.js';
import { problem } from './workspace-domain.js';
import { READY_TEMPLATES, normalizeReadyDefinition, readyTemplateDiff } from './ready-templates.js';

export async function migrateReadyTemplates(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ready_template_runs (
    id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL, template_key TEXT NOT NULL, mode TEXT NOT NULL,
    definition JSONB NOT NULL, review JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS ready_template_steps (
    run_id UUID NOT NULL REFERENCES ready_template_runs(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', resource_id TEXT, error TEXT, ordinal INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(run_id,step_key)
  );
  ALTER TABLE ready_template_steps ADD COLUMN IF NOT EXISTS ordinal INT NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS ready_template_runs_guild ON ready_template_runs(user_id,guild_id,created_at DESC);`);
  await pool.query('ALTER TABLE diskoko_welcome_cards ADD COLUMN IF NOT EXISTS publishing_bot_id TEXT');
}

const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
const desired = definition => [
  ...definition.roles.map(role => ({ key: `role:${role.key}`, kind: 'role', name: role.name, role })),
  ...definition.categories.flatMap(category => [
    { key: `category:${category.key}`, kind: 'category', name: category.name, category },
    ...category.channels.map(channel => ({ key: `channel:${channel.key}`, kind: 'channel', name: channel.name, channel, parentKey: category.key })),
  ]),
  ...(['welcome', 'ticket', 'logs'].filter(kind => definition.features[kind]?.enabled).map(kind => ({ key: `feature:${kind}`, kind: `feature-${kind}`, name: { welcome: 'بطاقة الترحيب', ticket: 'لوحة الدعم', logs: 'سجل أوامر البوت' }[kind] }))),
];
const stagingName = (runId, item) => `dk-${runId.slice(0, 8)}-${item.key.replace(':', '-')}`.slice(0, 90);
const fingerprint = snapshot => JSON.stringify({ guildName: snapshot.guild?.name, channels: snapshot.channels.map(row => [row.id, row.name, row.type, row.parent_id, row.position, row.permission_overwrites, row.topic]).sort((a,b) => a[0].localeCompare(b[0])), roles: snapshot.roles.map(row => [row.id, row.name, row.position, row.permissions, row.color, row.managed]).sort((a,b) => a[0].localeCompare(b[0])) });
const everyoneOverwrite = (guildId, access, roleIds = []) => access === 'public' ? [] : access === 'read_only'
  ? [{ id: guildId, type: 0, allow: '0', deny: String(P.SendMessages) }]
  : [{ id: guildId, type: 0, allow: '0', deny: String(P.ViewChannel) }, ...[...new Set(roleIds)].map(id => ({ id, type: 0, allow: String(P.ViewChannel | P.ReadMessageHistory | P.SendMessages | P.Connect), deny: '0' }))];

export function mountReadyTemplates(app, { pool, requireUser, requireWriteAccess, authorizedGuild, discordBotFetch: discord, audit, requirePlanCapacity, botStatus }) {
  async function authorized(req) {
    const guild = await authorizedGuild(req.user, req.params.guildId);
    if (!guild) throw problem('لا تملك صلاحية إدارة هذا السيرفر.', 403);
    return guild;
  }
  async function snapshot(guildId) {
    const [channels, roles, guild] = await Promise.all([discord(`/guilds/${guildId}/channels`), discord(`/guilds/${guildId}/roles`), discord(`/guilds/${guildId}`)]);
    if (!channels.ok || !roles.ok || !guild.ok) throw problem('تعذرت قراءة السيرفر من Discord. تحقق من اتصال البوت وصلاحياته.', 502);
    return { guildId, channels: channels.data, roles: roles.data, guild: guild.data };
  }
  const getRun = async (req, guildId) => {
    const run = (await pool.query('SELECT * FROM ready_template_runs WHERE id=$1 AND user_id=$2 AND guild_id=$3', [req.params.id, req.user.id, guildId])).rows[0];
    if (!run) throw problem('مراجعة القالب غير موجودة.', 404);
    return run;
  };
  async function runState(run) {
    const steps = (await pool.query(`SELECT step_key,kind,name,status,resource_id,error,updated_at FROM ready_template_steps WHERE run_id=$1
      ORDER BY CASE kind WHEN 'role' THEN 0 WHEN 'category' THEN 1 WHEN 'channel' THEN 2 WHEN 'feature-welcome' THEN 3 WHEN 'feature-ticket' THEN 4 WHEN 'feature-logs' THEN 5 WHEN 'cleanup' THEN 6 WHEN 'delete-channel' THEN 7 WHEN 'delete-role' THEN 8 ELSE 9 END,ordinal`, [run.id])).rows;
    const { definition: _definition, ...publicRun } = run;
    return { run: publicRun, steps };
  }
  app.get('/api/ready-templates', requireUser, (_req, res) => res.json({ templates: READY_TEMPLATES }));
  app.get('/api/workspace/:guildId/ready-templates/runs', requireUser, route(async (req, res) => {
    await authorized(req);
    const runs = (await pool.query("SELECT id,template_key,definition->>'name' AS name,mode,status,error,created_at,updated_at FROM ready_template_runs WHERE user_id=$1 AND guild_id=$2 ORDER BY created_at DESC LIMIT 20", [req.user.id, req.params.guildId])).rows;
    res.json({ runs });
  }));
  app.post('/api/workspace/:guildId/ready-templates/review', requireUser, requireWriteAccess, route(async (req, res) => {
    const guild = await authorized(req);
    const template = READY_TEMPLATES.find(item => item.key === req.body.templateKey);
    if (!template) throw problem('القالب المختار غير موجود.');
    const definition = normalizeReadyDefinition(req.body.definition || template.definition);
    if (definition.features.welcome.enabled && definition.features.welcome.banner) {
      try {
        const metadata = await sharp(Buffer.from(definition.features.welcome.banner.base64, 'base64'), { limitInputPixels: 20_000_000 }).metadata();
        if (!metadata.width || !metadata.height || metadata.width < 64 || metadata.height < 64 || metadata.width > 8000 || metadata.height > 8000) throw Error('dimensions');
      } catch { throw problem('ملف صورة الترحيب تالف أو أبعاده غير مناسبة. اختر صورة أخرى قبل المراجعة.'); }
    }
    const mode = req.body.mode === 'replace' ? 'replace' : req.body.mode === 'add' ? 'add' : null;
    if (!mode) throw problem('اختر التنصيب أو الاستبدال.');
    const current = await snapshot(guild.id);
    const diff = readyTemplateDiff(definition, current, mode);
    // Discord limits are checked locally before the first write.
    const newChannelCount = mode === 'replace' ? definition.categories.length + definition.categories.reduce((n, group) => n + group.channels.length, 0) : diff.createOrReuse.filter(item => item.kind !== 'role' && item.action === 'create').length;
    const newRoleCount = mode === 'replace' ? definition.roles.length : diff.createOrReuse.filter(item => item.kind === 'role' && item.action === 'create').length;
    if (current.channels.length + newChannelCount > 500) throw problem('بناء القالب قبل حذف القديم قد يتجاوز حد قنوات Discord. احذف بعض القنوات يدويًا أولًا.', 409);
    if (current.roles.length + newRoleCount > 250) throw problem('بناء القالب قبل حذف القديم قد يتجاوز حد رتب Discord. احذف بعض الرتب يدويًا أولًا.', 409);
    const protectedIds = new Set([current.guild.system_channel_id, current.guild.rules_channel_id, current.guild.public_updates_channel_id, current.guild.afk_channel_id].filter(Boolean));
    const protectedChannels = diff.deletions.channels.filter(row => protectedIds.has(row.id));
    diff.deletions.channels = diff.deletions.channels.filter(row => !protectedIds.has(row.id));
    diff.protectedChannels = protectedChannels;
    const bot = await discord('/users/@me');
    const botRole = bot.ok ? current.roles.find(row => row.tags?.bot_id === bot.data.id) : null;
    const unsafeRoles = diff.deletions.roles.filter(row => !botRole || row.position >= botRole.position);
    diff.deletions.roles = diff.deletions.roles.filter(row => botRole && row.position < botRole.position);
    diff.protectedRoles = unsafeRoles;
    if (mode === 'replace' && diff.deletions.channels.length) {
      const ids = diff.deletions.channels.map(row => row.id);
      const [schedules, giveaways, panels] = await Promise.all([
        pool.query("SELECT COUNT(*)::int AS count FROM scheduled_messages WHERE guild_id=$1 AND channel_id=ANY($2::text[]) AND status IN ('scheduled','sending')", [guild.id, ids]),
        pool.query("SELECT COUNT(*)::int AS count FROM diskoko_giveaways WHERE guild_id=$1 AND channel_id=ANY($2::text[]) AND status='active'", [guild.id, ids]),
        pool.query('SELECT COUNT(*)::int AS count FROM diskoko_ticket_panels WHERE guild_id=$1 AND channel_id=ANY($2::text[])', [guild.id, ids]),
      ]);
      diff.affectedTasks = { schedules: schedules.rows[0].count, giveaways: giveaways.rows[0].count, ticketPanels: panels.rows[0].count };
    } else diff.affectedTasks = { schedules: 0, giveaways: 0, ticketPanels: 0 };
    const id = randomUUID();
    const review = { ...diff, fingerprint: fingerprint(current), guildName: current.guild.name, counts: { channels: current.channels.length, roles: current.roles.length } };
    const structure = desired(definition);
    const steps = [...structure, ...(mode === 'replace' ? [{ key: 'cleanup', kind: 'cleanup', name: 'إيقاف مهام القنوات القديمة' }] : []), ...diff.deletions.channels.filter(row => row.type !== 4).map(row => ({ key: `delete-channel:${row.id}`, kind: 'delete-channel', name: row.name, resourceId: row.id })), ...diff.deletions.channels.filter(row => row.type === 4).map(row => ({ key: `delete-channel:${row.id}`, kind: 'delete-channel', name: row.name, resourceId: row.id })), ...diff.deletions.roles.map(row => ({ key: `delete-role:${row.id}`, kind: 'delete-role', name: row.name, resourceId: row.id })), ...(mode === 'replace' ? [...structure.filter(item => ['role', 'category', 'channel'].includes(item.kind)).map(item => ({ key: `finalize:${item.key}`, kind: 'finalize', name: item.name })), { key: 'order', kind: 'order', name: 'ترتيب القنوات والرتب' }] : [])];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requirePlanCapacity(req.user, 'changeSetsPerMonth', client);
      await client.query('INSERT INTO ready_template_runs(id,user_id,guild_id,template_key,mode,definition,review) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, req.user.id, guild.id, template.key, mode, definition, review]);
      for (const [index, step] of steps.entries()) await client.query('INSERT INTO ready_template_steps(run_id,step_key,kind,name,resource_id,ordinal) VALUES($1,$2,$3,$4,$5,$6)', [id, step.key, step.kind, step.name, step.resourceId || null, index]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(req.user.id, 'ready_template.review', 'guild', guild.id, { run_id: id, mode, template_key: template.key });
    res.status(201).json(await runState({ id, guild_id: guild.id, definition, review, mode, status: 'draft' }));
  }));
  app.get('/api/workspace/:guildId/ready-templates/runs/:id', requireUser, route(async (req, res) => {
    const guild = await authorized(req); const run = await getRun(req, guild.id); res.json(await runState(run));
  }));
  app.post('/api/workspace/:guildId/ready-templates/runs/:id/apply', requireUser, requireWriteAccess, route(async (req, res) => {
    const guild = await authorized(req);
    const lock = await pool.connect(); let acquired = false;
    try {
      acquired = (await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`diskoko:${guild.id}`])).rows[0].locked;
      if (!acquired) throw problem('هناك عملية أخرى تعمل على هذا السيرفر. حاول بعد اكتمالها.', 409);
      const run = await getRun(req, guild.id);
      if (run.status === 'succeeded') return res.json(await runState(run));
      if (req.body.confirmed !== true || req.body.guildName !== run.review.guildName || req.body.mode !== run.mode) throw problem('راجع اسم السيرفر ونوع التنفيذ وأكد التغييرات أولًا.');
      const current = await snapshot(guild.id);
      if (run.status === 'draft' && fingerprint(current) !== run.review.fingerprint) throw problem('تغيّر السيرفر منذ إعداد المعاينة. أنشئ مراجعة جديدة قبل التطبيق.', 409);
      const selected = await connectedBotMetadata(pool, guild.id);
      const runtime = selected || botStatus();
      if (run.definition.features.welcome.enabled && (!runtime.online || !(runtime.memberJoins ?? runtime.member_joins))) throw problem('الترحيب التلقائي يحتاج بوتًا متصلًا مع تفعيل Server Members Intent. راجع الربط قبل التنفيذ.', 409);
      if (run.definition.features.ticket.enabled && !runtime.online) throw problem('لوحة التذاكر تحتاج بوتًا متصلًا قبل النشر.', 409);
      const all = (await pool.query(`SELECT * FROM ready_template_steps WHERE run_id=$1
        ORDER BY CASE kind WHEN 'role' THEN 0 WHEN 'category' THEN 1 WHEN 'channel' THEN 2 WHEN 'feature-welcome' THEN 3 WHEN 'feature-ticket' THEN 4 WHEN 'feature-logs' THEN 5 WHEN 'cleanup' THEN 6 WHEN 'delete-channel' THEN 7 WHEN 'delete-role' THEN 8 ELSE 9 END,ordinal`, [run.id])).rows;
      const pending = all.filter(step => step.status !== 'succeeded');
      if (!pending.length) { await pool.query("UPDATE ready_template_runs SET status='succeeded',error=NULL,updated_at=NOW() WHERE id=$1", [run.id]); return res.json(await runState({ ...run, status: 'succeeded' })); }
      const map = new Map(all.filter(step => step.status === 'succeeded' && step.resource_id).map(step => [step.step_key, step.resource_id]));
      const bot = await discord('/users/@me');
      if (!bot.ok || !bot.data?.id) throw problem('تعذر التحقق من هوية البوت المختار.', 502);
      const member = await discord(`/guilds/${guild.id}/members/${bot.data.id}`);
      if (!member.ok) throw problem('تعذر التحقق من صلاحيات البوت داخل السيرفر. أعد ربطه ثم حاول.', 409);
      const memberRoles = new Set(member.data.roles || []);
      const effective = current.roles.filter(role => role.id === guild.id || memberRoles.has(role.id)).reduce((bits, role) => bits | BigInt(role.permissions || '0'), 0n);
      const required = P.ManageChannels | P.ManageRoles | (run.definition.features.ticket.enabled ? P.ViewChannel | P.SendMessages | P.EmbedLinks | P.ReadMessageHistory : 0n);
      if (!(effective & P.Administrator) && (effective & required) !== required) throw problem('البوت يحتاج إدارة القنوات والرتب، ومع لوحة الدعم يحتاج إرسال الرسائل والروابط المضمنة. عدّل صلاحياته قبل التنفيذ.', 409);
      const granted = run.definition.roles.reduce((bits, role) => bits | BigInt(role.permissions), 0n);
      if (!(effective & P.Administrator) && (granted & ~effective) !== 0n) throw problem('بعض صلاحيات الرتب في القالب أعلى من صلاحيات البوت. عدّل نوع الرتب أو صلاحيات البوت أولًا.', 409);
      const botRole = bot.ok ? current.roles.find(role => role.tags?.bot_id === bot.data.id) : null;
      if (run.mode === 'replace' && run.review.deletions.roles.length && !botRole) throw problem('تعذر التحقق من موضع رتبة البوت. لن نحذف أي رتبة.', 409);
      if (run.status === 'draft') {
        await lock.query('BEGIN');
        try {
          await requirePlanCapacity(req.user, 'changeSetsPerMonth', lock);
          await lock.query("UPDATE ready_template_runs SET status='running',error=NULL,updated_at=NOW() WHERE id=$1", [run.id]);
          await lock.query('COMMIT');
        } catch (error) { await lock.query('ROLLBACK'); throw error; }
      } else await pool.query("UPDATE ready_template_runs SET status='running',error=NULL,updated_at=NOW() WHERE id=$1", [run.id]);
      const byKey = new Map(desired(run.definition).map(item => [item.key, item]));
      // A bounded batch keeps the HTTP request short and lets the UI show each stage.
      for (const step of pending.slice(0, 4)) {
        try {
          let resourceId = step.resource_id;
          const item = byKey.get(step.step_key);
          if (step.kind === 'role') {
            const role = item.role;
            const name = run.mode === 'replace' ? stagingName(run.id, item) : role.name;
            const existing = current.roles.find(row => row.name === name && !row.managed && row.id !== guild.id);
            if (existing) resourceId = existing.id;
            else {
              const result = await discord(`/guilds/${guild.id}/roles`, { method: 'POST', body: JSON.stringify({ name, color: role.color, permissions: role.permissions, mentionable: false }) });
              if (!result.ok || !result.data?.id) throw problem(`تعذر إنشاء رتبة «${role.name}» (Discord ${result.status}).`, 409);
              current.roles.push(result.data); resourceId = result.data.id;
            }
          } else if (step.kind === 'category') {
            const name = run.mode === 'replace' ? stagingName(run.id, item) : item.name;
            const existing = current.channels.find(row => row.type === 4 && row.name === name);
            if (existing) resourceId = existing.id;
            else {
              const result = await discord(`/guilds/${guild.id}/channels`, { method: 'POST', body: JSON.stringify({ name, type: 4 }) });
              if (!result.ok || !result.data?.id) throw problem(`تعذر إنشاء تصنيف «${item.name}» (Discord ${result.status}).`, 409);
              current.channels.push(result.data); resourceId = result.data.id;
            }
          } else if (step.kind === 'channel') {
            const channel = item.channel, parentId = map.get(`category:${item.parentKey}`);
            if (!parentId) throw problem('تصنيف القناة لم يكتمل بعد. حاول المتابعة.', 409);
            const name = run.mode === 'replace' ? stagingName(run.id, item) : channel.name;
            const existing = current.channels.find(row => row.name === name && row.type === channel.type && row.parent_id === parentId);
            if (existing) resourceId = existing.id;
            else {
              const roleId = channel.roleKey ? map.get(`role:${channel.roleKey}`) : null;
              if (channel.access === 'private' && !roleId) throw problem('رتبة القناة الخاصة لم تجهز بعد.', 409);
              const privileged = run.definition.roles.filter(role => role.preset === 'moderator').map(role => map.get(`role:${role.key}`)).filter(Boolean);
              const body = { name, type: channel.type, parent_id: parentId, permission_overwrites: everyoneOverwrite(guild.id, channel.access, [roleId, ...privileged].filter(Boolean)) };
              if (channel.type === 0 && channel.topic) body.topic = channel.topic;
              const result = await discord(`/guilds/${guild.id}/channels`, { method: 'POST', body: JSON.stringify(body) });
              if (!result.ok || !result.data?.id) throw problem(`تعذر إنشاء قناة «${channel.name}» (Discord ${result.status}).`, 409);
              current.channels.push(result.data); resourceId = result.data.id;
            }
          } else if (step.kind === 'feature-welcome') {
            const feature = run.definition.features.welcome;
            resourceId = map.get(`channel:${feature.channelKey}`);
            if (!resourceId) throw problem('قناة الترحيب غير جاهزة.', 409);
            await pool.query(`INSERT INTO diskoko_welcome_cards(guild_id,request_id,channel_id,title,description,color,banner,avatar_position,banner_position,publishing_bot_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
              ON CONFLICT(guild_id) DO UPDATE SET request_id=EXCLUDED.request_id,channel_id=EXCLUDED.channel_id,title=EXCLUDED.title,description=EXCLUDED.description,color=EXCLUDED.color,banner=EXCLUDED.banner,avatar_position=EXCLUDED.avatar_position,banner_position=EXCLUDED.banner_position,publishing_bot_id=EXCLUDED.publishing_bot_id,updated_at=NOW()`, [guild.id, run.id, resourceId, feature.title, feature.description, parseInt(feature.color.slice(1), 16), feature.banner || null, feature.avatarPosition, feature.bannerPosition, bot.data.id]);
          } else if (step.kind === 'feature-ticket') {
            const feature = run.definition.features.ticket;
            resourceId = map.get(`channel:${feature.channelKey}`);
            if (!resourceId) throw problem('قناة الدعم غير جاهزة.', 409);
            const panelId = randomUUID();
            await pool.query('INSERT INTO diskoko_ticket_panels(id,request_id,guild_id,channel_id,message_id,title,description,category_id,staff_role_id) VALUES($1,$2,$3,$4,NULL,$5,$6,NULL,$7) ON CONFLICT(request_id) DO NOTHING', [panelId, run.id, guild.id, resourceId, feature.title, feature.description, map.get(`role:${feature.staffRoleKey}`) || null]);
            const panel = (await pool.query('SELECT id,message_id FROM diskoko_ticket_panels WHERE request_id=$1', [run.id])).rows[0];
            if (!panel.message_id) {
              const recent = await discord(`/channels/${resourceId}/messages?limit=100`);
              if (!recent.ok || !Array.isArray(recent.data)) throw problem('تعذر فحص رسائل قناة الدعم قبل النشر. تحقق من صلاحية قراءة سجل الرسائل.', 409);
              const prior = recent.data.find(message => message.author?.id === bot.data.id && message.components?.some(row => row.components?.some(component => component.custom_id === `diskoko:ticket:${panel.id}`)));
              if (prior) await pool.query('UPDATE diskoko_ticket_panels SET message_id=$1 WHERE id=$2', [prior.id, panel.id]);
              else {
                const result = await discord(`/channels/${resourceId}/messages`, { method: 'POST', body: JSON.stringify({ embeds: [{ title: feature.title, description: feature.description, color: 0x8d72e8 }], components: [{ type: 1, components: [{ type: 2, style: 1, label: 'فتح تذكرة دعم', custom_id: `diskoko:ticket:${panel.id}` }] }], allowed_mentions: { parse: [] } }) });
                if (!result.ok || !result.data?.id) throw problem(`تعذر نشر لوحة الدعم (Discord ${result.status}).`, 409);
                await pool.query('UPDATE diskoko_ticket_panels SET message_id=$1 WHERE id=$2', [result.data.id, panel.id]);
              }
            }
          } else if (step.kind === 'feature-logs') {
            resourceId = map.get(`channel:${run.definition.features.logs.channelKey}`);
            if (!resourceId) throw problem('قناة السجل غير جاهزة.', 409);
            await pool.query(`INSERT INTO bot_guild_settings(guild_id,log_channel_id) VALUES($1,$2)
              ON CONFLICT(guild_id) DO UPDATE SET log_channel_id=EXCLUDED.log_channel_id,updated_at=NOW()`, [guild.id, resourceId]);
          } else if (step.kind === 'cleanup') {
            const oldIds = run.review.deletions.channels.map(row => row.id);
            const sending = (await pool.query("SELECT COUNT(*)::int AS count FROM scheduled_messages WHERE guild_id=$1 AND channel_id=ANY($2::text[]) AND status='sending'", [guild.id, oldIds])).rows[0].count;
            if (sending) throw problem('هناك رسالة تُرسل الآن في إحدى القنوات القديمة. انتظر اكتمالها ثم تابع الاستبدال.', 409);
            await pool.query("UPDATE scheduled_messages SET status='cancelled',updated_at=NOW() WHERE guild_id=$1 AND channel_id=ANY($2::text[]) AND status='scheduled'", [guild.id, oldIds]);
            await pool.query("UPDATE diskoko_giveaways SET status='paused',next_retry_at=NULL,last_error='أوقفه استبدال قالب السيرفر' WHERE guild_id=$1 AND channel_id=ANY($2::text[]) AND status='active'", [guild.id, oldIds]);
            await pool.query('DELETE FROM diskoko_ticket_panels WHERE guild_id=$1 AND channel_id=ANY($2::text[])', [guild.id, oldIds]);
            if (!run.definition.features.welcome.enabled) await pool.query('DELETE FROM diskoko_welcome_cards WHERE guild_id=$1 AND channel_id=ANY($2::text[])', [guild.id, oldIds]);
            if (!run.definition.features.logs.enabled) await pool.query('UPDATE bot_guild_settings SET log_channel_id=NULL,updated_at=NOW() WHERE guild_id=$1 AND log_channel_id=ANY($2::text[])', [guild.id, oldIds]);
          } else if (step.kind === 'delete-channel') {
            const target = current.channels.find(row => row.id === resourceId);
            if (target) {
              const result = await discord(`/channels/${resourceId}`, { method: 'DELETE' });
              if (!result.ok && result.status !== 404) throw problem(`تعذر حذف القناة القديمة «${step.name}» (Discord ${result.status}).`, 409);
              current.channels = current.channels.filter(row => row.id !== resourceId);
            }
          } else if (step.kind === 'delete-role') {
            const target = current.roles.find(row => row.id === resourceId);
            if (target) {
              if (!botRole || target.managed || target.id === guild.id || target.position >= botRole.position) throw problem(`لن نحذف رتبة «${step.name}» لأنها محمية أو أعلى من رتبة البوت.`, 409);
              const result = await discord(`/guilds/${guild.id}/roles/${resourceId}`, { method: 'DELETE' });
              if (!result.ok && result.status !== 404) throw problem(`تعذر حذف الرتبة القديمة «${step.name}» (Discord ${result.status}).`, 409);
              current.roles = current.roles.filter(row => row.id !== resourceId);
            }
          } else if (step.kind === 'finalize') {
            const originalKey = step.step_key.slice('finalize:'.length);
            const original = byKey.get(originalKey);
            resourceId = map.get(originalKey);
            if (!original || !resourceId) throw problem('تعذر العثور على العنصر الجديد لإنهاء اسمه.', 409);
            const target = original.kind === 'role' ? current.roles.find(row => row.id === resourceId) : current.channels.find(row => row.id === resourceId);
            if (!target) throw problem('العنصر الجديد لم يعد موجودًا. أعد المراجعة.', 409);
            if (target.name !== original.name) {
              const endpoint = original.kind === 'role' ? `/guilds/${guild.id}/roles/${resourceId}` : `/channels/${resourceId}`;
              const result = await discord(endpoint, { method: 'PATCH', body: JSON.stringify({ name: original.name }) });
              if (!result.ok) throw problem(`تعذر إنهاء اسم «${original.name}» (Discord ${result.status}).`, 409);
              target.name = original.name;
            }
          } else if (step.kind === 'order') {
            const positions = run.definition.categories.flatMap((category, groupIndex) => [
              { id: map.get(`category:${category.key}`), position: groupIndex },
              ...category.channels.map((channel, channelIndex) => ({ id: map.get(`channel:${channel.key}`), position: channelIndex, parent_id: map.get(`category:${category.key}`) })),
            ]);
            if (positions.some(item => !item.id)) throw problem('بعض القنوات غير مكتملة؛ تعذر ترتيبها.', 409);
            const channelResult = await discord(`/guilds/${guild.id}/channels`, { method: 'PATCH', body: JSON.stringify(positions) });
            if (!channelResult.ok) throw problem(`تعذر ترتيب القنوات (Discord ${channelResult.status}).`, 409);
            const rolePositions = run.definition.roles.map((role, index) => ({ id: map.get(`role:${role.key}`), position: run.definition.roles.length - index }));
            if (rolePositions.some(item => !item.id)) throw problem('بعض الرتب غير مكتملة؛ تعذر ترتيبها.', 409);
            if (rolePositions.length) {
              const roleResult = await discord(`/guilds/${guild.id}/roles`, { method: 'PATCH', body: JSON.stringify(rolePositions) });
              if (!roleResult.ok) throw problem(`ترتبت القنوات لكن تعذر ترتيب الرتب (Discord ${roleResult.status}).`, 409);
            }
          }
          await pool.query("UPDATE ready_template_steps SET status='succeeded',resource_id=$3,error=NULL,updated_at=NOW() WHERE run_id=$1 AND step_key=$2", [run.id, step.step_key, resourceId]);
          if (resourceId) map.set(step.step_key, resourceId);
        } catch (error) {
          await pool.query("UPDATE ready_template_steps SET status='failed',error=$3,updated_at=NOW() WHERE run_id=$1 AND step_key=$2", [run.id, step.step_key, error.message]);
          await pool.query("UPDATE ready_template_runs SET status='failed',error=$2,updated_at=NOW() WHERE id=$1", [run.id, error.message]);
          await audit(req.user.id, 'ready_template.failed', 'guild', guild.id, { run_id: run.id, step: step.step_key, error: error.message });
          return res.status(409).json({ ...(await runState({ ...run, status: 'failed', error: error.message })), error: error.message });
        }
      }
      const remaining = (await pool.query("SELECT COUNT(*)::int AS count FROM ready_template_steps WHERE run_id=$1 AND status<>'succeeded'", [run.id])).rows[0].count;
      if (!remaining) { await pool.query("UPDATE ready_template_runs SET status='succeeded',updated_at=NOW() WHERE id=$1", [run.id]); await audit(req.user.id, 'ready_template.apply', 'guild', guild.id, { run_id: run.id, mode: run.mode }); }
      res.json(await runState({ ...run, status: remaining ? 'running' : 'succeeded' }));
    } finally { if (acquired) await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [`diskoko:${guild.id}`]); lock.release(); }
  }));
}
