import { incompleteLibraryValue } from './ai-library-draft.js';
import { readyAiTemplate } from '../ai-library-catalog.js';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const snowflake = value => /^\d{17,20}$/.test(String(value || ''));

export function nativeEventCover(image) {
  if (!image) return null;
  const mime = String(image.mime || '');
  const base64 = String(image.base64 || '');
  if (!['image/png', 'image/jpeg'].includes(mime) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 2_800_000) fail('صورة غلاف الحدث يجب أن تكون PNG أو JPG بحجم أقل من 2 ميجابايت بعد التجهيز.');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024 || (mime === 'image/jpeg' ? bytes[0] !== 0xff || bytes[1] !== 0xd8 : !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) fail('صورة غلاف الحدث غير صالحة.');
  return `data:${mime};base64,${base64}`;
}

export function nativeEventPayload(input, channels, now = Date.now()) {
  const name = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  if (incompleteLibraryValue(name) || name.length > 100) fail('اكتب عنوان حدث واضحًا لا يتجاوز 100 حرف.');
  if (description.length > 1000 || /\[[^\]]+\]/.test(description)) fail('وصف الحدث يجب ألا يتجاوز 1000 حرف وألا يحتوي على حقول غير مكتملة.');
  const start = new Date(input.startTime), end = new Date(input.endTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() < now + 60_000 || end <= start) fail('حدد بداية مستقبلية ونهاية بعدها.');
  if (end.getTime() - start.getTime() > 30 * 86400_000) fail('مدة الحدث لا يمكن أن تتجاوز 30 يومًا.');
  const type = String(input.locationType || '');
  const entityType = { stage: 1, voice: 2, elsewhere: 3 }[type];
  if (!entityType) fail('اختر مكان الحدث: قناة صوتية أو Stage أو مكان آخر.');
  const body = { name, description, privacy_level: 2, entity_type: entityType, scheduled_start_time: start.toISOString(), scheduled_end_time: end.toISOString() };
  if (type === 'elsewhere') {
    const location = String(input.location || '').trim();
    if (incompleteLibraryValue(location) || location.length > 100) fail('اكتب رابطًا أو اسم مكان الحدث، حتى 100 حرف.');
    body.entity_metadata = { location };
  } else {
    const channelId = String(input.channelId || '');
    if (!snowflake(channelId) || !channels.some(channel => channel.id === channelId && channel.type === (type === 'stage' ? 13 : 2))) fail('اختر قناة صوتية أو Stage من هذا السيرفر تناسب نوع الحدث.');
    body.channel_id = channelId;
  }
  const recurrence = String(input.recurrence || 'none');
  if (!['none', 'daily', 'weekly'].includes(recurrence)) fail('نوع تكرار الحدث غير مدعوم.');
  if (recurrence !== 'none') body.recurrence_rule = { start: start.toISOString(), frequency: recurrence === 'daily' ? 3 : 2, interval: 1 };
  const image = nativeEventCover(input.image);
  if (image) body.image = image;
  return body;
}

export function mountNativeEvents(app, { pool, requireUser, requireWriteAccess, authorizedGuild, discordBotFetch, requirePlanCapacity }) {
  app.post('/api/ai/requests/:id/create-scheduled-event', requireUser, requireWriteAccess, async (req, res, next) => {
    const client = await pool.connect();
    let createdEventId = null;
    let guildId = null;
    try {
      await client.query('BEGIN');
      const item = (await client.query('SELECT id,guild_id,library_mode,library_title,library_category,proposal,interactive_message_id,interactive_kind FROM ai_requests WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
      if (!item || item.proposal?.interactive?.kind !== 'scheduled_event') throw Object.assign(new Error('طلب الحدث غير موجود.'), { status: 404 });
      guildId = item.guild_id;
      if (item.interactive_message_id) { await client.query('COMMIT'); return res.json({ ok: true, alreadyCreated: true, eventId: item.interactive_message_id, guildId }); }
      if (item.library_mode && !readyAiTemplate(item.library_category, item.library_title)) throw Object.assign(new Error('هذا القالب لم يعد متاحًا.'), { status: 409 });
      if (req.body.confirmed !== true || !await authorizedGuild(req.user, guildId)) throw Object.assign(new Error('راجع الحدث وتحقق من صلاحيتك قبل الإنشاء.'), { status: 403 });
      await requirePlanCapacity(req.user, 'changeSetsPerMonth', client);
      const channels = await discordBotFetch(`/guilds/${guildId}/channels`);
      if (!channels.ok || !Array.isArray(channels.data)) throw Object.assign(new Error('تعذر قراءة قنوات السيرفر.'), { status: 502 });
      const payload = nativeEventPayload(req.body, channels.data);
      const created = await discordBotFetch(`/guilds/${guildId}/scheduled-events`, { method: 'POST', body: JSON.stringify(payload) });
      if (!created.ok || !snowflake(created.data?.id)) throw Object.assign(new Error(created.status === 403 ? 'البوت يحتاج صلاحية Create Events في السيرفر أو القناة المحددة.' : 'رفض Discord إنشاء الحدث. تحقق من الموعد والمكان والصورة وصلاحيات البوت.'), { status: created.status === 403 ? 403 : 502 });
      createdEventId = created.data.id;
      await client.query('UPDATE ai_requests SET interactive_message_id=$1,interactive_channel_id=$2,interactive_kind=$3,published_at=NOW(),proposal=$5,publishing_bot_id=$6 WHERE id=$4', [createdEventId, payload.channel_id || null, 'scheduled_event', item.id, { ...item.proposal, interactive: { kind: 'scheduled_event', title: payload.name, description: payload.description, startTime: payload.scheduled_start_time, endTime: payload.scheduled_end_time, locationType: req.body.locationType, location: payload.entity_metadata?.location || null, channelId: payload.channel_id || null, recurrence: req.body.recurrence || 'none' } }, req.publishingBotId || null]);
      await client.query('COMMIT');
      res.json({ ok: true, eventId: createdEventId, guildId });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (createdEventId && guildId) await discordBotFetch(`/guilds/${guildId}/scheduled-events/${createdEventId}`, { method: 'DELETE' }).catch(() => {});
      next(error);
    } finally { client.release(); }
  });
}

