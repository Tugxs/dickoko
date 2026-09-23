import crypto from 'node:crypto';
import { alignAiProposalWithIntent } from './ai-intent.js';

const LIMITS = { free: 0, starter: 20, growth: 100, business: 300 };
const promptLimit = 1500;

export function normalizeAiProposal(input) {
  if (!input || typeof input !== 'object') return null;
  const operations = [];
  for (const item of Array.isArray(input.operations) ? input.operations.slice(0, 8) : []) {
    if (!item || !['role', 'channel', 'category'].includes(item.resource_type)) continue;
    if (item.action && !['create', 'update'].includes(item.action)) continue;
    const name = String(item.name || '').trim().slice(0, 80);
    if (!name || /[\r\n@]/.test(name) || (item.resource_type === 'role' && /^(admin|administrator|owner|مدير|مالك)$/i.test(name))) continue;
    if (operations.some(op => op.resource_type === item.resource_type && op.name.toLowerCase() === name.toLowerCase())) continue;
    const updating = item.action === 'update';
    const resourceId = String(item.resource_id || '');
    if (updating && !/^\d{15,22}$/.test(resourceId)) continue;
    const operation = { resource_type: item.resource_type, action: updating ? 'update' : 'create', name, ...(updating ? { resource_id: resourceId } : item.resource_type === 'channel' ? { type: [0, 2, 15].includes(Number(item.type)) ? Number(item.type) : 0 } : {}) };
    if (item.resource_type === 'channel' && Object.hasOwn(item, 'topic')) operation.topic = String(item.topic || '').trim().slice(0, 1024);
    if (item.resource_type === 'role' && Object.hasOwn(item, 'color')) { const color = Number(item.color); if (Number.isInteger(color) && color >= 0 && color <= 0xffffff) operation.color = color; }
    operations.push(operation);
  }
  let message = null;
  if (input.message && typeof input.message === 'object') {
    const channel = String(input.message.channel || '').trim().replace(/^#/, '').slice(0, 100);
    const content = String(input.message.content || '').trim().slice(0, 1800);
    if (channel && content && !/[\r\n]/.test(channel)) message = { channel, content };
  }
  let interactive = null;
  if (input.interactive?.kind === 'giveaway') {
    const prize = String(input.interactive.prize || '').trim().slice(0, 160);
    const channel = String(input.interactive.channel || '').trim().replace(/^#/, '').slice(0, 100);
    const durationMinutes = Number(input.interactive.durationMinutes);
    const winnerCount = Number(input.interactive.winnerCount);
    if (prize && channel && Number.isInteger(durationMinutes) && durationMinutes >= 5 && durationMinutes <= 43200 && Number.isInteger(winnerCount) && winnerCount >= 1 && winnerCount <= 20) interactive = { kind: 'giveaway', prize, channel, durationMinutes, winnerCount };
  } else if (input.interactive?.kind === 'tickets') {
    const title = String(input.interactive.title || '').trim().slice(0, 100);
    const description = String(input.interactive.description || '').trim().slice(0, 800);
    const channel = String(input.interactive.channel || '').trim().replace(/^#/, '').slice(0, 100);
    if (title && description && channel) interactive = { kind: 'tickets', title, description, channel };
  } else if (input.interactive?.kind === 'poll') {
    const question = String(input.interactive.question || '').trim().slice(0, 180);
    const channel = String(input.interactive.channel || '').trim().replace(/^#/, '').slice(0, 100);
    const options = Array.isArray(input.interactive.options) ? input.interactive.options.map(option => String(option || '').trim().slice(0, 70)).filter(Boolean).slice(0, 5) : [];
    if (question && channel && options.length >= 2 && new Set(options.map(option => option.toLocaleLowerCase('ar'))).size === options.length) interactive = { kind: 'poll', question, channel, options };
  }
  if (interactive) message = null;
  return operations.length || message || interactive ? { operations, message, ...(interactive ? { interactive } : {}) } : null;
}

function workerAuthorized(req) {
  const expected = process.env.AI_WORKER_TOKEN;
  const provided = /^Bearer (.+)$/i.exec(req.get('authorization') || '')?.[1];
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function migrateLocalAi(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id UUID PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'محادثة جديدة',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, guild_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS ai_requests (
      id UUID PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL;
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS proposal JSONB;
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS sent_message_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS sent_channel_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS attachment JSONB;
    INSERT INTO ai_conversations(id,user_id,guild_id,title,created_at,updated_at)
      SELECT md5(user_id::text || ':' || guild_id)::uuid,user_id,guild_id,'سجل سابق',MIN(created_at),MAX(created_at)
      FROM ai_requests WHERE conversation_id IS NULL GROUP BY user_id,guild_id ON CONFLICT DO NOTHING;
    UPDATE ai_requests SET conversation_id=md5(user_id::text || ':' || guild_id)::uuid WHERE conversation_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_ai_requests_user ON ai_requests(user_id, guild_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_requests_queue ON ai_requests(status, created_at);
    CREATE TABLE IF NOT EXISTS ai_worker_state (
      id INTEGER PRIMARY KEY CHECK (id=1),
      last_seen_at TIMESTAMPTZ,
      model TEXT
    );
    INSERT INTO ai_worker_state(id) VALUES (1) ON CONFLICT DO NOTHING;
  `);
}

export function mountLocalAi(app, { pool, requireUser, requireWriteAccess, authorizedGuild, canonicalPlan, discordBotFetch }) {
  const worker = (req, res, next) => workerAuthorized(req) ? next() : res.status(401).json({ error: 'غير مصرح' });
  const canManage = async (user, guildId) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return !!await authorizedGuild(user, guildId); }
      catch (error) {
        if (error.status !== 502 || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    return false;
  };

  app.get('/api/ai/status', requireUser, async (req, res, next) => { try {
    const plan = canonicalPlan(req.user.plan);
    const { rows } = await pool.query('SELECT last_seen_at,model FROM ai_worker_state WHERE id=1');
    const lastSeen = rows[0]?.last_seen_at;
    res.json({ available: !!process.env.AI_WORKER_TOKEN && !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 60000, planEnabled: plan !== 'free', model: rows[0]?.model || null });
  } catch (error) { next(error); } });

  app.get('/api/ai/conversations', requireUser, async (req, res, next) => { try {
    const guildId = String(req.query.guildId || '');
    if (!/^\d{17,20}$/.test(guildId) || !await canManage(req.user, guildId)) return res.status(403).json({ error: 'لا تملك صلاحية إدارة هذا السيرفر' });
    const { rows } = await pool.query('SELECT id,title,created_at,updated_at FROM ai_conversations WHERE user_id=$1 AND guild_id=$2 ORDER BY updated_at DESC LIMIT 50', [req.user.id, guildId]);
    res.json({ conversations: rows });
  } catch (error) { next(error); } });

  app.post('/api/ai/conversations', requireUser, requireWriteAccess, async (req, res, next) => { try {
    const guildId = String(req.body.guildId || '');
    if (!/^\d{17,20}$/.test(guildId) || !await canManage(req.user, guildId)) return res.status(403).json({ error: 'لا تملك صلاحية إدارة هذا السيرفر' });
    if (!LIMITS[canonicalPlan(req.user.plan)]) return res.status(403).json({ error: 'AI ديسكوكو متاح من باقة Starter. طوّر باقتك أولًا.' });
    const { rows } = await pool.query('INSERT INTO ai_conversations(id,user_id,guild_id) VALUES($1,$2,$3) RETURNING id,title,created_at,updated_at', [crypto.randomUUID(), req.user.id, guildId]);
    res.status(201).json({ conversation: rows[0] });
  } catch (error) { next(error); } });

  app.get('/api/ai/conversations/:id/messages', requireUser, async (req, res, next) => { try {
    const conversation = (await pool.query('SELECT id,guild_id,title FROM ai_conversations WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0];
    if (!conversation || !await canManage(req.user, conversation.guild_id)) return res.status(404).json({ error: 'المحادثة غير موجودة' });
    const { rows } = await pool.query('SELECT id,prompt,answer,status,error,proposal,sent_message_id,sent_channel_id,interactive_message_id,interactive_channel_id,interactive_kind,has_attachment,created_at,completed_at FROM (SELECT id,prompt,answer,status,error,proposal,sent_message_id,sent_channel_id,interactive_message_id,interactive_channel_id,interactive_kind,(attachment IS NOT NULL) AS has_attachment,created_at,completed_at FROM ai_requests WHERE conversation_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100) recent ORDER BY created_at', [conversation.id, req.user.id]);
    res.json({ conversation, messages: rows });
  } catch (error) { next(error); } });

  app.delete('/api/ai/conversations/:id', requireUser, requireWriteAccess, async (req, res, next) => { try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const conversation = (await client.query('SELECT id,guild_id FROM ai_conversations WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
      if (!conversation || !await canManage(req.user, conversation.guild_id)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'المحادثة غير موجودة' }); }
      const active = (await client.query("SELECT id FROM ai_requests WHERE conversation_id=$1 AND status IN ('pending','processing') LIMIT 1", [conversation.id])).rows[0];
      if (active) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'انتظر اكتمال الرد الحالي قبل حذف المحادثة' }); }
      await client.query('DELETE FROM ai_requests WHERE conversation_id=$1 AND user_id=$2', [conversation.id, req.user.id]);
      await client.query('DELETE FROM ai_conversations WHERE id=$1 AND user_id=$2', [conversation.id, req.user.id]);
      await client.query('COMMIT'); res.json({ ok: true });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  } catch (error) { next(error); } });

  app.get('/api/ai/requests/:id/attachment', requireUser, async (req, res, next) => { try {
    const item = (await pool.query('SELECT guild_id,attachment FROM ai_requests WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])).rows[0];
    if (!item?.attachment || !await canManage(req.user, item.guild_id)) return res.status(404).end();
    res.set('Content-Type', item.attachment.mime).set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff').send(Buffer.from(item.attachment.base64, 'base64'));
  } catch (error) { next(error); } });

  app.post('/api/ai/requests', requireUser, requireWriteAccess, async (req, res, next) => { try {
    const plan = canonicalPlan(req.user.plan);
    if (!LIMITS[plan]) return res.status(403).json({ error: 'AI ديسكوكو متاح من باقة Starter. طوّر باقتك أولًا.' });
    const guildId = String(req.body.guildId || '');
    if (!/^\d{17,20}$/.test(guildId) || !await canManage(req.user, guildId)) return res.status(403).json({ error: 'لا تملك صلاحية إدارة هذا السيرفر' });
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt || prompt.length > promptLimit) return res.status(400).json({ error: `اكتب طلبًا بين 1 و${promptLimit} حرفًا` });
    let attachment = req.body.image || null;
    if (attachment && (!['image/jpeg','image/png','image/webp'].includes(String(attachment.mime || '')) || !/^[A-Za-z0-9+/]+={0,2}$/.test(String(attachment.base64 || '')) || String(attachment.base64).length > 470000 || Buffer.from(attachment.base64, 'base64').length > 350000)) return res.status(400).json({ error: 'الصورة غير صالحة أو كبيرة جدًا' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1::int,$2::int)', [Number(req.user.id) % 2147483647, 791]);
      const daily = (await client.query("SELECT COUNT(*)::int AS total FROM ai_requests WHERE user_id=$1 AND created_at > NOW()-INTERVAL '24 hours'", [req.user.id])).rows[0].total;
      if (daily >= LIMITS[plan]) { await client.query('ROLLBACK'); return res.status(429).json({ error: 'وصلت إلى حد طلبات AI ديسكوكو اليومية لهذه الباقة.' }); }
      const active = (await client.query("SELECT id FROM ai_requests WHERE user_id=$1 AND status IN ('pending','processing') LIMIT 1", [req.user.id])).rows[0];
      if (active) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'لديك طلب قيد المعالجة؛ انتظر نتيجته أولًا.', requestId: active.id }); }
      let conversationId = String(req.body.conversationId || '');
      if (conversationId) {
        const owned = (await client.query('SELECT id FROM ai_conversations WHERE id=$1 AND user_id=$2 AND guild_id=$3', [conversationId, req.user.id, guildId])).rows[0];
        if (!owned) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'المحادثة غير موجودة' }); }
      } else {
        conversationId = crypto.randomUUID();
        await client.query('INSERT INTO ai_conversations(id,user_id,guild_id) VALUES($1,$2,$3)', [conversationId, req.user.id, guildId]);
      }
      const id = crypto.randomUUID();
      await client.query('INSERT INTO ai_requests(id,user_id,guild_id,prompt,conversation_id,attachment) VALUES($1,$2,$3,$4,$5,$6)', [id, req.user.id, guildId, prompt, conversationId, attachment]);
      await client.query("UPDATE ai_conversations SET title=CASE WHEN title='محادثة جديدة' THEN LEFT($2,60) ELSE title END,updated_at=NOW() WHERE id=$1", [conversationId, prompt]);
      await client.query('COMMIT');
      res.status(202).json({ id, status: 'pending', conversationId });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  } catch (error) { next(error); } });

  app.get('/api/ai/requests/:id', requireUser, async (req, res, next) => { try {
    const { rows } = await pool.query('SELECT id,guild_id,status,answer,error,created_at,completed_at FROM ai_requests WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'الطلب غير موجود' });
    res.json({ request: rows[0] });
  } catch (error) { next(error); } });

  app.post('/api/ai/requests/:id/send-message', requireUser, requireWriteAccess, async (req, res, next) => { try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const item = (await client.query('SELECT id,guild_id,status,answer,proposal,attachment,sent_message_id,sent_channel_id FROM ai_requests WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
      const publishAnswer = req.body.publishAnswer === true && item?.status === 'completed' && Boolean(item?.answer);
      if (!item || (!item.proposal?.message && !publishAnswer)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'لا يوجد محتوى جاهز للإرسال' }); }
      if (item.sent_message_id) { await client.query('COMMIT'); return res.json({ ok: true, alreadySent: true, messageId: item.sent_message_id, channelId: item.sent_channel_id }); }
      if (!await canManage(req.user, item.guild_id)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'لم تعد تملك صلاحية إدارة هذا السيرفر' }); }
      if (req.body.confirmed !== true) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'راجع الرسالة وأكد إرسالها أولًا' }); }
      const channels = await discordBotFetch(`/guilds/${item.guild_id}/channels`);
      if (!channels.ok || !Array.isArray(channels.data)) throw Object.assign(new Error('تعذر قراءة قنوات السيرفر من Discord'), { status: 502 });
      const channelId = String(req.body.channelId || '');
      const channel = channels.data.find(entry => [0, 5].includes(entry.type) && (channelId ? entry.id === channelId : entry.name.toLowerCase() === item.proposal?.message?.channel?.toLowerCase()));
      if (!channel) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'اختر قناة نصية موجودة في هذا السيرفر' }); }
      const content = String(req.body.content || (publishAnswer ? item.answer : item.proposal.message.content)).trim();
      if (!content || content.length > 1800) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'اكتب رسالة لا تتجاوز 1800 حرف' }); }
      let options;
      const image = req.body.image || item.attachment;
      if (image) {
        const mime = String(image.mime || '');
        const raw = String(image.base64 || '');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length > 470000) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'الصورة غير صالحة أو أكبر من الحد المسموح' }); }
        const bytes = Buffer.from(raw, 'base64');
        const valid = mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
        if (!valid || bytes.length > 350000) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'نوع الصورة أو حجمها غير صالح' }); }
        const form = new FormData();
        const filename = `diskoko-image.${mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1]}`;
        form.append('payload_json', JSON.stringify({ embeds: [{ image: { url: `attachment://${filename}` } }, { description: content }], allowed_mentions: { parse: [] } }));
        form.append('files[0]', new Blob([bytes], { type: mime }), filename);
        options = { method: 'POST', body: form };
      } else options = { method: 'POST', body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) };
      const sent = await discordBotFetch(`/channels/${channel.id}/messages`, options);
      if (!sent.ok || !sent.data?.id) throw Object.assign(new Error(`لم يتم إرسال الرسالة إلى Discord (${sent.status}). تحقق من صلاحية البوت في القناة.`), { status: 502 });
      await client.query('UPDATE ai_requests SET sent_message_id=$1,sent_channel_id=$2 WHERE id=$3', [sent.data.id, channel.id, item.id]);
      await client.query('COMMIT');
      res.json({ ok: true, messageId: sent.data.id, channelId: channel.id });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  } catch (error) { next(error); } });

  app.get('/api/ai/worker/next', worker, async (req, res, next) => { try {
    await pool.query('UPDATE ai_worker_state SET last_seen_at=NOW(),model=$1 WHERE id=1', [String(req.get('x-ai-model') || '').slice(0, 80)]);
    const { rows } = await pool.query(`WITH queued AS (
      SELECT id FROM ai_requests WHERE status='pending' OR (status='processing' AND claimed_at < NOW()-INTERVAL '5 minutes')
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE ai_requests SET status='processing',claimed_at=NOW() WHERE id IN (SELECT id FROM queued)
    RETURNING id,user_id,guild_id,prompt,conversation_id,(attachment IS NOT NULL) AS has_attachment`);
    const job = rows[0];
    if (!job) return res.json({ request: null });
    let context = [];
    if (job.conversation_id) {
      const prior = (await pool.query("SELECT prompt,answer FROM ai_requests WHERE conversation_id=$1 AND user_id=$2 AND guild_id=$3 AND id<>$4 AND status='completed' AND created_at < (SELECT created_at FROM ai_requests WHERE id=$4) ORDER BY created_at DESC LIMIT 6", [job.conversation_id, job.user_id, job.guild_id, job.id])).rows.reverse();
      context = prior.flatMap(item => [{ role: 'user', content: item.prompt.slice(0, 900) }, { role: 'assistant', content: item.answer.slice(0, 1400) }]);
    }
    let guildContext = null;
    if (discordBotFetch) {
      const unavailable = { ok: false, data: null };
      const [remote, channels, roles] = await Promise.all([discordBotFetch(`/guilds/${job.guild_id}`).catch(() => unavailable), discordBotFetch(`/guilds/${job.guild_id}/channels`).catch(() => unavailable), discordBotFetch(`/guilds/${job.guild_id}/roles`).catch(() => unavailable)]);
      guildContext = { name: remote.ok ? String(remote.data.name || '').slice(0, 100) : '', channels: channels.ok && Array.isArray(channels.data) ? channels.data.map(item => ({ id: item.id, name: item.name, type: item.type })).slice(0, 100) : [], roles: roles.ok && Array.isArray(roles.data) ? roles.data.map(item => ({ id: item.id, name: item.name, managed: Boolean(item.managed) })).slice(0, 100) : [] };
    }
    res.json({ request: { id: job.id, guild_id: job.guild_id, prompt: job.prompt, has_attachment: job.has_attachment, context, guild_context: guildContext } });
  } catch (error) { next(error); } });

  app.post('/api/ai/worker/:id/complete', worker, async (req, res, next) => { try {
    const answer = String(req.body.answer || '').trim();
    const error = String(req.body.error || '').trim().slice(0, 300);
    if ((!answer && !error) || answer.length > 5000) return res.status(400).json({ error: 'نتيجة غير صالحة' });
    let submitted = req.body.proposal;
    if (!error && submitted?.message) {
      const { rows } = await pool.query(`SELECT prior.prompt FROM ai_requests AS current
        JOIN ai_requests AS prior ON prior.conversation_id=current.conversation_id AND prior.user_id=current.user_id
          AND prior.created_at<=current.created_at
        WHERE current.id=$1 AND current.status='processing' ORDER BY prior.created_at DESC LIMIT 4`, [req.params.id]);
      const context = rows.reverse().map(row => ({ role: 'user', content: row.prompt }));
      const channelName = String(submitted.message.channel || '').replace(/^#/, '').trim();
      submitted = alignAiProposalWithIntent({ ...submitted, executeNow: true }, context, channelName ? [{ name: channelName, type: 0 }] : []);
    }
    const proposal = error ? null : normalizeAiProposal(submitted);
    const { rowCount } = await pool.query(`UPDATE ai_requests AS current SET status=$1,answer=$2,error=$3,proposal=$4,completed_at=NOW(),
      attachment=CASE WHEN $6 AND current.attachment IS NULL THEN COALESCE((
        SELECT prior.attachment FROM ai_requests AS prior
        WHERE prior.conversation_id=current.conversation_id AND prior.user_id=current.user_id AND prior.guild_id=current.guild_id
          AND prior.attachment IS NOT NULL AND prior.created_at<current.created_at AND prior.created_at>NOW()-INTERVAL '2 hours'
        ORDER BY prior.created_at DESC LIMIT 1
      ),current.attachment) ELSE current.attachment END
      WHERE current.id=$5 AND current.status='processing'`, [error ? 'failed' : 'completed', error ? null : answer, error || null, proposal, req.params.id, Boolean(proposal?.message || proposal?.interactive)]);
    if (!rowCount) return res.status(409).json({ error: 'الطلب غير متاح للإكمال' });
    res.json({ ok: true });
  } catch (error) { next(error); } });
}

export { workerAuthorized };

