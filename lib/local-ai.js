import crypto from 'node:crypto';

const LIMITS = { free: 0, starter: 20, growth: 100, business: 300 };
const promptLimit = 1500;

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

export function mountLocalAi(app, { pool, requireUser, requireWriteAccess, authorizedGuild, canonicalPlan }) {
  const worker = (req, res, next) => workerAuthorized(req) ? next() : res.status(401).json({ error: 'غير مصرح' });

  app.get('/api/ai/status', requireUser, async (req, res, next) => { try {
    const plan = canonicalPlan(req.user.plan);
    const { rows } = await pool.query('SELECT last_seen_at,model FROM ai_worker_state WHERE id=1');
    const lastSeen = rows[0]?.last_seen_at;
    res.json({ available: !!process.env.AI_WORKER_TOKEN && !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 60000, planEnabled: plan !== 'free', model: rows[0]?.model || null });
  } catch (error) { next(error); } });

  app.post('/api/ai/requests', requireUser, requireWriteAccess, async (req, res, next) => { try {
    const plan = canonicalPlan(req.user.plan);
    if (!LIMITS[plan]) return res.status(403).json({ error: 'AI ديسكوكو متاح من باقة Starter. طوّر باقتك أولًا.' });
    const guildId = String(req.body.guildId || '');
    if (!/^\d{17,20}$/.test(guildId) || !await authorizedGuild(req.user, guildId)) return res.status(403).json({ error: 'لا تملك صلاحية إدارة هذا السيرفر' });
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt || prompt.length > promptLimit) return res.status(400).json({ error: `اكتب طلبًا بين 1 و${promptLimit} حرفًا` });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1::int,$2::int)', [Number(req.user.id) % 2147483647, 791]);
      const daily = (await client.query("SELECT COUNT(*)::int AS total FROM ai_requests WHERE user_id=$1 AND created_at > NOW()-INTERVAL '24 hours'", [req.user.id])).rows[0].total;
      if (daily >= LIMITS[plan]) { await client.query('ROLLBACK'); return res.status(429).json({ error: 'وصلت إلى حد طلبات AI ديسكوكو اليومية لهذه الباقة.' }); }
      const active = (await client.query("SELECT id FROM ai_requests WHERE user_id=$1 AND status IN ('pending','processing') LIMIT 1", [req.user.id])).rows[0];
      if (active) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'لديك طلب قيد المعالجة؛ انتظر نتيجته أولًا.', requestId: active.id }); }
      const id = crypto.randomUUID();
      await client.query('INSERT INTO ai_requests(id,user_id,guild_id,prompt) VALUES($1,$2,$3,$4)', [id, req.user.id, guildId, prompt]);
      await client.query('COMMIT');
      res.status(202).json({ id, status: 'pending' });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  } catch (error) { next(error); } });

  app.get('/api/ai/requests/:id', requireUser, async (req, res, next) => { try {
    const { rows } = await pool.query('SELECT id,guild_id,status,answer,error,created_at,completed_at FROM ai_requests WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'الطلب غير موجود' });
    res.json({ request: rows[0] });
  } catch (error) { next(error); } });

  app.get('/api/ai/worker/next', worker, async (req, res, next) => { try {
    await pool.query('UPDATE ai_worker_state SET last_seen_at=NOW(),model=$1 WHERE id=1', [String(req.get('x-ai-model') || '').slice(0, 80)]);
    const { rows } = await pool.query(`WITH queued AS (
      SELECT id FROM ai_requests WHERE status='pending' OR (status='processing' AND claimed_at < NOW()-INTERVAL '5 minutes')
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE ai_requests SET status='processing',claimed_at=NOW() WHERE id IN (SELECT id FROM queued)
    RETURNING id,guild_id,prompt`);
    res.json({ request: rows[0] || null });
  } catch (error) { next(error); } });

  app.post('/api/ai/worker/:id/complete', worker, async (req, res, next) => { try {
    const answer = String(req.body.answer || '').trim();
    const error = String(req.body.error || '').trim().slice(0, 300);
    if ((!answer && !error) || answer.length > 5000) return res.status(400).json({ error: 'نتيجة غير صالحة' });
    const { rowCount } = await pool.query("UPDATE ai_requests SET status=$1,answer=$2,error=$3,completed_at=NOW() WHERE id=$4 AND status='processing'", [error ? 'failed' : 'completed', error ? null : answer, error || null, req.params.id]);
    if (!rowCount) return res.status(409).json({ error: 'الطلب غير متاح للإكمال' });
    res.json({ ok: true });
  } catch (error) { next(error); } });
}

export { workerAuthorized };

