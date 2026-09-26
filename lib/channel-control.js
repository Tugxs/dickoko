const SEND_MESSAGES = 1n << 11n;
const snowflake = value => /^\d{17,22}$/.test(String(value || ''));

export function validateChannelControl(input = {}) {
  if (!snowflake(input.channelId)) return 'اختر قناة نصية من هذا السيرفر.';
  if (!['open', 'locked', 'roles'].includes(input.mode)) return 'اختر من يستطيع الكتابة في القناة.';
  if (input.name !== undefined && (!String(input.name).trim() || String(input.name).length > 100 || /[\r\n]/.test(input.name))) return 'اسم القناة يجب ألا يتجاوز 100 حرف أو يحتوي على سطر جديد.';
  if (input.topic !== undefined && String(input.topic).length > 1024) return 'وصف القناة يجب ألا يتجاوز 1024 حرفًا.';
  if (input.slowmode !== undefined && (!Number.isInteger(Number(input.slowmode)) || Number(input.slowmode) < 0 || Number(input.slowmode) > 21600)) return 'المدة بين الرسائل يجب أن تكون بين صفر و21600 ثانية.';
  if (input.nsfw !== undefined && typeof input.nsfw !== 'boolean') return 'خيار المحتوى الحساس غير صالح.';
  if (!Array.isArray(input.roleIds) || input.roleIds.length > 25 || input.roleIds.some(id => !snowflake(id)) || new Set(input.roleIds).size !== input.roleIds.length) return 'اختر حتى 25 رتبة مختلفة من السيرفر.';
  if (input.mode === 'roles' && !input.roleIds.length) return 'اختر رتبة واحدة على الأقل للسماح لها بالكتابة.';
  return null;
}

export function buildChannelControlPatch(channel, guildId, input) {
  const chosen = new Set(input.mode === 'roles' ? input.roleIds : []);
  const overwrites = new Map((channel.permission_overwrites || []).map(row => [String(row.id), { id: String(row.id), type: Number(row.type), allow: BigInt(row.allow || 0), deny: BigInt(row.deny || 0) }]));
  if (!overwrites.has(guildId)) overwrites.set(guildId, { id: guildId, type: 0, allow: 0n, deny: 0n });
  for (const id of chosen) if (!overwrites.has(id)) overwrites.set(id, { id, type: 0, allow: 0n, deny: 0n });
  for (const row of overwrites.values()) {
    if (row.type === 1) {
      if (input.mode !== 'open') row.allow &= ~SEND_MESSAGES;
      continue;
    }
    row.allow &= ~SEND_MESSAGES;
    row.deny &= ~SEND_MESSAGES;
    if (row.id === guildId) {
      if (input.mode === 'open') row.allow |= SEND_MESSAGES;
      else row.deny |= SEND_MESSAGES;
    } else if (chosen.has(row.id)) row.allow |= SEND_MESSAGES;
  }
  return {
    ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
    ...(input.topic !== undefined ? { topic: String(input.topic) } : {}),
    ...(input.slowmode !== undefined ? { rate_limit_per_user: Number(input.slowmode) } : {}),
    ...(input.nsfw !== undefined ? { nsfw: input.nsfw } : {}),
    permission_overwrites: [...overwrites.values()].map(row => ({ id: row.id, type: row.type, allow: String(row.allow), deny: String(row.deny) })),
  };
}

export function mountChannelControl(app, { pool, requireUser, requireWriteAccess, authorizedGuild, discordBotFetch, requirePlanCapacity }) {
  app.post('/api/ai/requests/:id/control-channel', requireUser, requireWriteAccess, async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reject = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };
      const item = (await client.query('SELECT id,guild_id,user_id,library_mode,library_category,library_title,proposal,interactive_kind FROM ai_requests WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
      if (!item || item.proposal?.interactive?.kind !== 'channel_control') return reject(404, 'قالب التحكم بالقناة غير موجود.');
      if (item.interactive_kind === 'channel_control') return reject(409, 'نُفذ هذا الطلب من قبل. افتح قالبًا جديدًا لتغيير القناة مرة أخرى.');
      if (req.body.confirmed !== true) return reject(400, 'راجع التغييرات وأكد تنفيذها.');
      const error = validateChannelControl(req.body);
      if (error) return reject(400, error);
      if (!await authorizedGuild(req.user, item.guild_id)) return reject(403, 'لا تملك صلاحية إدارة هذا السيرفر.');
      const [channelResult, rolesResult] = await Promise.all([
        discordBotFetch(`/channels/${req.body.channelId}`),
        discordBotFetch(`/guilds/${item.guild_id}/roles`),
      ]);
      if (!channelResult.ok || !rolesResult.ok || !Array.isArray(rolesResult.data)) return reject(503, 'تعذر التحقق من القناة والرتب الآن. تأكد من اتصال البوت وصلاحية عرض القناة ثم حاول مجددًا.');
      const channel = channelResult.data;
      if (String(channel?.guild_id) !== String(item.guild_id) || ![0, 5].includes(channel?.type)) return reject(400, 'اختر قناة نصية أو قناة إعلانات من هذا السيرفر.');
      const validRoles = new Set(rolesResult.data.filter(role => !role.managed && role.id !== item.guild_id).map(role => role.id));
      if (req.body.roleIds.some(id => !validRoles.has(id))) return reject(400, 'إحدى الرتب المختارة لم تعد متاحة في السيرفر.');
      const patch = buildChannelControlPatch(channel, item.guild_id, req.body);
      if (patch.permission_overwrites.length > 100) return reject(400, 'تجاوزت القناة الحد المتاح لاستثناءات الصلاحيات. قلل الاستثناءات أولًا.');
      await requirePlanCapacity(req.user, 'changeSetsPerMonth', client);
      const result = await discordBotFetch(`/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      if (!result.ok) return reject(result.status === 403 ? 409 : 502, result.status === 403 ? 'البوت يحتاج صلاحية Manage Channels لإدارة هذه القناة، وقد تمنعه صلاحيات القناة الحالية.' : 'رفض Discord تعديل القناة. لم تُحفظ التغييرات.');
      await client.query('UPDATE ai_requests SET interactive_channel_id=$1,interactive_kind=$2,published_at=NOW(),proposal=$4,publishing_bot_id=$5 WHERE id=$3', [channel.id, 'channel_control', item.id, { ...item.proposal, interactive: { ...item.proposal.interactive, ...req.body, confirmed: undefined } }, req.publishingBotId || null]);
      await client.query('COMMIT');
      res.json({ ok: true, channelId: channel.id });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); next(error); }
    finally { client.release(); }
  });
}
