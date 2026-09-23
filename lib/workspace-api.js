import { problem, normalizeOperations, operationBody, resolveExisting, checkExistingAccess, checkConflict, connectionState, normalizeSchedule } from './workspace-domain.js';
import { alignAiProposalWithIntent, planningRequest } from './ai-intent.js';

export async function migrateWorkspace(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_preferences (
      guild_id TEXT PRIMARY KEY, analytics_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      analytics_started_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS community_activity (
      guild_id TEXT NOT NULL, day DATE NOT NULL DEFAULT CURRENT_DATE,
      user_id TEXT NOT NULL, channel_id TEXT NOT NULL, display_name TEXT NOT NULL,
      messages INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild_id,day,user_id,channel_id)
    );
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
      guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, content TEXT NOT NULL,
      run_at TIMESTAMPTZ NOT NULL, repeat TEXT NOT NULL DEFAULT 'once', timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'scheduled', last_error TEXT, message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS scheduled_messages_due ON scheduled_messages(status,run_at);
    CREATE INDEX IF NOT EXISTS community_activity_guild_day ON community_activity(guild_id,day);
  `);
}

export function mountWorkspace(app, deps) {
  const { pool, requireUser, requireWriteAccess, authorizedGuild, discordBotFetch: discord, audit, requirePlanCapacity, entitlementsFor, templates, makeTemplatePlan, botStatus } = deps;
  const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  async function guildFor(req) {
    const guild = await authorizedGuild(req.user, req.params.guildId || req.body.guildId);
    if (!guild) throw problem('لا تملك صلاحية إدارة هذا السيرفر. اختر سيرفرًا آخر أو أعد ربط حساب Discord.', 403);
    return guild;
  }
  async function snapshot(guildId) {
    const [channels, roles] = await Promise.all([discord(`/guilds/${guildId}/channels`), discord(`/guilds/${guildId}/roles`)]);
    if (!channels.ok || !roles.ok) throw problem('تعذر قراءة القنوات والرتب. تحقق من اتصال البوت وصلاحياته ثم أعد المحاولة.', 502);
    return { guildId, channels: channels.data, roles: roles.data };
  }
  app.get('/api/workspace/:guildId', requireUser, route(async (req, res) => {
    const guild = await guildFor(req);
    const [remote, channels, roles, changes, events, preferences, draft, publications] = await Promise.all([
      discord(`/guilds/${guild.id}?with_counts=true`), discord(`/guilds/${guild.id}/channels`), discord(`/guilds/${guild.id}/roles`),
      pool.query('SELECT id,template_key,status,plan,created_at,updated_at FROM change_sets WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 50', [req.user.id, guild.id]),
      pool.query("SELECT action,details,created_at FROM audit_logs WHERE actor_user_id=$1 AND ((target_type='guild' AND target_id=$2) OR details->>'guild_id'=$2) ORDER BY created_at DESC LIMIT 50", [req.user.id, guild.id]),
      pool.query('SELECT * FROM workspace_preferences WHERE guild_id=$1', [guild.id]),
      pool.query('SELECT id,name,design,updated_at FROM projects WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 1', [req.user.id, guild.id]),
      pool.query('SELECT id,proposal,interactive_kind,interactive_channel_id,interactive_message_id,sent_channel_id,sent_message_id,COALESCE(published_at,completed_at,created_at) AS published_at FROM ai_requests WHERE user_id=$1 AND guild_id=$2 AND (interactive_message_id IS NOT NULL OR sent_message_id IS NOT NULL) ORDER BY COALESCE(published_at,completed_at,created_at) DESC LIMIT 50', [req.user.id, guild.id]),
    ]);
    const status = connectionState(remote);
    // A transient upstream error must never be stored as an uninstalled bot.
    if (status !== 'unavailable') await pool.query("INSERT INTO guild_connections(user_id,guild_id,guild_name,install_status,last_verified_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT(user_id,guild_id) DO UPDATE SET guild_name=EXCLUDED.guild_name,install_status=EXCLUDED.install_status,last_verified_at=NOW(),last_error=NULL,updated_at=NOW()", [req.user.id, guild.id, remote.data?.name || guild.name, status]);
    const readable = channels.ok && roles.ok;
    res.json({ guild: { ...guild, name: remote.ok ? remote.data.name : guild.name }, connection: { status, checked_at: new Date().toISOString(), readable },
      bot: botStatus(), channels: channels.ok ? channels.data : null, roles: roles.ok ? roles.data : null,
      members: remote.ok ? (remote.data.approximate_member_count ?? null) : null,
      onlineMembers: remote.ok ? (remote.data.approximate_presence_count ?? null) : null,
      changeSets: changes.rows, publications: publications.rows, activity: events.rows, draft: draft.rows[0] || null,
      preferences: preferences.rows[0] || { analytics_enabled: false, analytics_started_at: null },
    });
  }));
  app.get('/api/workspace-templates', requireUser, (_req, res) => res.json({ templates: Object.entries(templates).map(([key, template]) => ({ key, ...template, operations: makeTemplatePlan(key).operations })) }));

  app.post('/api/change-sets', requireUser, requireWriteAccess, route(async (req, res) => {
    const guild = await guildFor(req);
    const current = await snapshot(guild.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let plan;
      const aiRequestId = String(req.body.aiRequestId || '');
      if (aiRequestId) {
        const aiRequest = (await client.query("SELECT id,guild_id,prompt,library_mode,proposal,change_set_id FROM ai_requests WHERE id=$1 AND user_id=$2 AND status='completed' FOR UPDATE", [aiRequestId, req.user.id])).rows[0];
        if (!aiRequest || aiRequest.guild_id !== guild.id || !Array.isArray(aiRequest.proposal?.operations) || !aiRequest.proposal.operations.length) throw problem('خطة AI غير متاحة لهذا السيرفر.', 404);
        if (aiRequest.library_mode === 'advice' || planningRequest(aiRequest.prompt)) throw problem('هذه أفكار أو خطة إرشادية وليست تنفيذًا واحدًا. اختر تغييرًا محددًا لتطبيقه.', 409);
        if (aiRequest.change_set_id) {
          const existing = (await client.query('SELECT * FROM change_sets WHERE id=$1 AND user_id=$2', [aiRequest.change_set_id, req.user.id])).rows[0];
          if (existing) { await client.query('COMMIT'); return res.json({ changeSet: existing, plan: existing.plan, reused: true }); }
        }
        const reviewed = alignAiProposalWithIntent({ ...aiRequest.proposal, executeNow: true }, [{ role: 'user', content: aiRequest.proposal.review_request || aiRequest.prompt }]);
        if (!reviewed.operations?.length) throw problem('هذه المهمة التفاعلية لا تحتاج إنشاء قنوات أو تصنيفات. راجع بطاقة النشر فقط.', 409);
        plan = { template_key: 'custom', name: 'تغييرات AI ديسكوكو', operations: normalizeOperations(reviewed.operations, current) };
      } else if (Array.isArray(req.body.operations)) plan = { template_key: 'custom', name: 'تعديلات القنوات والرتب', operations: normalizeOperations(req.body.operations, current) };
      else {
        if (!Object.hasOwn(templates, req.body.templateKey)) throw problem('القالب غير موجود.');
        plan = makeTemplatePlan(req.body.templateKey);
      }
      await requirePlanCapacity(req.user, 'changeSetsPerMonth', client);
      const { rows } = await client.query("INSERT INTO change_sets(user_id,guild_id,template_key,status,plan) VALUES($1,$2,$3,'draft',$4) RETURNING *", [req.user.id, guild.id, plan.template_key, plan]);
      const changeSet = rows[0];
      await client.query("INSERT INTO change_operations(change_set_id,operation_key,resource_type,result) SELECT $1,item->>'operation_key',item->>'resource_type',item FROM jsonb_array_elements($2::jsonb->'operations') item", [changeSet.id, JSON.stringify(plan)]);
      if (aiRequestId) await client.query('UPDATE ai_requests SET change_set_id=$1 WHERE id=$2 AND user_id=$3', [changeSet.id, aiRequestId, req.user.id]);
      await client.query('COMMIT');
      await audit(req.user.id, 'change_set.create', 'change_set', changeSet.id, { guild_id: guild.id });
      res.status(201).json({ changeSet, plan });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.post('/api/change-sets/:id/apply', requireUser, requireWriteAccess, route(async (req, res) => {
    const changeSet = (await pool.query('SELECT * FROM change_sets WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0];
    if (!changeSet) throw problem('خطة التغيير غير موجودة.', 404);
    if (req.body.confirmed !== true || String(req.body.guildId) !== changeSet.guild_id) throw problem('راجع التغييرات وأكد السيرفر المستهدف قبل التطبيق.');
    if (!await authorizedGuild(req.user, changeSet.guild_id)) throw problem('لم تعد تملك صلاحية إدارة هذا السيرفر.', 403);
    const lock = await pool.connect(); let acquired = false;
    try {
      // Serialize all plans for this guild, including across service instances.
      acquired = (await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`diskoko:${changeSet.guild_id}`])).rows[0].locked;
      if (!acquired) throw problem('هناك عملية أخرى قيد التنفيذ لهذا السيرفر. انتظر اكتمالها.', 409);
      if (changeSet.status === 'succeeded') return res.json({ ok: true, status: 'succeeded', changeSetId: changeSet.id, alreadyApplied: true });
      await lock.query('BEGIN');
      await requirePlanCapacity(req.user, 'changeSetsPerMonth', lock);
      const current = await snapshot(changeSet.guild_id);
      const botIdentity = await discord('/users/@me');
      const botRole = botIdentity.ok ? current.roles.find(role => role.tags?.bot_id === botIdentity.data.id) : null;
      const operations = (await pool.query('SELECT * FROM change_operations WHERE change_set_id=$1 ORDER BY id', [changeSet.id])).rows;
      const planned = new Map(changeSet.plan.operations.map(op => [op.operation_key, op]));
      const parents = new Map(operations.filter(op => op.resource_type === 'category' && op.status === 'succeeded').map(op => [op.operation_key, op.resource_id]));
      for (const row of operations.filter(op => op.status !== 'succeeded')) {
        const op = planned.get(row.operation_key);
        if (!op) throw problem('الخطة غير مكتملة. أنشئ مراجعة جديدة.', 409);
        if (op.resource_type === 'role' && op.action === 'update') {
          const target = resolveExisting(op, current);
          if (botRole && target && target.position >= botRole.position) throw problem(`لا يستطيع البوت تعديل رتبة «${target.name}» لأنها أعلى من رتبته أو مساوية لها. ارفع رتبة Diskoko في Discord أولًا.`, 409);
        }
        if (op.action === 'update') checkConflict(op, resolveExisting(op, current));
      }
      await pool.query("UPDATE change_sets SET status='running',updated_at=NOW() WHERE id=$1", [changeSet.id]);
      for (const row of operations) {
        if (row.status === 'succeeded') continue;
        const op = planned.get(row.operation_key);
        try {
          const parentId = op.parent_key ? parents.get(op.parent_key) : op.parent_id;
          if (op.parent_key && !parentId) throw problem('تعذر تحديد التصنيف المرتبط بالقناة.', 409);
          let resource = resolveExisting(op, current, parentId);
          checkExistingAccess(op, resource);
          if (!resource || op.action === 'update') {
            const endpoint = op.action === 'update'
              ? (op.resource_type === 'role' ? `/guilds/${changeSet.guild_id}/roles/${op.resource_id}` : `/channels/${op.resource_id}`)
              : `/guilds/${changeSet.guild_id}/${op.resource_type === 'role' ? 'roles' : 'channels'}`;
            const result = await discord(endpoint, { method: op.action === 'update' ? 'PATCH' : 'POST', body: JSON.stringify(operationBody(op, parentId)) });
            if (!result.ok) throw problem(`تعذر تنفيذ «${op.name}» (Discord ${result.status}). راجع صلاحيات البوت وترتيب رتبته.`, 409);
            resource = result.data;
            const rows = op.resource_type === 'role' ? current.roles : current.channels;
            const index = rows.findIndex(item => item.id === resource.id);
            if (index === -1) rows.push(resource); else rows[index] = resource;
          }
          if (Object.hasOwn(op, 'position')) {
            const reorderEndpoint = op.resource_type === 'role' ? `/guilds/${changeSet.guild_id}/roles` : `/guilds/${changeSet.guild_id}/channels`;
            const reordered = await discord(reorderEndpoint, { method: 'PATCH', body: JSON.stringify([{ id: resource.id, position: op.position }]) });
            if (!reordered.ok) throw problem(`تم تعديل «${op.name}» لكن تعذر تغيير ترتيبه (Discord ${reordered.status}).`, 409);
            resource = Array.isArray(reordered.data) ? reordered.data.find(item => item.id === resource.id) || resource : resource;
          }
          if (op.resource_type === 'category') parents.set(op.operation_key, resource.id);
          await pool.query("UPDATE change_operations SET status='succeeded',resource_id=$1,result=$2,updated_at=NOW() WHERE id=$3", [resource.id, { ...op, response: resource }, row.id]);
        } catch (error) {
          await pool.query("UPDATE change_operations SET status='failed',result=$1,updated_at=NOW() WHERE id=$2", [{ ...op, error: error.message }, row.id]);
          throw error;
        }
      }
      await pool.query("UPDATE change_sets SET status='succeeded',updated_at=NOW() WHERE id=$1", [changeSet.id]);
      await audit(req.user.id, 'change_set.apply', 'change_set', changeSet.id, { guild_id: changeSet.guild_id });
      await lock.query('COMMIT');
      res.json({ ok: true, status: 'succeeded', changeSetId: changeSet.id });
    } catch (error) {
      await lock.query('ROLLBACK').catch(() => {});
      if (acquired) {
        await pool.query("UPDATE change_sets SET status='failed',updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status<>'succeeded'", [changeSet.id, req.user.id]);
        await audit(req.user.id, 'change_set.failed', 'change_set', changeSet.id, { guild_id: changeSet.guild_id, error: error.message });
      }
      throw error;
    } finally { if (acquired) await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [`diskoko:${changeSet.guild_id}`]); lock.release(); }
  }));
  app.put('/api/workspace/:guildId/preferences', requireUser, requireWriteAccess, route(async (req, res) => {
    const guild = await guildFor(req);
    if (typeof req.body.analytics_enabled !== 'boolean') throw problem('اختر حالة جمع النشاط.');
    const result = await pool.query('INSERT INTO workspace_preferences(guild_id,analytics_enabled,analytics_started_at) VALUES($1,$2,CASE WHEN $2 THEN NOW() ELSE NULL END) ON CONFLICT(guild_id) DO UPDATE SET analytics_enabled=$2,analytics_started_at=CASE WHEN $2 THEN COALESCE(workspace_preferences.analytics_started_at,NOW()) ELSE workspace_preferences.analytics_started_at END,updated_at=NOW() RETURNING *', [guild.id, req.body.analytics_enabled]);
    await audit(req.user.id, 'analytics.settings', 'guild', guild.id, { enabled: req.body.analytics_enabled });
    res.json({ preferences: result.rows[0] });
  }));
  app.get('/api/workspace/:guildId/analytics', requireUser, route(async (req, res) => {
    const guild = await guildFor(req); const maxDays = entitlementsFor(req.user).analyticsDays; const requested = Number(req.query.days) || 7; const days = Math.min(maxDays, [7, 14, 30, 90, 365].find(value => value >= requested) || maxDays);
    const base = "FROM community_activity WHERE guild_id=$1 AND day >= CURRENT_DATE - ($2::int - 1)";
    const [members, channels, daily, totals] = await Promise.all([
      pool.query(`SELECT user_id,(array_agg(display_name ORDER BY day DESC))[1] AS display_name,SUM(messages)::int AS messages,COUNT(DISTINCT day)::int AS active_days ${base} GROUP BY user_id ORDER BY messages DESC LIMIT 30`, [guild.id, days]),
      pool.query(`SELECT channel_id,SUM(messages)::int AS messages ${base} GROUP BY channel_id ORDER BY messages DESC LIMIT 20`, [guild.id, days]),
      pool.query(`SELECT day,SUM(messages)::int AS messages ${base} GROUP BY day ORDER BY day`, [guild.id, days]),
      pool.query(`SELECT COALESCE(SUM(messages),0)::int AS messages,COUNT(DISTINCT user_id)::int AS active_members ${base}`, [guild.id, days]),
    ]);
    res.json({ days, members: members.rows, channels: channels.rows, daily: daily.rows, totals: totals.rows[0] });
  }));
  app.get('/api/workspace/:guildId/schedules', requireUser, route(async (req, res) => {
    const guild = await guildFor(req);
    const { rows } = await pool.query('SELECT id,channel_id,content,run_at,repeat,timezone,status,last_error,message_id,created_at FROM scheduled_messages WHERE user_id=$1 AND guild_id=$2 ORDER BY created_at DESC LIMIT 50', [req.user.id, guild.id]);
    res.json({ schedules: rows });
  }));
  app.post('/api/workspace/:guildId/schedules', requireUser, requireWriteAccess, route(async (req, res) => {
    const guild = await guildFor(req); const schedule = normalizeSchedule(req.body);
    if (req.body.confirmed !== true) throw problem('راجع الرسالة وموعدها ثم أكد الجدولة.');
    const current = await snapshot(guild.id);
    if (!current.channels.some(channel => channel.id === schedule.channel_id && [0, 5].includes(channel.type))) throw problem('اختر قناة نصية موجودة في هذا السيرفر.');
    const client = await pool.connect(); let result;
    try { await client.query('BEGIN'); await requirePlanCapacity(req.user, 'scheduledMessages', client); result = await client.query('INSERT INTO scheduled_messages(user_id,guild_id,channel_id,content,run_at,repeat,timezone) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.user.id, guild.id, schedule.channel_id, schedule.content, schedule.run_at, schedule.repeat, schedule.timezone]); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(req.user.id, 'schedule.create', 'guild', guild.id, { schedule_id: result.rows[0].id });
    res.status(201).json({ schedule: result.rows[0] });
  }));
  app.post('/api/workspace/:guildId/schedules/:id/cancel', requireUser, requireWriteAccess, route(async (req, res) => {
    const guild = await guildFor(req);
    const result = await pool.query("UPDATE scheduled_messages SET status='cancelled',updated_at=NOW() WHERE id=$1 AND guild_id=$2 AND user_id=$3 AND status IN ('scheduled','failed') RETURNING id", [req.params.id, guild.id, req.user.id]);
    if (!result.rowCount) throw problem('هذه المهمة نُفذت أو بدأ إرسالها بالفعل.', 409);
    await audit(req.user.id, 'schedule.cancel', 'guild', guild.id, { schedule_id: req.params.id });
    res.json({ ok: true });
  }));
}

export function startScheduleRunner({ pool, discordBotFetch, authorizedGuild }) {
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      // Ambiguous interrupted sends are not retried automatically (avoid duplicates).
      await pool.query("UPDATE scheduled_messages SET status='failed',last_error='توقف التنفيذ قبل تأكيد النتيجة. تحقق من القناة قبل إنشاء مهمة بديلة.',updated_at=NOW() WHERE status='sending' AND updated_at < NOW() - INTERVAL '10 minutes'");
      await pool.query("DELETE FROM community_activity WHERE day < CURRENT_DATE - 364");
      const { rows } = await pool.query("UPDATE scheduled_messages SET status='sending',updated_at=NOW() WHERE id IN (SELECT id FROM scheduled_messages WHERE status='scheduled' AND run_at<=NOW() ORDER BY run_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *");
      for (const job of rows) {
        try {
          const user = (await pool.query('SELECT * FROM users WHERE id=$1', [job.user_id])).rows[0];
          if (!user || user.status !== 'active' || !await authorizedGuild(user, job.guild_id)) throw new Error('توقفت المهمة لأن صاحبها لم يعد يملك صلاحية إدارة السيرفر.');
          const channel = await discordBotFetch(`/channels/${job.channel_id}`);
          if (!channel.ok || channel.data.guild_id !== job.guild_id) throw new Error('القناة غير متاحة داخل السيرفر.');
          const nonce = `dk${job.id}-${new Date(job.run_at).getTime()}`.slice(0, 25);
          const sent = await discordBotFetch(`/channels/${job.channel_id}/messages`, { method: 'POST', body: JSON.stringify({ content: job.content, allowed_mentions: { parse: [] }, nonce, enforce_nonce: true }) });
          if (!sent.ok) throw new Error(`تعذر الإرسال (Discord ${sent.status}). راجع صلاحيات القناة.`);
          const next = new Date(Date.now() + (job.repeat === 'weekly' ? 7 : 1) * 86400000);
          await pool.query("UPDATE scheduled_messages SET status=$1,message_id=$2,run_at=$3,last_error=NULL,updated_at=NOW() WHERE id=$4", [job.repeat === 'once' ? 'sent' : 'scheduled', sent.data.id, job.repeat === 'once' ? job.run_at : next, job.id]);
        } catch (error) { await pool.query("UPDATE scheduled_messages SET status='failed',last_error=$1,updated_at=NOW() WHERE id=$2", [error.message, job.id]); }
      }
    } catch (error) { console.error('Schedule runner failed', error.message); } finally { running = false; }
  };
  const timer = setInterval(tick, 30_000); timer.unref();
  return () => clearInterval(timer);
}
