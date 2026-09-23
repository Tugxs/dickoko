import crypto from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import { discordMessageOptions } from './interactive-systems.js';
import { incompleteLibraryValue, validatedAiImage } from './ai-library-draft.js';

const MAX_BYTES = 5 * 1024 * 1024;
const allowedMimes = new Map([
  ['application/pdf', 'pdf'], ['application/zip', 'zip'], ['application/x-zip-compressed', 'zip'], ['text/plain', 'txt'],
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
]);

export function decodeDownloadFile(file) {
  const mime = String(file?.mime || '').toLowerCase();
  const extension = allowedMimes.get(mime);
  const base64 = String(file?.base64 || '');
  const name = String(file?.name || '').trim().replace(/[\\/\r\n<>:"|?*]/g, '-').slice(0, 100);
  if (!extension || !name || !base64 || base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw Object.assign(new Error('اختر ملف PDF أو ZIP أو TXT أو صورة لا تتجاوز 5 ميجابايت.'), { status: 400 });
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) throw Object.assign(new Error('حجم الملف غير صالح.'), { status: 400 });
  const valid = mime === 'application/pdf' ? bytes.toString('ascii', 0, 5) === '%PDF-'
    : extension === 'zip' ? bytes[0] === 0x50 && bytes[1] === 0x4b
    : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
    : mime === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    : !bytes.includes(0);
  if (!valid) throw Object.assign(new Error('محتوى الملف لا يطابق نوعه.'), { status: 400 });
  return { name: name.includes('.') ? name : `${name}.${extension}`, mime, bytes };
}

export async function migrateDownloadCards(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS diskoko_download_storage (
      guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS diskoko_download_cards (
      id UUID PRIMARY KEY, request_id UUID UNIQUE NOT NULL,
      guild_id TEXT NOT NULL, public_channel_id TEXT NOT NULL, public_message_id TEXT NOT NULL,
      storage_channel_id TEXT NOT NULL, storage_message_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
      filename TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export function mountDownloadCards(app, { pool, requireUser, requireWriteAccess, authorizedGuild, discordBotFetch, baseUrl, requirePlanCapacity }) {
  app.post('/api/ai/requests/:id/launch-download', requireUser, requireWriteAccess, async (req, res, next) => {
    const client = await pool.connect();
    let asset = null; let published = null; let createdStorage = null; let committed = false;
    try {
      await client.query('BEGIN');
      const item = (await client.query('SELECT id,guild_id,proposal,attachment,interactive_message_id,interactive_channel_id FROM ai_requests WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
      if (!item || item.proposal?.interactive?.kind !== 'download') throw Object.assign(new Error('لا توجد بطاقة تحميل لهذا الطلب.'), { status: 404 });
      if (item.interactive_message_id) { await client.query('COMMIT'); return res.json({ ok: true, alreadyLaunched: true, messageId: item.interactive_message_id, channelId: item.interactive_channel_id }); }
      if (req.body?.confirmed !== true || !await authorizedGuild(req.user, item.guild_id)) throw Object.assign(new Error('راجع البطاقة وتأكد من صلاحيتك قبل النشر.'), { status: 403 });
      await requirePlanCapacity(req.user, 'changeSetsPerMonth', client);
      const file = decodeDownloadFile(req.body.file);
      const title = String(req.body.title || item.proposal.interactive.title || '').trim().slice(0, 100);
      const description = String(req.body.description || item.proposal.interactive.description || '').trim().slice(0, 800);
      if (incompleteLibraryValue(title) || incompleteLibraryValue(description)) throw Object.assign(new Error('اكتب عنوان البطاقة ووصفها دون خانات بين أقواس.'), { status: 400 });
      const channels = await discordBotFetch(`/guilds/${item.guild_id}/channels`);
      if (!channels.ok || !Array.isArray(channels.data)) throw Object.assign(new Error('تعذر قراءة قنوات السيرفر.'), { status: 502 });
      const publication = channels.data.find(channel => channel.id === String(req.body.channelId || '') && [0, 5].includes(channel.type));
      if (!publication) throw Object.assign(new Error('اختر قناة نشر موجودة في هذا السيرفر.'), { status: 400 });
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`diskoko-files:${item.guild_id}`]);
      let storage = (await client.query('SELECT channel_id FROM diskoko_download_storage WHERE guild_id=$1', [item.guild_id])).rows[0];
      if (!storage || !channels.data.some(channel => channel.id === storage.channel_id)) {
        const bot = await discordBotFetch('/users/@me');
        if (!bot.ok || !bot.data?.id) throw Object.assign(new Error('تعذر تحديد هوية البوت.'), { status: 502 });
        const allow = String(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.AttachFiles | PermissionFlagsBits.ReadMessageHistory);
        const created = await discordBotFetch(`/guilds/${item.guild_id}/channels`, { method: 'POST', body: JSON.stringify({ name: 'diskoko-files', type: 0, permission_overwrites: [
          { id: item.guild_id, type: 0, allow: '0', deny: String(PermissionFlagsBits.ViewChannel) },
          { id: bot.data.id, type: 1, allow, deny: '0' },
        ] }) });
        if (!created.ok || !created.data?.id) throw Object.assign(new Error('تعذر إنشاء قناة ملفات ديسكوكو الخاصة. تحقق من صلاحيات البوت.'), { status: 502 });
        createdStorage = created.data.id;
        storage = { channel_id: created.data.id };
        await client.query('INSERT INTO diskoko_download_storage(guild_id,channel_id) VALUES($1,$2) ON CONFLICT(guild_id) DO UPDATE SET channel_id=EXCLUDED.channel_id', [item.guild_id, storage.channel_id]);
      }
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ content: `ملف بطاقة التحميل: ${title}`, allowed_mentions: { parse: [] } }));
      form.append('files[0]', new Blob([file.bytes], { type: file.mime }), file.name);
      const upload = await discordBotFetch(`/channels/${storage.channel_id}/messages`, { method: 'POST', body: form });
      if (!upload.ok || !upload.data?.id || !upload.data.attachments?.[0]?.id) throw Object.assign(new Error('تعذر رفع الملف إلى Discord. تحقق من صلاحية إرفاق الملفات وحجم الملف.'), { status: 502 });
      asset = { channelId: storage.channel_id, messageId: upload.data.id };
      const id = crypto.randomUUID();
      const card = { embeds: [{ title, description: `${description}\n\n📦 ${file.name} · ${(file.bytes.length / 1024 / 1024).toFixed(2)} MB`, color: 0x9b83f5 }], components: [{ type: 1, components: [{ type: 2, style: 5, label: '⬇ تحميل الملف', url: `${baseUrl}/api/downloads/${id}` }] }], allowed_mentions: { parse: [] } };
      const sent = await discordBotFetch(`/channels/${publication.id}/messages`, discordMessageOptions(card, validatedAiImage(req.body.image) || item.attachment));
      if (!sent.ok || !sent.data?.id) throw Object.assign(new Error('رُفع الملف، لكن تعذر نشر بطاقة التحميل.'), { status: 502 });
      published = { channelId: publication.id, messageId: sent.data.id };
      await client.query('INSERT INTO diskoko_download_cards(id,request_id,guild_id,public_channel_id,public_message_id,storage_channel_id,storage_message_id,attachment_id,filename) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, item.id, item.guild_id, publication.id, sent.data.id, storage.channel_id, upload.data.id, upload.data.attachments[0].id, file.name]);
      await client.query('UPDATE ai_requests SET interactive_message_id=$1,interactive_channel_id=$2,interactive_kind=$3,published_at=NOW() WHERE id=$4', [sent.data.id, publication.id, 'download', item.id]);
      await client.query('COMMIT');
      committed = true;
      res.json({ ok: true, messageId: sent.data.id, channelId: publication.id });
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
        if (published) await discordBotFetch(`/channels/${published.channelId}/messages/${published.messageId}`, { method: 'DELETE' }).catch(() => {});
        if (asset) await discordBotFetch(`/channels/${asset.channelId}/messages/${asset.messageId}`, { method: 'DELETE' }).catch(() => {});
        if (createdStorage) await discordBotFetch(`/channels/${createdStorage}`, { method: 'DELETE' }).catch(() => {});
      }
      next(error);
    } finally { client.release(); }
  });

  app.get('/api/downloads/:id', async (req, res, next) => { try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).end();
    const card = (await pool.query('SELECT storage_channel_id,storage_message_id,attachment_id FROM diskoko_download_cards WHERE id=$1', [req.params.id])).rows[0];
    if (!card) return res.status(404).end();
    const message = await discordBotFetch(`/channels/${card.storage_channel_id}/messages/${card.storage_message_id}`);
    if (!message.ok) return res.status(404).end();
    const attachment = message.data?.attachments?.find(file => file.id === card.attachment_id);
    if (!attachment?.url) return res.status(404).end();
    const url = new URL(attachment.url);
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.discordapp.com') return res.status(502).end();
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').redirect(302, url.toString());
  } catch (error) { next(error); } });
}
