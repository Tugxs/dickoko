import test from 'node:test';
import assert from 'node:assert/strict';
import { claimSupportTicket, discordMessageOptions, handleInteractiveButton, pollMessageOptions, processDueGiveaways, reopenSupportTicket, repairLegacyTicketControls, resolvePublicationChannel, sendWelcomeCard } from '../lib/interactive-systems.js';

test('only support role or server manager can claim a ticket', async () => {
  const replies = [];
  let claims = 0;
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT t.id')) return { rows: [{ id: 'ticket', panel_id: 'panel', status: 'open', claimed_by: null, staff_role_id: 'support' }] };
    if (sql.startsWith('UPDATE diskoko_tickets SET claimed_by')) { claims++; return { rowCount: 1 }; }
    throw Error(sql);
  } };
  const interaction = { guildId: 'guild', channelId: 'ticket-channel', user: { id: 'customer' }, member: { roles: { cache: new Map() } }, memberPermissions: { has: () => false }, editReply: async text => replies.push(text), channel: { send: async () => {} } };
  await claimSupportTicket(interaction, pool);
  assert.equal(claims, 0);
  assert.match(replies[0], /فريق الدعم/);
  interaction.user.id = 'agent'; interaction.member.roles.cache.set('support', {});
  await claimSupportTicket(interaction, pool);
  assert.equal(claims, 1);
});

test('old ticket messages lose the visible claim button', async () => {
  const edits = [];
  const message = { author: { id: 'bot' }, components: [{ components: [{ customId: 'diskoko:claim:panel' }, { customId: 'diskoko:close:panel' }] }], edit: async payload => edits.push(payload) };
  const bot = { user: { id: 'bot' }, channels: { fetch: async () => ({ messages: { fetch: async () => new Map([['intro', message]]) } }) } };
  const pool = { query: async () => ({ rows: [{ panel_id: 'panel', channel_id: 'ticket-channel', user_id: 'customer', status: 'open' }] }) };
  await repairLegacyTicketControls(bot, pool);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].components[0].components[0].custom_id, 'diskoko:close:panel');
});

test('old closed tickets lose the customer reopen button', async () => {
  const edits = [];
  const message = { author: { id: 'bot' }, components: [{ components: [{ customId: 'diskoko:reopen:panel' }] }], edit: async payload => edits.push(payload) };
  const bot = { user: { id: 'bot' }, channels: { fetch: async () => ({ messages: { fetch: async () => new Map([['closed', message]]) } }) } };
  const pool = { query: async () => ({ rows: [{ panel_id: 'panel', channel_id: 'ticket-channel', user_id: 'customer', status: 'closed' }] }) };
  await repairLegacyTicketControls(bot, pool);
  assert.deepEqual(edits[0].components, []);
  assert.doesNotMatch(edits[0].content, /إعادة فتح/);
});

test('customer cannot reopen a closed ticket; support staff can', async () => {
  const replies = []; let reopened = 0;
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT t.id')) return { rows: [{ id: 'ticket', panel_id: 'panel', user_id: 'customer', status: 'closed', staff_role_id: 'support' }] };
    if (sql.startsWith('SELECT channel_id')) return { rows: [] };
    if (sql.startsWith('UPDATE diskoko_tickets SET status')) { reopened++; return { rowCount: 1 }; }
    throw Error(sql);
  } };
  const interaction = { guildId: 'guild', channelId: 'ticket-channel', user: { id: 'customer' }, member: { roles: { cache: new Map() } }, memberPermissions: { has: () => false }, editReply: async text => replies.push(text), channel: { permissionOverwrites: { edit: async () => {} }, send: async () => {} } };
  await reopenSupportTicket(interaction, pool);
  assert.equal(reopened, 0);
  interaction.user.id = 'agent'; interaction.member.roles.cache.set('support', {});
  await reopenSupportTicket(interaction, pool);
  assert.equal(reopened, 1);
});

test('support panel reuses an existing channel and creates a missing one only after confirmation', async () => {
  const calls = [];
  const discordBotFetch = async (path, options) => { calls.push({ path, options }); return { ok: true, data: { id: 'new-support', name: 'الدعم', type: 0 } }; };
  const existing = await resolvePublicationChannel({ guildId: 'guild', channels: [{ id: 'support', name: 'الدعم', type: 0 }], createChannelName: 'الدعم', allowCreate: true, discordBotFetch });
  assert.equal(existing.channel.id, 'support');
  assert.equal(existing.createdChannelId, null);
  assert.equal(calls.length, 0);
  const created = await resolvePublicationChannel({ guildId: 'guild', channels: [], createChannelName: 'الدعم', allowCreate: true, discordBotFetch });
  assert.equal(created.createdChannelId, 'new-support');
  assert.equal(calls[0].path, '/guilds/guild/channels');
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: 'الدعم', type: 0 });
  const noCreate = await resolvePublicationChannel({ guildId: 'guild', channels: [], createChannelName: 'الدعم', allowCreate: false, discordBotFetch });
  assert.equal(noCreate.channel, undefined);
  assert.equal(calls.length, 1);
});

test('ticket banner renders before the support description and keeps the open button', () => {
  const options = discordMessageOptions({ content: '🎫 **الدعم**', embeds: [{ description: 'افتح تذكرة' }], components: [{ type: 1, components: [{ type: 2, label: 'فتح تذكرة' }] }] }, { mime: 'image/png', base64: 'aGVsbG8=' });
  const payload = JSON.parse(options.body.get('payload_json'));
  assert.equal(payload.embeds[0].image.url, 'attachment://diskoko-banner.png');
  assert.equal(payload.embeds[1].description, 'افتح تذكرة');
  const below = discordMessageOptions({ embeds: [{ description: 'افتح تذكرة' }] }, { mime: 'image/png', base64: 'aGVsbG8=' }, 'below');
  const belowPayload = JSON.parse(below.body.get('payload_json'));
  assert.equal(belowPayload.embeds[0].description, 'افتح تذكرة');
  assert.equal(belowPayload.embeds[1].image.url, 'attachment://diskoko-banner.png');
  assert.equal(payload.components[0].components[0].label, 'فتح تذكرة');
});

test('giveaway GIF remains animated and video is attached without an invalid image embed', () => {
  const message = { embeds: [{ title: 'مسابقة', description: 'شارك الآن' }], components: [{ type: 1, components: [{ type: 2, label: 'مشاركة' }] }] };
  const gif = discordMessageOptions(message, { mime: 'image/gif', base64: Buffer.from('GIF89a\0\0').toString('base64') });
  const gifPayload = JSON.parse(gif.body.get('payload_json'));
  assert.equal(gifPayload.embeds[0].image.url, 'attachment://diskoko-banner.gif');
  assert.equal(gif.body.get('files[0]').type, 'image/gif');
  const video = discordMessageOptions(message, { mime: 'video/mp4', base64: Buffer.from('\0\0\0\x18ftypisom').toString('base64') });
  const videoPayload = JSON.parse(video.body.get('payload_json'));
  assert.equal(videoPayload.embeds.length, 1);
  assert.equal(videoPayload.embeds[0].title, 'مسابقة');
  assert.equal(video.body.get('files[0]').type, 'video/mp4');
});

test('poll question and option images attach to the matching embeds', () => {
  const png = { mime: 'image/png', base64: Buffer.from('89504e470d0a1a0a0000', 'hex').toString('base64') };
  const message = { embeds: [{ title: 'السؤال' }, { description: 'الخيار الأول' }, { description: 'الخيار الثاني' }], components: [] };
  const result = pollMessageOptions(message, png, [png, null]);
  const payload = JSON.parse(result.body.get('payload_json'));
  assert.equal(payload.embeds[0].image.url, 'attachment://poll-0.png');
  assert.equal(payload.embeds[1].thumbnail.url, 'attachment://poll-1.png');
  assert.equal(payload.embeds[2].thumbnail, undefined);
  assert.equal(result.body.get('files[0]').type, 'image/png');
  assert.equal(result.body.get('files[1]').type, 'image/png');
});

test('event sign-up edits the event card even when an image embed comes first', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const edits = []; const replies = [];
  const interaction = { isButton: () => true, customId: `diskoko:event:${id}`, guildId: 'g', channelId: 'c', user: { id: 'u' }, message: { id: 'm', embeds: [{ toJSON: () => ({ image: { url: 'https://example.com/banner.png' } }) }, { toJSON: () => ({ title: 'فعالية', description: 'الموعد' }) }], edit: async payload => edits.push(payload) }, deferReply: async () => {}, editReply: async reply => replies.push(reply) };
  const pool = { query: async sql => {
    if (sql.startsWith('SELECT guild_id')) return { rows: [{ guild_id: 'g', channel_id: 'c', message_id: 'm', title: 'فعالية', description: 'الموعد', signup_enabled: true }] };
    if (sql.startsWith('INSERT INTO diskoko_event_signups')) return { rowCount: 1 };
    if (sql.startsWith('SELECT COUNT')) return { rows: [{ total: 1 }] };
    throw Error(sql);
  } };
  await handleInteractiveButton(interaction, pool);
  assert.equal(edits[0].embeds[0].image.url, 'https://example.com/banner.png');
  assert.match(edits[0].embeds[1].description, /المسجلون: \*\*1\*\*/);
  assert.match(replies[0], /تم تسجيل/);
});

test('welcome card targets the selected channel with the joining member avatar', async () => {
  const sends = [];
  const member = { id: 'u', displayName: 'عضو', user: { username: 'عضو', bot: false }, guild: { id: 'g', name: 'السيرفر', channels: { fetch: async id => { assert.equal(id, 'welcome-channel'); return { isTextBased: () => true, send: async payload => sends.push(payload) }; } } }, displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/u/avatar.png' };
  const pool = { query: async () => ({ rows: [{ channel_id: 'welcome-channel', title: 'أهلًا {name}', description: 'مرحبًا {member}', color: 0x123456, banner: null }] }) };
  assert.equal(await sendWelcomeCard(member, pool), true);
  assert.equal(sends[0].embeds[0].thumbnail.url, 'https://cdn.discordapp.com/avatars/u/avatar.png');
  assert.equal(sends[0].embeds[0].title, 'أهلًا عضو');
  assert.equal(sends[0].embeds[0].description, 'مرحبًا <@u>');
});

test('giveaway announcement retry keeps the same winner and edits the original message', async () => {
  const giveaway = { id: 'giveaway-1', guild_id: 'guild-1', channel_id: 'channel-1', message_id: 'message-1', prize: 'هدية', winner_count: 1, status: 'active', winners: [], announced_at: null };
  let entryReads = 0;
  const edits = [];
  const pool = {
    async query(sql) {
      if (sql.startsWith('SELECT id FROM diskoko_giveaways')) return { rows: giveaway.announced_at ? [] : [{ id: giveaway.id }] };
      if (sql.startsWith('UPDATE diskoko_giveaways SET announced_at')) { giveaway.announced_at = new Date(); return { rowCount: 1 }; }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() { return {
      async query(sql, values) {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.startsWith('SELECT * FROM diskoko_giveaways')) return { rows: [{ ...giveaway }] };
        if (sql.startsWith('SELECT user_id FROM diskoko_giveaway_entries')) { entryReads++; return { rows: [{ user_id: 'winner-1' }] }; }
        if (sql.startsWith("UPDATE diskoko_giveaways SET status='ended'")) { giveaway.status = 'ended'; giveaway.winners = JSON.parse(values[0]); return { rowCount: 1 }; }
        throw new Error(`Unexpected client query: ${sql}`);
      },
      release() {},
    }; },
  };
  const discordBotFetch = async (path, options) => { edits.push({ path, body: JSON.parse(options.body) }); return { ok: edits.length > 1, status: edits.length > 1 ? 200 : 503 }; };
  await processDueGiveaways({ pool, discordBotFetch });
  assert.equal(giveaway.status, 'ended');
  assert.deepEqual(giveaway.winners, ['winner-1']);
  assert.equal(giveaway.announced_at, null);
  await processDueGiveaways({ pool, discordBotFetch });
  assert.equal(entryReads, 1);
  assert.equal(edits.length, 2);
  assert.equal(edits[0].path, edits[1].path);
  assert.equal(edits[0].body.content, edits[1].body.content);
  assert.ok(giveaway.announced_at);
});

