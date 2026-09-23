import crypto from 'node:crypto';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { incompleteLibraryValue, validatedAiImage, validatedAiMedia } from './ai-library-draft.js';
import { readyAiTemplate } from '../ai-library-catalog.js';

const textChannel = channel => channel && [0, 5].includes(channel.type);
const button = (label, customId, disabled = false) => ({ type: 2, style: 1, label, custom_id: customId, disabled });
const row = component => [{ type: 1, components: [component] }];
const cardColor = value => /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? Number.parseInt(value.slice(1), 16) : 0x8b5cf6;
const pollRows = (options, id) => [0, 5].map(start => options.slice(start, start + 5).map((option, offset) => button(`${start + offset + 1}. ${option}`.slice(0, 80), `diskoko:poll-${start + offset}:${id}`))).filter(components => components.length).map(components => ({ type: 1, components }));
const ticketOwnerControls = id => row(button('إغلاق تذكرتي', `diskoko:close:${id}`));

export async function claimSupportTicket(interaction, pool, panelId = null) {
  const ticket = (await pool.query("SELECT t.id,t.panel_id,t.status,t.claimed_by,p.staff_role_id FROM diskoko_tickets t JOIN diskoko_ticket_panels p ON p.id=t.panel_id WHERE t.guild_id=$1 AND t.channel_id=$2 ORDER BY t.created_at DESC LIMIT 1", [interaction.guildId, interaction.channelId])).rows[0];
  if (!ticket || (panelId && ticket.panel_id !== panelId)) { await interaction.editReply('استخدم الأمر داخل قناة تذكرة دعم صالحة.'); return true; }
  const isStaff = ticket.staff_role_id && (interaction.member?.roles?.cache?.has(ticket.staff_role_id) || (Array.isArray(interaction.member?.roles) && interaction.member.roles.includes(ticket.staff_role_id)));
  if (!(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || isStaff)) { await interaction.editReply('استلام التذكرة متاح لمدير السيرفر أو رتبة فريق الدعم المحددة فقط.'); return true; }
  if (ticket.status !== 'open' || ticket.claimed_by) { await interaction.editReply(ticket.claimed_by ? 'استلم أحد أعضاء الفريق هذه التذكرة بالفعل.' : 'هذه التذكرة مغلقة.'); return true; }
  const claimed = await pool.query("UPDATE diskoko_tickets SET claimed_by=$1 WHERE id=$2 AND status='open' AND claimed_by IS NULL RETURNING id", [interaction.user.id, ticket.id]);
  if (!claimed.rowCount) { await interaction.editReply('استلم أحد أعضاء الفريق هذه التذكرة بالفعل.'); return true; }
  await interaction.channel.send({ content: `🛠️ استلم <@${interaction.user.id}> متابعة التذكرة.`, allowedMentions: { users: [interaction.user.id] } });
  await interaction.editReply('استلمت هذه التذكرة.'); return true;
}

export async function reopenSupportTicket(interaction, pool) {
  const ticket = (await pool.query("SELECT t.id,t.panel_id,t.user_id,t.status,p.staff_role_id FROM diskoko_tickets t JOIN diskoko_ticket_panels p ON p.id=t.panel_id WHERE t.guild_id=$1 AND t.channel_id=$2 ORDER BY t.created_at DESC LIMIT 1", [interaction.guildId, interaction.channelId])).rows[0];
  if (!ticket) { await interaction.editReply('استخدم الأمر داخل قناة تذكرة دعم صالحة.'); return true; }
  const isStaff = ticket.staff_role_id && (interaction.member?.roles?.cache?.has(ticket.staff_role_id) || (Array.isArray(interaction.member?.roles) && interaction.member.roles.includes(ticket.staff_role_id)));
  if (!(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || isStaff)) { await interaction.editReply('إعادة فتح التذكرة متاحة لفريق الدعم فقط.'); return true; }
  if (ticket.status !== 'closed') { await interaction.editReply('التذكرة مفتوحة بالفعل.'); return true; }
  const otherOpen = (await pool.query("SELECT channel_id FROM diskoko_tickets WHERE panel_id=$1 AND user_id=$2 AND status='open' LIMIT 1", [ticket.panel_id, ticket.user_id])).rows[0];
  if (otherOpen) { await interaction.editReply(`لصاحب التذكرة تذكرة أخرى مفتوحة: <#${otherOpen.channel_id}>`); return true; }
  await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: true }, { reason: 'Diskoko ticket reopened by support staff' });
  await pool.query("UPDATE diskoko_tickets SET status='open',closed_at=NULL,claimed_by=NULL WHERE id=$1 AND status='closed'", [ticket.id]);
  await interaction.channel.send({ content: 'أُعيد فتح التذكرة ويمكنك متابعة المحادثة مع فريق الدعم.', components: ticketOwnerControls(ticket.panel_id), allowedMentions: { parse: [] } });
  await interaction.editReply('أُعيد فتح التذكرة.'); return true;
}

export async function repairLegacyTicketControls(bot, pool) {
  const tickets = (await pool.query("SELECT panel_id,channel_id,user_id,status FROM diskoko_tickets ORDER BY created_at DESC LIMIT 100")).rows;
  for (const ticket of tickets) {
    try {
      const channel = await bot.channels.fetch(ticket.channel_id);
      if (!channel?.messages?.fetch) continue;
      const recent = await channel.messages.fetch({ limit: 20 });
      const messages = typeof recent.values === 'function' ? [...recent.values()] : [];
      for (const message of messages) {
        if (message.author?.id !== bot.user.id) continue;
        const claimButton = message.components?.some(row => row.components?.some(component => component.customId === `diskoko:claim:${ticket.panel_id}`));
        const reopenButton = message.components?.some(row => row.components?.some(component => component.customId === `diskoko:reopen:${ticket.panel_id}`));
        if (claimButton) await message.edit({ content: `🎫 تذكرة خاصة بـ <@${ticket.user_id}>. اكتب طلبك هنا، وسيتابعك فريق الدعم.`, components: ticket.status === 'open' ? ticketOwnerControls(ticket.panel_id) : [], allowedMentions: { parse: [] } });
        else if (reopenButton) await message.edit({ content: 'أُغلقت التذكرة. سيتولى فريق الدعم الخطوة التالية عند الحاجة.', components: [], allowedMentions: { parse: [] } });
      }
    } catch (error) { console.error('Could not update legacy ticket controls', ticket.channel_id, error.message); }
  }
}

export async function resolvePublicationChannel({ guildId, channels, channelId, createChannelName, allowCreate, discordBotFetch }) {
  let channel = channels.find(entry => entry.id === String(channelId || '') && textChannel(entry));
  if (channel || !allowCreate || !createChannelName) return { channel, createdChannelId: null };
  const name = String(createChannelName).trim().replace(/^#/, '');
  if (!name || name.length > 100 || /[\r\n@]/.test(name)) throw Object.assign(new Error('اكتب اسمًا صالحًا لقناة الدعم'), { status: 400 });
  channel = channels.find(entry => textChannel(entry) && entry.name.toLowerCase() === name.toLowerCase());
  if (channel) return { channel, createdChannelId: null };
  const created = await discordBotFetch(`/guilds/${guildId}/channels`, { method: 'POST', body: JSON.stringify({ name, type: 0 }) });
  if (!created.ok || !created.data?.id) throw Object.assign(new Error('تعذر إنشاء قناة الدعم. تحقق من صلاحية إدارة القنوات للبوت.'), { status: 502 });
  return { channel: created.data, createdChannelId: created.data.id };
}

export function discordMessageOptions(payload, attachment, imagePosition = 'above') {
  if (!attachment?.base64 || !attachment?.mime) return { method: 'POST', body: JSON.stringify(payload) };
  const mime = String(attachment.mime);
  const bytes = Buffer.from(String(attachment.base64), 'base64');
  const video = ['video/mp4', 'video/quicktime'].includes(mime);
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime'].includes(mime) || !bytes.length || bytes.length > (video || mime === 'image/gif' ? 20 * 1024 * 1024 : 350000)) throw Object.assign(new Error('حجم أو نوع الوسائط غير صالح'), { status: 400 });
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'video/quicktime' ? 'mov' : mime.split('/')[1];
  const filename = `diskoko-banner.${extension}`;
  const form = new FormData();
  const imageEmbed = { image: { url: `attachment://${filename}` } };
  const embeds = video ? payload.embeds || [] : imagePosition === 'below' ? [...(payload.embeds || []), imageEmbed] : [imageEmbed, ...(payload.embeds || [])];
  form.append('payload_json', JSON.stringify({ ...payload, embeds }));
  form.append('files[0]', new Blob([bytes], { type: mime }), filename);
  return { method: 'POST', body: form };
}

export function pollMessageOptions(payload, questionImage, optionImages) {
  const images = [questionImage, ...optionImages].map(validatedAiImage);
  if (!images.some(Boolean)) return { method: 'POST', body: JSON.stringify(payload) };
  const form = new FormData();
  const embeds = payload.embeds.map(embed => ({ ...embed }));
  let index = 0;
  images.forEach((image, imageIndex) => {
    if (!image) return;
    const name = `poll-${imageIndex}.${image.mime === 'image/jpeg' ? 'jpg' : image.mime.split('/')[1]}`;
    const key = imageIndex === 0 ? 'image' : 'thumbnail';
    embeds[imageIndex][key] = { url: `attachment://${name}` };
    form.append(`files[${index++}]`, new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime }), name);
  });
  form.append('payload_json', JSON.stringify({ ...payload, embeds }));
  return { method: 'POST', body: form };
}

export async function migrateInteractiveSystems(pool) {
  await pool.query(`
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS interactive_message_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS interactive_channel_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS interactive_kind TEXT;
    CREATE TABLE IF NOT EXISTS diskoko_giveaways (
      id UUID PRIMARY KEY, request_id UUID UNIQUE NOT NULL,
      guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
      prize TEXT NOT NULL, ends_at TIMESTAMPTZ NOT NULL, winner_count INT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', winners JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE diskoko_giveaways ADD COLUMN IF NOT EXISTS announced_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS diskoko_giveaway_entries (
      giveaway_id UUID NOT NULL REFERENCES diskoko_giveaways(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(giveaway_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS diskoko_ticket_panels (
      id UUID PRIMARY KEY, request_id UUID UNIQUE NOT NULL,
      guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
      title TEXT NOT NULL, description TEXT NOT NULL, category_id TEXT, staff_role_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS diskoko_tickets (
      id UUID PRIMARY KEY, panel_id UUID NOT NULL REFERENCES diskoko_ticket_panels(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS diskoko_one_open_ticket ON diskoko_tickets(panel_id,user_id) WHERE status='open';
    ALTER TABLE diskoko_tickets ADD COLUMN IF NOT EXISTS claimed_by TEXT;
    CREATE TABLE IF NOT EXISTS diskoko_polls (
      id UUID PRIMARY KEY, request_id UUID UNIQUE NOT NULL,
      guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
      question TEXT NOT NULL, options JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS diskoko_poll_votes (
      poll_id UUID NOT NULL REFERENCES diskoko_polls(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, option_index INT NOT NULL, voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(poll_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS diskoko_event_panels (
      id UUID PRIMARY KEY, request_id UUID UNIQUE NOT NULL,
      guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, button_label TEXT NOT NULL,
      color INT NOT NULL, signup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS diskoko_event_signups (
      event_id UUID NOT NULL REFERENCES diskoko_event_panels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(event_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS diskoko_welcome_cards (
      guild_id TEXT PRIMARY KEY, request_id UUID NOT NULL,
      channel_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      color INT NOT NULL, banner JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS diskoko_giveaways_due ON diskoko_giveaways(ends_at) WHERE status='active';
    ALTER TABLE diskoko_giveaways DROP CONSTRAINT IF EXISTS diskoko_giveaways_request_id_fkey;
    ALTER TABLE diskoko_ticket_panels DROP CONSTRAINT IF EXISTS diskoko_ticket_panels_request_id_fkey;
    ALTER TABLE diskoko_polls DROP CONSTRAINT IF EXISTS diskoko_polls_request_id_fkey;
  `);
}

export function mountInteractiveSystems(app, { pool, requireUser, requireWriteAccess, authorizedGuild, discordBotFetch, requirePlanCapacity }) {
  app.post('/api/ai/requests/:id/launch-interactive', requireUser, requireWriteAccess, async (req, res, next) => {
    const client = await pool.connect();
    let createdChannelId = null;
    let sentMessageId = null;
    try {
      await client.query('BEGIN');
      const reject = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };
      const item = (await client.query('SELECT id,guild_id,library_mode,library_title,library_category,proposal,attachment,interactive_message_id,interactive_channel_id,interactive_kind FROM ai_requests WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
      if (!item?.proposal?.interactive) return reject(404, 'لا توجد خطة تفاعلية لهذا الطلب');
      if (item.interactive_message_id || item.interactive_kind === 'welcome') { await client.query('COMMIT'); return res.json({ ok: true, alreadyLaunched: true, messageId: item.interactive_message_id, channelId: item.interactive_channel_id }); }
      if (item.library_mode && !readyAiTemplate(item.library_category, item.library_title)) return reject(409, 'هذا القالب أزيل من المكتبة. اختر إجراءً من المكتبة الحالية.');
      if (req.body.confirmed !== true || !await authorizedGuild(req.user, item.guild_id)) return reject(403, 'تأكد من صلاحيتك وراجع الخطة قبل التنفيذ');
      await requirePlanCapacity(req.user, 'changeSetsPerMonth', client);
      const channelsResponse = await discordBotFetch(`/guilds/${item.guild_id}/channels`);
      if (!channelsResponse.ok || !Array.isArray(channelsResponse.data)) throw Object.assign(new Error('تعذر قراءة قنوات السيرفر'), { status: 502 });
      const plan = item.proposal.interactive;
      const image = validatedAiMedia(req.body.media) || validatedAiImage(req.body.image) || item.attachment;
      if (plan.kind === 'tickets') {
        const title = String(req.body.title || plan.title || '').trim();
        const description = String(req.body.description || plan.description || '').trim();
        const roleId = String(req.body.staffRoleId || '');
        const categoryId = String(req.body.categoryId || '');
        if (incompleteLibraryValue(title) || incompleteLibraryValue(description) || !roleId || (categoryId && !channelsResponse.data.some(entry => entry.id === categoryId && entry.type === 4))) return reject(400, 'أكمل عنوان اللوحة ووصفها ورتبة فريق الدعم والتصنيف');
        const roles = await discordBotFetch(`/guilds/${item.guild_id}/roles`);
        if (!roles.ok || !Array.isArray(roles.data) || !roles.data.some(role => role.id === roleId && role.id !== item.guild_id)) return reject(400, 'اختر رتبة فريق دعم من هذا السيرفر');
      }
      const resolved = await resolvePublicationChannel({ guildId: item.guild_id, channels: channelsResponse.data, channelId: req.body.channelId, createChannelName: req.body.createChannelName, allowCreate: plan.kind === 'tickets', discordBotFetch });
      const channel = resolved.channel;
      createdChannelId = resolved.createdChannelId;
      if (!channel) return reject(400, 'اختر قناة نصية أو اطلب إنشاء قناة دعم جديدة');
      const id = crypto.randomUUID();
      let payload;
      if (plan.kind === 'poll') {
        const question = String(req.body.question || plan.question || '').trim().slice(0, 180);
        const options = Array.isArray(req.body.options) ? req.body.options.map(value => String(value || '').trim().slice(0, 70)).filter(Boolean) : plan.options;
        if (incompleteLibraryValue(question) || !Array.isArray(options) || options.length < 2 || options.length > 9 || options.some(incompleteLibraryValue) || new Set(options.map(value => value.toLocaleLowerCase('ar'))).size !== options.length) return reject(400, 'اكتب سؤالًا وخيارين إلى تسعة خيارات مختلفة');
        const optionImages = Array.isArray(req.body.optionImages) ? options.map((_, index) => req.body.optionImages[index] || null) : options.map(() => null);
        const questionImage = req.body.questionImage || null;
        const description = String(req.body.description || '').trim().slice(0, 600);
        payload = { embeds: [{ title: `📊 ${question}`, description: `${description}${description ? '\n\n' : ''}اختر إجابة واحدة. يمكنك تغيير صوتك بالضغط على خيار آخر.`, color: cardColor(req.body.color) }, ...options.map((option, index) => ({ description: `**${index + 1}. ${option}**`, color: cardColor(req.body.color) }))], components: pollRows(options, id), allowed_mentions: { parse: [] } };
        const sent = await discordBotFetch(`/channels/${channel.id}/messages`, pollMessageOptions(payload, questionImage, optionImages));
        if (!sent.ok || !sent.data?.id) throw Object.assign(new Error('لم يتم نشر الاستطلاع. تحقق من صلاحيات البوت في القناة.'), { status: 502 });
        await client.query('INSERT INTO diskoko_polls(id,request_id,guild_id,channel_id,message_id,question,options) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, item.id, item.guild_id, channel.id, sent.data.id, question, JSON.stringify(options)]);
        await client.query('UPDATE ai_requests SET interactive_message_id=$1,interactive_channel_id=$2,interactive_kind=$3,published_at=NOW(),proposal=$5 WHERE id=$4', [sent.data.id, channel.id, plan.kind, item.id, { ...item.proposal, interactive: { ...plan, question, options, color: req.body.color } }]);
        await client.query('COMMIT'); return res.json({ ok: true, messageId: sent.data.id, channelId: channel.id });
      }
      if (plan.kind === 'event') {
        const title = String(req.body.title || plan.title || '').trim().slice(0, 180);
        const description = String(req.body.description || plan.description || '').trim().slice(0, 1000);
        const buttonLabel = String(req.body.buttonLabel || 'سجّل مشاركتك').trim().slice(0, 80);
        const signupEnabled = req.body.signupEnabled === true;
        if (incompleteLibraryValue(title) || incompleteLibraryValue(description) || (signupEnabled && !buttonLabel)) return reject(400, 'أكمل عنوان الفعالية ووصفها واسم زر التسجيل');
        const color = cardColor(req.body.color);
        payload = { embeds: [{ title, description: `${description}${signupEnabled ? '\n\n👥 المسجلون: **0**' : ''}`, color }], ...(signupEnabled ? { components: row(button(buttonLabel, `diskoko:event:${id}`)) } : {}), allowed_mentions: { parse: [] } };
        const sent = await discordBotFetch(`/channels/${channel.id}/messages`, discordMessageOptions(payload, image, req.body.imagePosition));
        if (!sent.ok || !sent.data?.id) throw Object.assign(new Error('لم يُنشر إعلان الفعالية. تحقق من صلاحيات البوت.'), { status: 502 });
        sentMessageId = sent.data.id;
        await client.query('INSERT INTO diskoko_event_panels(id,request_id,guild_id,channel_id,message_id,title,description,button_label,color,signup_enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, item.id, item.guild_id, channel.id, sent.data.id, title, description, buttonLabel, color, signupEnabled]);
        await client.query('UPDATE ai_requests SET interactive_message_id=$1,interactive_channel_id=$2,interactive_kind=$3,published_at=NOW(),proposal=$5 WHERE id=$4', [sent.data.id, channel.id, plan.kind, item.id, { ...item.proposal, interactive: { ...plan, title, description, color: req.body.color, buttonLabel, signupEnabled } }]);
        await client.query('COMMIT'); return res.json({ ok: true, messageId: sent.data.id, channelId: channel.id });
      }
      if (plan.kind === 'welcome') {
        const title = String(req.body.title || plan.title || '').trim().slice(0, 180);
        const description = String(req.body.description || plan.description || '').trim().slice(0, 1000);
        if (incompleteLibraryValue(title) || incompleteLibraryValue(description)) return reject(400, 'أكمل عنوان بطاقة الترحيب ونصها');
        const banner = req.body.image ? validatedAiImage(req.body.image) : null;
        await client.query(`INSERT INTO diskoko_welcome_cards(guild_id,request_id,channel_id,title,description,color,banner) VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(guild_id) DO UPDATE SET request_id=EXCLUDED.request_id,channel_id=EXCLUDED.channel_id,title=EXCLUDED.title,description=EXCLUDED.description,color=EXCLUDED.color,banner=EXCLUDED.banner,updated_at=NOW()`, [item.guild_id, item.id, channel.id, title, description, cardColor(req.body.color), banner ? JSON.stringify(banner) : null]);
        await client.query("UPDATE ai_requests SET interactive_channel_id=$1,interactive_kind='welcome',published_at=NOW(),proposal=$3 WHERE id=$2", [channel.id, item.id, { ...item.proposal, interactive: { ...plan, title, description, color: req.body.color } }]);
        await client.query('COMMIT'); return res.json({ ok: true, activated: true, channelId: channel.id });
      }
      if (plan.kind === 'giveaway') {
        const prize = String(req.body.prize || plan.prize || '').trim().slice(0, 160);
        const title = String(req.body.title || `🎉 جيف آواي: ${prize}`).trim().slice(0, 180);
        const description = String(req.body.description || 'شارك الآن بالضغط على الزر، ونتمنى لك حظًا سعيدًا!').trim().slice(0, 1000);
        const color = /^#[0-9a-fA-F]{6}$/.test(String(req.body.color || '')) ? Number.parseInt(req.body.color.slice(1), 16) : 0x8b5cf6;
        const durationMinutes = Number(req.body.durationMinutes ?? plan.durationMinutes);
        const winnerCount = Number(req.body.winnerCount ?? plan.winnerCount);
        if (incompleteLibraryValue(prize) || incompleteLibraryValue(title) || incompleteLibraryValue(description) || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 43200 || !Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20) return reject(400, 'تحقق من العنوان والنص والجائزة والمدة وعدد الفائزين');
        const endsAt = new Date(Date.now() + durationMinutes * 60000);
        const details = `${description}\n\nالجائزة: **${prize}**\nينتهي: <t:${Math.floor(endsAt.getTime() / 1000)}:R>\nعدد الفائزين: ${winnerCount}`;
        payload = { embeds: [{ title, description: details, color }], components: row(button('🎉 شارك في الجيف آواي', `diskoko:giveaway:${id}`)), allowed_mentions: { parse: [] } };
        const sent = await discordBotFetch(`/channels/${channel.id}/messages`, discordMessageOptions(payload, image, req.body.imagePosition));
        if (!sent.ok || !sent.data?.id) throw Object.assign(new Error('لم يتم نشر الجيف آواي. تحقق من صلاحيات البوت في القناة.'), { status: 502 });
        await client.query('INSERT INTO diskoko_giveaways(id,request_id,guild_id,channel_id,message_id,prize,ends_at,winner_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, item.id, item.guild_id, channel.id, sent.data.id, prize, endsAt, winnerCount]);
        await client.query('UPDATE ai_requests SET interactive_message_id=$1,interactive_channel_id=$2,interactive_kind=$3,published_at=NOW(),proposal=$5 WHERE id=$4', [sent.data.id, channel.id, plan.kind, item.id, { ...item.proposal, interactive: { ...plan, title, description, prize, durationMinutes, winnerCount, color } }]);
        await client.query('COMMIT'); return res.json({ ok: true, messageId: sent.data.id, channelId: channel.id });
      }
      if (plan.kind !== 'tickets') return reject(400, 'نوع الخطة غير مدعوم');
      const title = String(req.body.title || plan.title || '').trim().slice(0, 100);
      const description = String(req.body.description || plan.description || '').trim().slice(0, 800);
      const categoryId = String(req.body.categoryId || '');
      if (incompleteLibraryValue(title) || incompleteLibraryValue(description) || (categoryId && !channelsResponse.data.some(entry => entry.id === categoryId && entry.type === 4))) return reject(400, 'تحقق من عنوان لوحة الدعم ووصفها والتصنيف');
      const roleId = String(req.body.staffRoleId || '');
      payload = { embeds: [{ title: `🎫 ${title}`, description: `${description}\nاضغط الزر لفتح تذكرة خاصة مع فريق الدعم.`, color: cardColor(req.body.color) }], components: row(button('فتح تذكرة دعم', `diskoko:ticket:${id}`)), allowed_mentions: { parse: [] } };
      const sent = await discordBotFetch(`/channels/${channel.id}/messages`, discordMessageOptions(payload, image, req.body.imagePosition));
      if (!sent.ok || !sent.data?.id) throw Object.assign(new Error('لم يتم نشر لوحة الدعم. تحقق من صلاحيات البوت في القناة.'), { status: 502 });
      sentMessageId = sent.data.id;
      await client.query('INSERT INTO diskoko_ticket_panels(id,request_id,guild_id,channel_id,message_id,title,description,category_id,staff_role_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, item.id, item.guild_id, channel.id, sent.data.id, title, description, categoryId || null, roleId || null]);
      await client.query('UPDATE ai_requests SET interactive_message_id=$1,interactive_channel_id=$2,interactive_kind=$3,published_at=NOW() WHERE id=$4', [sent.data.id, channel.id, plan.kind, item.id]);
      await client.query('COMMIT'); res.json({ ok: true, messageId: sent.data.id, channelId: channel.id });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (createdChannelId && !sentMessageId) await discordBotFetch(`/channels/${createdChannelId}`, { method: 'DELETE' }).catch(() => {});
      next(error);
    }
    finally { client.release(); }
  });
}

export async function handleInteractiveButton(interaction, pool) {
  if (!interaction.isButton() || !interaction.customId.startsWith('diskoko:')) return false;
  const [, kind, id] = interaction.customId.split(':');
  if (!/^[0-9a-f-]{36}$/i.test(id || '') || !interaction.guildId) { await interaction.reply({ content: 'هذا الزر غير صالح.', ephemeral: true }); return true; }
  await interaction.deferReply({ ephemeral: true });
  if (kind === 'giveaway') {
    const giveaway = (await pool.query('SELECT guild_id,ends_at,status FROM diskoko_giveaways WHERE id=$1', [id])).rows[0];
    if (!giveaway || giveaway.guild_id !== interaction.guildId || giveaway.status !== 'active' || new Date(giveaway.ends_at) <= new Date()) { await interaction.editReply('انتهى هذا الجيف آواي.'); return true; }
    const result = await pool.query('INSERT INTO diskoko_giveaway_entries(giveaway_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, interaction.user.id]);
    await interaction.editReply(result.rowCount ? 'تم تسجيل مشاركتك 🎉' : 'أنت مشارك بالفعل 🎉'); return true;
  }
  if (/^poll-[0-8]$/.test(kind)) {
    const optionIndex = Number(kind.slice(5));
    const poll = (await pool.query('SELECT guild_id,channel_id,message_id,options FROM diskoko_polls WHERE id=$1', [id])).rows[0];
    if (!poll || poll.guild_id !== interaction.guildId || poll.channel_id !== interaction.channelId || poll.message_id !== interaction.message.id || optionIndex >= poll.options.length) { await interaction.editReply('هذا الاستطلاع غير متاح.'); return true; }
    await pool.query(`INSERT INTO diskoko_poll_votes(poll_id,user_id,option_index) VALUES($1,$2,$3)
      ON CONFLICT(poll_id,user_id) DO UPDATE SET option_index=EXCLUDED.option_index,voted_at=NOW()`, [id, interaction.user.id, optionIndex]);
    const counts = (await pool.query('SELECT option_index,COUNT(*)::int AS total FROM diskoko_poll_votes WHERE poll_id=$1 GROUP BY option_index', [id])).rows;
    const totals = new Map(counts.map(entry => [entry.option_index, entry.total]));
    await interaction.editReply(`سُجّل صوتك لخيار «${poll.options[optionIndex]}».\n${poll.options.map((option, index) => `${option}: ${totals.get(index) || 0}`).join('\n')}`); return true;
  }
  if (kind === 'event') {
    const event = (await pool.query('SELECT guild_id,channel_id,message_id,title,description,button_label,color,signup_enabled FROM diskoko_event_panels WHERE id=$1', [id])).rows[0];
    if (!event || !event.signup_enabled || event.guild_id !== interaction.guildId || event.channel_id !== interaction.channelId || event.message_id !== interaction.message.id) { await interaction.editReply('التسجيل لهذه الفعالية غير متاح.'); return true; }
    const joined = await pool.query('INSERT INTO diskoko_event_signups(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, interaction.user.id]);
    if (!joined.rowCount) await pool.query('DELETE FROM diskoko_event_signups WHERE event_id=$1 AND user_id=$2', [id, interaction.user.id]);
    const count = Number((await pool.query('SELECT COUNT(*)::int AS total FROM diskoko_event_signups WHERE event_id=$1', [id])).rows[0].total);
    const embeds = interaction.message.embeds.map(embed => embed.toJSON());
    const cardIndex = embeds.findIndex(embed => embed.title === event.title);
    if (cardIndex < 0) { await interaction.editReply('تعذر تحديث بطاقة الفعالية.'); return true; }
    embeds[cardIndex] = { ...embeds[cardIndex], description: `${event.description}\n\n👥 المسجلون: **${count}**` };
    await interaction.message.edit({ embeds });
    await interaction.editReply(joined.rowCount ? 'تم تسجيل مشاركتك في الفعالية.' : 'أُلغي تسجيلك في الفعالية.'); return true;
  }
  if (kind === 'ticket') {
    const panel = (await pool.query('SELECT * FROM diskoko_ticket_panels WHERE id=$1', [id])).rows[0];
    if (!panel || panel.guild_id !== interaction.guildId) { await interaction.editReply('لوحة الدعم غير متاحة.'); return true; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [id, interaction.user.id]);
      const existing = (await client.query("SELECT channel_id FROM diskoko_tickets WHERE panel_id=$1 AND user_id=$2 AND status='open'", [id, interaction.user.id])).rows[0];
      if (existing) { await client.query('COMMIT'); await interaction.editReply(`لديك تذكرة مفتوحة: <#${existing.channel_id}>`); return true; }
      const botId = interaction.client.user.id;
      const overwrites = [
        { id: interaction.guildId, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ];
      if (panel.staff_role_id) overwrites.push({ id: panel.staff_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      const channel = await interaction.guild.channels.create({ name: `تذكرة-${interaction.user.username}`.slice(0, 90), type: ChannelType.GuildText, parent: panel.category_id || undefined, permissionOverwrites: overwrites, reason: 'Diskoko support ticket' });
      try {
        await client.query('INSERT INTO diskoko_tickets(id,panel_id,guild_id,user_id,channel_id) VALUES($1,$2,$3,$4,$5)', [crypto.randomUUID(), id, interaction.guildId, interaction.user.id, channel.id]);
        await client.query('COMMIT');
      } catch (error) { await channel.delete('Ticket creation could not be saved').catch(() => {}); throw error; }
      await channel.send({ content: `🎫 تذكرة خاصة بـ <@${interaction.user.id}>. اكتب طلبك هنا، وسيتابعك فريق الدعم.`, components: ticketOwnerControls(id), allowedMentions: { users: [interaction.user.id] } });
      await interaction.editReply(`فُتحت تذكرتك: <#${channel.id}>`); return true;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  if (kind === 'close') {
    const ticket = (await pool.query("SELECT t.id,t.user_id,t.status,p.staff_role_id FROM diskoko_tickets t JOIN diskoko_ticket_panels p ON p.id=t.panel_id WHERE t.panel_id=$1 AND t.guild_id=$2 AND t.channel_id=$3 ORDER BY t.created_at DESC LIMIT 1", [id, interaction.guildId, interaction.channelId])).rows[0];
    if (!ticket || ticket.status !== 'open') { await interaction.editReply('هذه التذكرة مغلقة بالفعل.'); return true; }
    const isStaff = ticket.staff_role_id && (interaction.member?.roles?.cache?.has(ticket.staff_role_id) || (Array.isArray(interaction.member?.roles) && interaction.member.roles.includes(ticket.staff_role_id)));
    if (ticket.user_id !== interaction.user.id && !isStaff && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.editReply('يمكن لصاحب التذكرة أو فريق الدعم إغلاقها.'); return true; }
    await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }, { reason: 'Diskoko ticket closed' });
    await pool.query("UPDATE diskoko_tickets SET status='closed',closed_at=NOW() WHERE id=$1 AND status='open'", [ticket.id]);
    await interaction.channel.send({ content: 'أُغلقت التذكرة. سيتولى فريق الدعم الخطوة التالية عند الحاجة.', allowedMentions: { parse: [] } });
    await interaction.editReply('أُغلقت التذكرة. ستبقى المحادثة للرجوع إليها.'); return true;
  }
  if (kind === 'claim') {
    return claimSupportTicket(interaction, pool, id);
  }
  if (kind === 'reopen') {
    await interaction.editReply('هذا الزر القديم لم يعد متاحًا. يتولى فريق الدعم إعادة فتح التذكرة.'); return true;
  }
  await interaction.editReply('هذا الزر غير معروف.'); return true;
}

export async function sendWelcomeCard(member, pool) {
  if (member.user?.bot) return false;
  const card = (await pool.query('SELECT channel_id,title,description,color,banner FROM diskoko_welcome_cards WHERE guild_id=$1', [member.guild.id])).rows[0];
  if (!card) return false;
  const channel = await member.guild.channels.fetch(card.channel_id);
  if (!channel?.isTextBased()) return false;
  const memberName = member.displayName || member.user.username;
  const description = card.description.replaceAll('{member}', `<@${member.id}>`).replaceAll('{name}', memberName);
  const embed = { title: card.title.replaceAll('{name}', memberName), description, color: card.color, thumbnail: { url: member.displayAvatarURL({ size: 256 }) }, footer: { text: member.guild.name } };
  const banner = card.banner;
  if (banner?.base64 && banner?.mime) {
    const filename = `welcome.${banner.mime === 'image/jpeg' ? 'jpg' : banner.mime.split('/')[1]}`;
    embed.image = { url: `attachment://${filename}` };
    await channel.send({ embeds: [embed], files: [{ attachment: Buffer.from(banner.base64, 'base64'), name: filename }], allowedMentions: { users: [member.id] } });
  } else await channel.send({ embeds: [embed], allowedMentions: { users: [member.id] } });
  return true;
}

export async function processDueGiveaways({ pool, discordBotFetch }) {
    try {
      const due = (await pool.query("SELECT id FROM diskoko_giveaways WHERE (status='active' AND ends_at<=NOW()) OR (status='ended' AND announced_at IS NULL) ORDER BY ends_at LIMIT 10")).rows;
      for (const { id } of due) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const giveaway = (await client.query("SELECT * FROM diskoko_giveaways WHERE id=$1 AND ((status='active' AND ends_at<=NOW()) OR (status='ended' AND announced_at IS NULL)) FOR UPDATE SKIP LOCKED", [id])).rows[0];
          if (!giveaway) { await client.query('ROLLBACK'); continue; }
          let winners = Array.isArray(giveaway.winners) ? giveaway.winners : [];
          if (giveaway.status === 'active') {
            const entrants = (await client.query('SELECT user_id FROM diskoko_giveaway_entries WHERE giveaway_id=$1', [id])).rows.map(row => row.user_id);
            winners = [];
            while (entrants.length && winners.length < giveaway.winner_count) winners.push(entrants.splice(crypto.randomInt(entrants.length), 1)[0]);
            await client.query("UPDATE diskoko_giveaways SET status='ended',winners=$1 WHERE id=$2", [JSON.stringify(winners), id]);
          }
          await client.query('COMMIT');
          const content = winners.length ? `🎉 انتهى جيف آواي **${giveaway.prize}**!\nالفائزون: ${winners.map(user => `<@${user}>`).join('، ')}` : `انتهى جيف آواي **${giveaway.prize}** دون مشاركين.`;
          const edited = await discordBotFetch(`/channels/${giveaway.channel_id}/messages/${giveaway.message_id}`, { method: 'PATCH', body: JSON.stringify({ content, components: row(button('انتهى الجيف آواي', `diskoko:giveaway:${id}`, true)), allowed_mentions: { users: winners } }) });
          if (edited.ok) await pool.query('UPDATE diskoko_giveaways SET announced_at=NOW() WHERE id=$1 AND announced_at IS NULL', [id]);
          else console.error('Could not publish giveaway results; will retry:', id, edited.status);
        } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('Giveaway close failed:', error.message); }
        finally { client.release(); }
      }
    } catch (error) { console.error('Giveaway runner failed:', error.message); }
}

export function startGiveawayRunner({ pool, discordBotFetch }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processDueGiveaways({ pool, discordBotFetch }); }
    finally { running = false; }
  };
  setInterval(tick, 60000).unref(); void tick();
}

