import test from 'node:test';
import assert from 'node:assert/strict';
import { claimSupportTicket, discordMessageOptions, processDueGiveaways, repairLegacyTicketControls, resolvePublicationChannel } from '../lib/interactive-systems.js';

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
  const pool = { query: async () => ({ rows: [{ panel_id: 'panel', channel_id: 'ticket-channel' }] }) };
  await repairLegacyTicketControls(bot, pool);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].components[0].components[0].custom_id, 'diskoko:close:panel');
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
  assert.equal(payload.components[0].components[0].label, 'فتح تذكرة');
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
