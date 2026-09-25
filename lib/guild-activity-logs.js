import { Events } from 'discord.js';

const EVENT_LABELS = {
  message_create: 'رسالة جديدة', message_update: 'تعديل رسالة', message_delete: 'حذف رسالة',
  voice_join: 'دخول صوتي', voice_leave: 'خروج صوتي',
};

export async function migrateGuildActivityLogs(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS guild_activity_log_routes (
    guild_id TEXT PRIMARY KEY, publishing_bot_id TEXT NOT NULL,
    config JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

export function activityLogDestinations(config, event, sourceId) {
  if (!config?.events?.includes(event) || !sourceId) return [];
  if (config.mode !== 'routed') return config.targetId && config.targetId !== sourceId ? [config.targetId] : [];
  return [...new Set((config.routes || []).filter(rule => rule.sourceIds?.includes(sourceId) && rule.targetId && rule.targetId !== sourceId).map(rule => rule.targetId))];
}

export function registerGuildActivityLogs(client, pool, onlyGuildId = null) {
  const cached = new Map();
  const queues = new Map();
  const paused = new Map();
  let timer = null;
  async function configFor(guildId) {
    const hit = cached.get(guildId);
    if (hit?.until > Date.now()) return hit.value;
    const value = pool.query('SELECT publishing_bot_id,config FROM guild_activity_log_routes WHERE guild_id=$1', [guildId])
      .then(result => result.rows[0]?.publishing_bot_id === client.user?.id ? result.rows[0].config : null)
      .catch(error => { cached.delete(guildId); throw error; });
    cached.set(guildId, { value, until: Date.now() + 15_000 });
    return value;
  }
  async function flush() {
    timer = null;
    if (!client.isReady()) { queues.clear(); return; }
    for (const [key, queue] of [...queues].slice(0, 5)) {
      if ((paused.get(key) || 0) > Date.now()) { queues.delete(key); continue; }
      if (!queue.lines.length && !queue.dropped) { queues.delete(key); continue; }
      const lines = queue.lines.splice(0, 12);
      const dropped = queue.dropped; queue.dropped = 0;
      try {
        const channel = await client.channels.fetch(queue.targetId).catch(() => null);
        if (!channel?.isTextBased() || channel.guildId !== queue.guildId) throw Error('قناة السجل غير متاحة');
        await channel.send({ content: `**سجل النشاط**\n${lines.join('\n')}${dropped ? `\n… و${dropped} أحداث إضافية خلال الازدحام.` : ''}`.slice(0, 1900), allowedMentions: { parse: [] } });
        queue.failures = 0;
      } catch (error) {
        queue.lines.unshift(...lines);
        queue.dropped += dropped;
        queue.failures = (queue.failures || 0) + 1;
        console.warn('Activity log delivery delayed', { guildId: queue.guildId, error: error.message });
        if (queue.failures >= 3) { paused.set(key, Date.now() + 300_000); queues.delete(key); }
      }
      if (!queue.lines.length && !queue.dropped) queues.delete(key);
    }
    if (queues.size) schedule();
  }
  function schedule() { if (!timer) { timer = setTimeout(() => void flush(), 10_000); timer.unref?.(); } }
  async function capture({ guildId, sourceId, event, actorId, messageId }) {
    if (!guildId || (onlyGuildId && guildId !== onlyGuildId)) return;
    try {
      const config = await configFor(guildId);
      for (const targetId of activityLogDestinations(config, event, sourceId)) {
        const key = `${guildId}:${targetId}`;
        if ((paused.get(key) || 0) > Date.now()) continue;
        let queue = queues.get(key);
        if (!queue) { queue = { guildId, targetId, lines: [], dropped: 0 }; queues.set(key, queue); }
        const link = messageId && event !== 'message_delete' ? ` · https://discord.com/channels/${guildId}/${sourceId}/${messageId}` : '';
        const line = `• ${EVENT_LABELS[event]} في <#${sourceId}>${actorId ? ` بواسطة <@${actorId}>` : ''}${link}`;
        if (queue.lines.length < 120) queue.lines.push(line); else queue.dropped++;
        schedule();
      }
    } catch (error) { console.warn('Activity log event skipped', { guildId, error: error.message }); }
  }
  client.on(Events.MessageCreate, message => { if (!message.author?.bot) void capture({ guildId: message.guildId, sourceId: message.channelId, event: 'message_create', actorId: message.author?.id, messageId: message.id }); });
  client.on(Events.MessageUpdate, (_old, message) => { if (!message.author?.bot) void capture({ guildId: message.guildId, sourceId: message.channelId, event: 'message_update', actorId: message.author?.id, messageId: message.id }); });
  client.on(Events.MessageDelete, message => { if (!message.author?.bot) void capture({ guildId: message.guildId, sourceId: message.channelId, event: 'message_delete', actorId: message.author?.id, messageId: message.id }); });
  client.on(Events.VoiceStateUpdate, (before, after) => {
    if (before.channelId === after.channelId || before.member?.user?.bot || after.member?.user?.bot) return;
    const guildId = after.guild?.id || before.guild?.id;
    if (before.channelId) void capture({ guildId, sourceId: before.channelId, event: 'voice_leave', actorId: after.id || before.id });
    if (after.channelId) void capture({ guildId, sourceId: after.channelId, event: 'voice_join', actorId: after.id || before.id });
  });
  client.once(Events.ClientReady, () => cached.clear());
  client.on(Events.ShardDisconnect, () => { if (timer) clearTimeout(timer); timer = null; queues.clear(); });
}
