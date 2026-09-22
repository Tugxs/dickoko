import crypto from 'node:crypto';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

const textChannel = channel => channel && [0, 5].includes(channel.type);
const button = (label, customId, disabled = false) => ({ type: 2, style: 1, label, custom_id: customId, disabled });
const row = component => [{ type: 1, components: [component] }];

function discordMessageOptions(payload, attachment) {
  if (!attachment?.base64 || !attachment?.mime) return { method: 'POST', body: JSON.stringify(payload) };
  const mime = String(attachment.mime);
  const bytes = Buffer.from(String(attachment.base64), 'base64');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !bytes.length || bytes.length > 350000) throw Object.assign(new Error('صورة البنر غير صالحة أو كبيرة جدًا'), { status: 400 });
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  const filename = `diskoko-banner.${extension}`;
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ ...payload, embeds: [{ image: { url: `attachment://${filename}` } }] }));
  form.append('files[0]', new Blob([bytes], { type: mime }), filename);
  return { method: 'POST', body: form };
}

export async function migrateInteractiveSystems(pool) {
  await pool.query(`
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS interactive_message_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS interactive_channel_id TEXT;
    ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS interactive_kind TEXT;
    CREATE TABLE IF NOT EXISTS diskoko_giveaways (
      id UUID PRIMARY KEY, request_id UUID UNIQUE NOT NULL REFERENCES ai_requests(id) ON DELETE CASCADE,
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
      id UUID PRIMARY KEY, request_id UUID UNIQUE NOT NULL REFERENCES ai_requests(id) ON DELETE CASCADE,
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
    CREATE INDEX IF NOT EXISTS diskoko_giveaways_due ON diskoko_giveaways(ends_at) WHERE status='active';
  `);
}

export function mountInteractiveSystems(app, { pool, requireUser, requireWriteAccess, authorizedGuild, discordBotFetch }) {
  app.post('/api/ai/requests/:id/launch-interactive', requireUser, requireWriteAccess, async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reject = async (status, error) => { await client.query('ROLLBACK'); return res.status(status).json({ error }); };
      const item = (await client.query('SELECT id,guild_id,proposal,attachment,interactive_message_id,interactive_channel_id,interactive_kind FROM ai_requests WHERE id=$1 AND user_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
      if (!item?.proposal?.interactive) return reject(404, 'لا توجد خطة تفاعلية لهذا الطلب');
      if (item.interactive_message_id) { await client.query('COMMIT'); return res.json({ ok: true, alreadyLaunched: true, messageId: item.interactive_message_id, channelId: item.interactive_channel_id }); }
      if (req.body.confirmed !== true || !await authorizedGuild(req.user, item.guild_id)) return reject(403, 'تأكد من صلاحيتك وراجع الخطة قبل التنفيذ');
      const channelsResponse = await discordBotFetch(`/guilds/${item.guild_id}/channels`);
      if (!channelsResponse.ok || !Array.isArray(channelsResponse.data)) throw Object.assign(new Error('تعذر قراءة قنوات السيرفر'), { status: 502 });
      const channel = channelsResponse.data.find(entry => entry.id === String(req.body.channelId || '') && textChannel(entry));
      if (!channel) return reject(400, 'اختر قناة نصية من هذا السيرفر');
      const plan = item.proposal.interactive;
      const id = crypto.randomUUID();
      let payload;
      if (plan.kind === 'giveaway') {
        const prize = String(req.body.prize || plan.prize || '').trim().slice(0, 160);
        const durationMinutes = Number(req.body.durationMinutes ?? plan.durationMinutes);
        const winnerCount = Number(req.body.winnerCount ?? plan.winnerCount);
        if (!prize || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 43200 || !Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20) return reject(400, 'تحقق من الجائزة والمدة وعدد الفائزين');
        const endsAt = new Date(Date.now() + durationMinutes * 60000);
        payload = { content: `🎉 **جيف آواي: ${prize}**\nينتهي: <t:${Math.floor(endsAt.getTime() / 1000)}:R>\nعدد الفائزين: ${winnerCount}\nاضغط الزر للمشاركة.`, components: row(button('🎉 شارك في الجيف آواي', `diskoko:giveaway:${id}`)), allowed_mentions: { parse: [] } };
        const sent = await discordBotFetch(`/channels/${channel.id}/messages`, discordMessageOptions(payload, item.attachment));
        if (!sent.ok || !sent.data?.id) throw Object.assign(new Error('لم يتم نشر الجيف آواي. تحقق من صلاحيات البوت في القناة.'), { status: 502 });
        await client.query('INSERT INTO diskoko_giveaways(id,request_id,guild_id,channel_id,message_id,prize,ends_at,winner_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, item.id, item.guild_id, channel.id, sent.data.id, prize, endsAt, winnerCount]);
        await client.query('UPDATE ai_requests SET interactive_message_id=$1,interactive_channel_id=$2,interactive_kind=$3 WHERE id=$4', [sent.data.id, channel.id, plan.kind, item.id]);
        await client.query('COMMIT'); return res.json({ ok: true, messageId: sent.data.id, channelId: channel.id });
      }
      if (plan.kind !== 'tickets') return reject(400, 'نوع الخطة غير مدعوم');
      const title = String(req.body.title || plan.title || '').trim().slice(0, 100);
      const description = String(req.body.description || plan.description || '').trim().slice(0, 800);
      const categoryId = String(req.body.categoryId || '');
      if (!title || !description || (categoryId && !channelsResponse.data.some(entry => entry.id === categoryId && entry.type === 4))) return reject(400, 'تحقق من عنوان لوحة الدعم ووصفها والتصنيف');
      const roleId = String(req.body.staffRoleId || '');
      if (!roleId) return reject(400, 'اختر رتبة فريق الدعم التي ستطّلع على التذاكر');
      { const roles = await discordBotFetch(`/guilds/${item.guild_id}/roles`); if (!roles.ok || !Array.isArray(roles.data) || !roles.data.some(role => role.id === roleId && role.id !== item.guild_id)) return reject(400, 'اختر رتبة فريق دعم من هذا السيرفر'); }
      payload = { content: `🎫 **${title}**\n${description}\nاضغط الزر لفتح تذكرة خاصة مع فريق الدعم.`, components: row(button('فتح تذكرة دعم', `diskoko:ticket:${id}`)), allowed_mentions: { parse: [] } };
      const sent = await discordBotFetch(`/channels/${channel.id}/messages`, discordMessageOptions(payload, item.attachment));
      if (!sent.ok || !sent.data?.id) throw Object.assign(new Error('لم يتم نشر لوحة الدعم. تحقق من صلاحيات البوت في القناة.'), { status: 502 });
      await client.query('INSERT INTO diskoko_ticket_panels(id,request_id,guild_id,channel_id,message_id,title,description,category_id,staff_role_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, item.id, item.guild_id, channel.id, sent.data.id, title, description, categoryId || null, roleId || null]);
      await client.query('UPDATE ai_requests SET interactive_message_id=$1,interactive_channel_id=$2,interactive_kind=$3 WHERE id=$4', [sent.data.id, channel.id, plan.kind, item.id]);
      await client.query('COMMIT'); res.json({ ok: true, messageId: sent.data.id, channelId: channel.id });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); next(error); }
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
      await channel.send({ content: `🎫 تذكرة خاصة بـ <@${interaction.user.id}>. اكتب طلبك هنا، وسيطلع عليه فريق الدعم.`, components: row(button('إغلاق التذكرة', `diskoko:close:${id}`)), allowedMentions: { users: [interaction.user.id] } });
      await interaction.editReply(`فُتحت تذكرتك: <#${channel.id}>`); return true;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  if (kind === 'close') {
    const ticket = (await pool.query("SELECT id,user_id,status FROM diskoko_tickets WHERE panel_id=$1 AND guild_id=$2 AND channel_id=$3 ORDER BY created_at DESC LIMIT 1", [id, interaction.guildId, interaction.channelId])).rows[0];
    if (!ticket || ticket.status !== 'open') { await interaction.editReply('هذه التذكرة مغلقة بالفعل.'); return true; }
    if (ticket.user_id !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.editReply('يمكن لصاحب التذكرة أو مدير السيرفر إغلاقها.'); return true; }
    await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }, { reason: 'Diskoko ticket closed' });
    await pool.query("UPDATE diskoko_tickets SET status='closed',closed_at=NOW() WHERE id=$1 AND status='open'", [ticket.id]);
    await interaction.editReply('أُغلقت التذكرة. ستبقى المحادثة للرجوع إليها.'); return true;
  }
  await interaction.editReply('هذا الزر غير معروف.'); return true;
}

export function startGiveawayRunner({ pool, discordBotFetch }) {
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      const due = (await pool.query("SELECT id FROM diskoko_giveaways WHERE status='active' AND ends_at<=NOW() ORDER BY ends_at LIMIT 10")).rows;
      for (const { id } of due) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const giveaway = (await client.query("SELECT * FROM diskoko_giveaways WHERE id=$1 AND status='active' AND ends_at<=NOW() FOR UPDATE SKIP LOCKED", [id])).rows[0];
          if (!giveaway) { await client.query('ROLLBACK'); continue; }
          const entrants = (await client.query('SELECT user_id FROM diskoko_giveaway_entries WHERE giveaway_id=$1', [id])).rows.map(row => row.user_id);
          const winners = [];
          while (entrants.length && winners.length < giveaway.winner_count) winners.push(entrants.splice(crypto.randomInt(entrants.length), 1)[0]);
          await client.query("UPDATE diskoko_giveaways SET status='ended',winners=$1 WHERE id=$2", [JSON.stringify(winners), id]);
          await client.query('COMMIT');
          const edited = await discordBotFetch(`/channels/${giveaway.channel_id}/messages/${giveaway.message_id}`, { method: 'PATCH', body: JSON.stringify({ components: row(button('انتهى الجيف آواي', `diskoko:giveaway:${id}`, true)) }) });
          if (!edited.ok) console.error('Could not disable giveaway button:', id, edited.status);
          const announced = await discordBotFetch(`/channels/${giveaway.channel_id}/messages`, { method: 'POST', body: JSON.stringify({ content: winners.length ? `🎉 انتهى جيف آواي **${giveaway.prize}**! الفائزون: ${winners.map(user => `<@${user}>`).join('، ')}` : `انتهى جيف آواي **${giveaway.prize}** دون مشاركين.`, allowed_mentions: { users: winners } }) });
          if (announced.ok) await pool.query('UPDATE diskoko_giveaways SET announced_at=NOW() WHERE id=$1', [id]);
          else console.error('Could not announce giveaway:', id, announced.status);
        } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('Giveaway close failed:', error.message); }
        finally { client.release(); }
      }
    } catch (error) { console.error('Giveaway runner failed:', error.message); }
    finally { running = false; }
  };
  setInterval(tick, 60000).unref(); void tick();
}

