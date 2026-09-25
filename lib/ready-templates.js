import { PermissionFlagsBits } from 'discord.js';
import { problem } from './workspace-domain.js';

const P = PermissionFlagsBits;
const ROLE_PRESETS = {
  member: { label: 'عضو', permissions: '0', description: 'عضوية عادية بلا صلاحيات إدارية.' },
  vip: { label: 'مميز', permissions: '0', description: 'تمييز بصري، دون صلاحيات إدارية.' },
  support: { label: 'الدعم', permissions: String(P.ViewChannel | P.ReadMessageHistory | P.SendMessages | P.ManageThreads), description: 'الرد على الأعضاء وإدارة نقاشات الدعم؛ لا يمنح إدارة السيرفر.' },
  moderator: { label: 'مشرف', permissions: String(P.ManageMessages | P.ModerateMembers | P.ViewAuditLog), description: 'الإشراف على الرسائل والأعضاء والاطلاع على السجل؛ لا يمنح Administrator.' },
};
const SAFE_ROLE_BITS = Object.values(ROLE_PRESETS).reduce((bits, role) => bits | BigInt(role.permissions), 0n);

const source = 'https://discordtemplates.me/templates/838410903622778881';
export const READY_TEMPLATES = [{
  key: 'server-my-arabic', name: 'Server My Arabic', icon: '🌙',
  description: 'مجتمع عربي بقنوات ترحيب وإدارة ودعم وألعاب، مستوحى من القالب الذي اخترته مع صلاحيات محافظة قابلة للتعديل.',
  source,
  definition: {
    name: 'Server My Arabic',
    roles: [
      { key: 'member', name: 'عضو', preset: 'member', color: 0x99aab5 },
      { key: 'vip', name: 'VIP', preset: 'vip', color: 0xffc857 },
      { key: 'support', name: 'الدعم الفني', preset: 'support', color: 0x50c5b7 },
      { key: 'moderator', name: 'مشرف', preset: 'moderator', color: 0x8d72e8 },
    ],
    categories: [
      { key: 'info', name: '▬▬▬▬ 𝐈𝐍𝐅𝐎 ▬▬▬▬', channels: [
        { key: 'welcome', name: '『💎』الترحيب', type: 0, access: 'read_only', topic: 'استقبال الأعضاء الجدد' },
        { key: 'rules', name: '『📚』القوانين', type: 0, access: 'read_only', topic: 'قوانين المجتمع وتوجيهاته' },
        { key: 'about', name: '〘・مـن-・حـنـا・〙', type: 0, access: 'read_only', topic: 'تعرف إلى المجتمع' },
      ] },
      { key: 'community', name: '▬▬▬▬ 𝐂𝐎𝐌𝐌𝐔𝐍𝐈𝐓𝐘 ▬▬▬▬', channels: [
        { key: 'general', name: '『🌐』الشات-العام', type: 0 },
        { key: 'announcements', name: '『👑』الاعلانات', type: 0, access: 'read_only' },
        { key: 'suggestions', name: '『✍』اقتراحاتكم', type: 0 },
        { key: 'questions', name: '『❓』الاستفسارات', type: 0 },
        { key: 'memes', name: '『😂』ميمز', type: 0 },
        { key: 'media', name: '『🎬』المقاطع-والتصاميم', type: 0 },
      ] },
      { key: 'support', name: '▬▬▬▬ 𝐒𝐔𝐏𝐏𝐎𝐑𝐓 ▬▬▬▬', channels: [
        { key: 'ticket', name: '『🔧』فتح-تكت', type: 0, access: 'read_only' },
        { key: 'support-chat', name: 'شات-الدعم-الفني', type: 0 },
        { key: 'support-voice', name: '𝐒𝐔𝐏𝐏𝐎𝐑𝐓 𝐕𝐎𝐈𝐂𝐄', type: 2 },
      ] },
      { key: 'voice', name: '▬▬▬▬ 𝐕𝐎𝐈𝐂𝐄 ▬▬▬▬', channels: [
        { key: 'voice-1', name: '« 𝐕𝐎𝐈𝐂𝐄 𝐂𝐇𝐀𝐓 »', type: 2 },
        { key: 'music', name: '♬ 𝐌𝐔𝐒𝐈𝐂 ♬', type: 2 },
        { key: 'afk', name: '«💤» 𝐀𝐅𝐊', type: 2 },
      ] },
      { key: 'games', name: '▬▬▬▬ 𝐆𝐀𝐌𝐄𝐒 ▬▬▬▬', channels: [
        { key: 'gta', name: 'grand-theft-auto', type: 2 },
        { key: 'fortnite-duos', name: '« 𝐃𝐔𝐎𝐒 »', type: 2 },
        { key: 'fortnite-squad', name: '« 𝐒𝐐𝐔𝐀𝐃 »', type: 2 },
      ] },
      { key: 'vip', name: '▬▬▬▬ 𝐏𝐑𝐈𝐕𝐀𝐓𝐄 ▬▬▬▬', channels: [
        { key: 'vip-chat', name: '『🔒』شات-خاص', type: 0, access: 'private', roleKey: 'vip' },
        { key: 'vip-voice', name: '« 𝐏𝐑𝐈𝐕𝐀𝐓𝐄 𝐑𝐎𝐎𝐌 »', type: 2, access: 'private', roleKey: 'vip' },
      ] },
      { key: 'staff', name: '▬▬ 𝐀𝐃𝐌𝐈𝐍𝐒𝐓𝐑𝐀𝐓𝐈𝐎𝐍 ▬▬', channels: [
        { key: 'staff-chat', name: '『📝』شات-الادارة', type: 0, access: 'private', roleKey: 'moderator' },
        { key: 'logs', name: '『🔒』اللوق', type: 0, access: 'private', roleKey: 'moderator' },
        { key: 'staff-voice', name: '« 𝐀𝐃𝐌𝐈𝐍 »', type: 2, access: 'private', roleKey: 'moderator' },
      ] },
    ],
    features: { welcome: { enabled: true, title: '👋 أهلًا بك في مجتمعنا!', description: 'مرحبًا {member}، سعداء بانضمامك إلينا. اطلع على القوانين وعرّفنا بنفسك!', color: '#8d72e8', channelKey: 'welcome' }, ticket: { enabled: true, title: '🛟 مركز الدعم', description: 'تحتاج مساعدة؟ افتح تذكرة وسيتواصل معك فريق الدعم.', channelKey: 'ticket', staffRoleKey: 'support' }, logs: { enabled: true, channelKey: 'logs' } },
  },
}, {
  key: 'streamer-community', name: 'Streamer Community', icon: '🔴',
  description: 'هيكل مجتمع بث كامل بالقنوات والرتب؛ عدادات Twitch والتنبيهات واللفلات تحتاج تكاملًا خارجيًا لاحقًا.',
  source: 'https://xenon.bot/templates/Z5dbJ2mvxRbG',
  definition: {
    name: 'Streamer Community',
    roles: [
      { key: 'member', name: 'Members', preset: 'member', color: 0x99aab5 },
      { key: 'follower', name: '❤️｜Twitch Follower', preset: 'member', color: 0xe15c70 },
      { key: 'subscriber', name: '💎｜Twitch Subscriber', preset: 'vip', color: 0x9c73eb },
      { key: 'streamer', name: '🔴｜Twitch Streamer', preset: 'vip', color: 0xe54545 },
      { key: 'moderator', name: '🌀｜Moderator', preset: 'moderator', color: 0x58bcd7 },
      { key: 'admin', name: '🔥｜Administrator', preset: 'moderator', color: 0xf38f54 },
      { key: 'head-admin', name: '🚨｜Head Administrator', preset: 'moderator', color: 0xed634f },
      { key: 'co-owner', name: '👑｜Co Owner', preset: 'moderator', color: 0xe5b849 },
      { key: 'owner', name: '👑｜Owner', preset: 'moderator', color: 0xf1c55c },
      { key: 'first-place', name: '🥇｜First Place', preset: 'vip', color: 0xe9b44f },
      { key: 'viewer-100', name: '💯｜Godlike Viewer', preset: 'vip', color: 0xdd9c53 },
      { key: 'viewer-80', name: '⚜️｜Mythic Viewer', preset: 'vip', color: 0xb37ae9 },
      { key: 'viewer-60', name: '🔱｜Legend Viewer', preset: 'vip', color: 0x5c99ec },
      { key: 'viewer-40', name: '🌠｜Ace Viewer', preset: 'vip', color: 0x54c7c7 },
      { key: 'viewer-20', name: '✨｜Good Viewer', preset: 'member', color: 0x81c779 },
      { key: 'viewer-10', name: '🌟｜Active Viewer', preset: 'member', color: 0x96bd67 },
      { key: 'viewer', name: '⭐｜Viewer', preset: 'member', color: 0x99aab5 },
      { key: 'muted', name: '🔇｜Muted', preset: 'member', color: 0x6f7785 },
      { key: 'ask-dm', name: '🔐｜Ask for DM', preset: 'member', color: 0x99aab5 },
      { key: 'dm-close', name: '🔒｜DM close', preset: 'member', color: 0x99aab5 },
      { key: 'dm-open', name: '🔓｜DM open', preset: 'member', color: 0x99aab5 },
      { key: 'pc', name: 'PC', preset: 'member', color: 0x99aab5 },
      { key: 'xbox', name: 'XBOX', preset: 'member', color: 0x99aab5 },
      { key: 'playstation', name: 'Playstation', preset: 'member', color: 0x99aab5 },
      { key: 'switch', name: 'Switch', preset: 'member', color: 0x99aab5 },
      { key: 'mobile', name: 'Mobile', preset: 'member', color: 0x99aab5 },
      { key: 'bots', name: '🤖｜Bots', preset: 'member', color: 0x7b87a4 },
    ],
    categories: [
      { key: 'server-stats', name: '▬▬[ 📊 | SERVER STATS | 📊 ]▬▬', channels: [
        { key: 'all-members', name: '〔👤〕All Members', type: 2 },
        { key: 'members-stat', name: '〔👤〕Members', type: 2 },
        { key: 'bots-stat', name: '〔🤖〕Bots', type: 2 },
      ] },
      { key: 'twitch-stats', name: '▬▬[ 📊 | TWITCH STATS | 📊 ]▬▬', channels: [
        { key: 'followers-stat', name: '〔⭐〕Followers', type: 2 },
        { key: 'subs-stat', name: '〔🎁〕Subs', type: 2 },
      ] },
      { key: 'info', name: '▬▬[ 🍀 | SERVER INFO | 🍀 ]▬▬', channels: [
        { key: 'rules', name: '〔📄〕rules', type: 0, access: 'read_only', topic: 'قوانين المجتمع' },
        { key: 'welcome', name: '〔👋〕welcome', type: 0, access: 'read_only', topic: 'مرحبًا بالأعضاء الجدد' },
        { key: 'announcements', name: '〔📌〕announcements', type: 0, access: 'read_only', topic: 'أهم الإعلانات' },
        { key: 'giveaway', name: '〔🎉〕giveaway', type: 0, access: 'read_only', topic: 'الجوائز والمسابقات' },
        { key: 'level-up', name: '〔🆙〕level-up', type: 0, access: 'read_only' },
        { key: 'goodbye', name: '〔👋〕goodbye', type: 0, access: 'read_only' },
      ] },
      { key: 'chats', name: '▬▬[ 💭 | CHATS | 💭 ]▬▬', channels: [
        { key: 'general', name: '〔💬〕general', type: 0 },
        { key: 'gallery', name: '〔📷〕gallery', type: 0 },
        { key: 'memes', name: '〔🤣〕memes', type: 0 },
        { key: 'bot-commands', name: '〔🤖〕bot-commands', type: 0 },
        { key: 'suggestions', name: '〔💡〕suggestions', type: 0 },
      ] },
      { key: 'twitch', name: '▬▬[ 🔔 | TWITCH | 🔔 ]▬▬', channels: [
        { key: 'live', name: '〔🔴〕Live Streaming', type: 2 },
        { key: 'recording', name: '〔🔴〕Recording', type: 2 },
        { key: 'notifications', name: '〔🔔〕twitch-notification', type: 0, access: 'read_only' },
        { key: 'clips', name: '〔🎬〕twitch-clips', type: 0 },
      ] },
      { key: 'subscribers', name: '▬▬[ 💎 | SUBSCRIBERS | 💎 ]▬▬', channels: [
        { key: 'subscriber-voice', name: '〔💎〕Subscriber VC', type: 2, access: 'private', roleKey: 'subscriber' },
        { key: 'subscriber-chat', name: '〔💵〕subscriber-chat', type: 0, access: 'private', roleKey: 'subscriber' },
      ] },
      { key: 'voice', name: '▬▬[ 🔊 | VOICE | 🔊 ]▬▬', channels: [
        { key: 'voice-general', name: '〔🌏〕General', type: 2 },
        { key: 'chilling', name: '〔👥〕Chilling', type: 2 },
        { key: 'gaming', name: '〔🎮〕Gaming Channel', type: 2 },
        { key: 'serious-gaming', name: '〔🎮〕Serious Gaming', type: 2 },
        { key: 'afk', name: '〔💤〕AFK', type: 2 },
      ] },
      { key: 'music', name: '▬▬[ 🎶 | MUSIC | 🎶 ]▬▬', channels: [
        { key: 'music-1', name: '〔🎧〕Music VC 1', type: 2 },
        { key: 'song-request', name: '〔🎶〕song-request', type: 0 },
        { key: 'music-2', name: '〔🎧〕Music VC 2', type: 2 },
      ] },
      { key: 'staff', name: '▬▬[ 🌀 | STAFF | 🌀 ]▬▬', channels: [
        { key: 'staff-voice', name: '〔🚀〕Staff VC', type: 2, access: 'private', roleKey: 'moderator' },
        { key: 'staff-chat', name: '〔🚀〕staff-chat', type: 0, access: 'private', roleKey: 'moderator' },
        { key: 'logs', name: '〔📝〕mod-logs', type: 0, access: 'private', roleKey: 'moderator' },
      ] },
    ],
    features: { welcome: { enabled: true, title: '👋 Welcome to our community!', description: 'Welcome {member}! Read the rules and introduce yourself.', color: '#9c73eb', channelKey: 'welcome' }, ticket: { enabled: false }, logs: { enabled: true, channelKey: 'logs' } },
  },
}];
// The catalog stores roles from highest to lowest; the editor can change this order.
const roleOrder = {
  'server-my-arabic': ['moderator', 'support', 'vip', 'member'],
  'streamer-community': ['owner', 'co-owner', 'head-admin', 'admin', 'moderator', 'streamer', 'subscriber', 'first-place', 'viewer-100', 'viewer-80', 'viewer-60', 'viewer-40', 'viewer-20', 'viewer-10', 'viewer', 'follower', 'member', 'muted', 'ask-dm', 'dm-close', 'dm-open', 'pc', 'xbox', 'playstation', 'switch', 'mobile', 'bots'],
};
for (const template of READY_TEMPLATES) template.definition.roles.sort((a, b) => roleOrder[template.key].indexOf(a.key) - roleOrder[template.key].indexOf(b.key));

const plain = value => String(value ?? '').trim();
const validKey = value => /^[a-z][a-z0-9-]{0,39}$/.test(value);
const validName = value => value.length >= 1 && value.length <= 100 && !/[\r\n]/.test(value);
function readyImage(input) {
  if (!input) return null;
  const mime = plain(input.mime), base64 = plain(input.base64);
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 11_200_000) throw problem('صورة القالب يجب أن تكون PNG أو JPG أو WebP أو GIF وبحجم 8 ميجابايت كحد أقصى.');
  const bytes = Buffer.from(base64, 'base64');
  const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : mime === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' : ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (!valid || bytes.length > 8 * 1024 * 1024) throw problem('تعذر قراءة الصورة أو تجاوزت 8 ميجابايت.');
  return { mime, base64 };
}
export function normalizeReadyDefinition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem('القالب غير صالح.');
  const name = plain(input.name);
  if (!validName(name)) throw problem('اسم القالب يجب أن يكون من 1 إلى 100 حرف.');
  if (!Array.isArray(input.roles) || input.roles.length > 40 || !Array.isArray(input.categories) || !input.categories.length || input.categories.length > 25) throw problem('عدد الرتب أو التصنيفات غير صالح.');
  const keys = { role: new Set(), category: new Set(), channel: new Set() };
  const reserve = (kind, key) => { if (!validKey(key) || keys[kind].has(key)) throw problem('مفاتيح القالب مكررة أو غير صالحة.'); keys[kind].add(key); return key; };
  const roles = input.roles.map(item => {
    const key = reserve('role', plain(item.key)), roleName = plain(item.name), preset = plain(item.preset || 'member');
    if (!validName(roleName) || !Object.hasOwn(ROLE_PRESETS, preset)) throw problem('اسم الرتبة أو نوع صلاحياتها غير صالح.');
    const color = Number(item.color ?? 0);
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff) throw problem('لون الرتبة غير صالح.');
    return { key, name: roleName, preset, color, permissions: ROLE_PRESETS[preset].permissions };
  });
  const roleKeys = new Set(roles.map(role => role.key));
  let channelCount = 0;
  const categories = input.categories.map(item => {
    const key = reserve('category', plain(item.key)), categoryName = plain(item.name);
    if (!validName(categoryName) || !Array.isArray(item.channels) || item.channels.length > 40) throw problem('تصنيف القنوات غير صالح.');
    const channels = item.channels.map(channel => {
      channelCount++;
      const channelKey = reserve('channel', plain(channel.key)), channelName = plain(channel.name), type = Number(channel.type ?? 0), access = plain(channel.access || 'public');
      if (!validName(channelName) || ![0, 2].includes(type) || !['public', 'read_only', 'private'].includes(access) || (type === 2 && access === 'read_only')) throw problem('اسم القناة أو نوعها أو وصولها غير صالح.');
      const roleKey = access === 'private' ? plain(channel.roleKey) : null;
      if (access === 'private' && !roleKeys.has(roleKey)) throw problem('القناة الخاصة تحتاج رتبة موجودة داخل القالب.');
      const topic = plain(channel.topic);
      if (topic.length > 1024) throw problem('وصف القناة طويل جدًا.');
      return { key: channelKey, name: channelName, type, access, ...(roleKey ? { roleKey } : {}), ...(topic && type === 0 ? { topic } : {}) };
    });
    return { key, name: categoryName, channels };
  });
  if (channelCount < 1 || channelCount > 85) throw problem('القالب يحتاج من 1 إلى 85 قناة.');
  if (new Set(categories.map(item => item.name.toLowerCase())).size !== categories.length || new Set(roles.map(item => item.name.toLowerCase())).size !== roles.length) throw problem('أسماء التصنيفات والرتب يجب أن تكون فريدة داخل القالب.');
  if (categories.some(group => new Set(group.channels.map(item => item.name.toLowerCase())).size !== group.channels.length)) throw problem('لا تكرر اسم القناة داخل التصنيف نفسه.');
  const channelKeys = new Set(categories.flatMap(category => category.channels.map(channel => channel.key)));
  const rawFeatures = input.features || {};
  const features = {};
  for (const kind of ['welcome', 'ticket']) {
    const feature = rawFeatures[kind];
    if (!feature?.enabled) { features[kind] = { enabled: false }; continue; }
    const title = plain(feature.title), description = plain(feature.description), channelKey = plain(feature.channelKey);
    if (!title || title.length > 256 || !description || description.length > 2000 || !channelKeys.has(channelKey)) throw problem(`إعداد ${kind === 'welcome' ? 'الترحيب' : 'الدعم'} غير مكتمل.`);
    const channel = categories.flatMap(category => category.channels).find(row => row.key === channelKey);
    if (channel.type !== 0) throw problem('ميزة الترحيب أو التذاكر تحتاج قناة نصية.');
    features[kind] = { enabled: true, title, description, channelKey };
    if (kind === 'welcome') {
      const color = plain(feature.color || '#8d72e8');
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw problem('لون بطاقة الترحيب غير صالح.');
      features[kind].color = color;
      features[kind].banner = readyImage(feature.banner);
      features[kind].avatarPosition = ['left', 'right', 'top'].includes(feature.avatarPosition) ? feature.avatarPosition : 'right';
      features[kind].bannerPosition = feature.bannerPosition === 'above' ? 'above' : 'below';
    } else {
      const staffRoleKey = plain(feature.staffRoleKey);
      if (!roleKeys.has(staffRoleKey)) throw problem('اختر رتبة الدعم من القالب.');
      features[kind].staffRoleKey = staffRoleKey;
    }
  }
  if (rawFeatures.logs?.enabled) {
    const channelKey = plain(rawFeatures.logs.channelKey);
    const channel = categories.flatMap(category => category.channels).find(row => row.key === channelKey);
    if (!channel || channel.type !== 0) throw problem('اختر قناة نصية لسجل أوامر البوت.');
    features.logs = { enabled: true, channelKey };
  } else features.logs = { enabled: false };
  return { name, roles, categories, features };
}

export function readyTemplateDiff(definition, snapshot, mode = 'add') {
  if (!['add', 'replace'].includes(mode)) throw problem('اختر الإضافة أو الاستبدال.');
  const rows = snapshot.channels || [], roles = snapshot.roles || [];
  const desiredChannels = definition.categories.flatMap(category => category.channels.map(channel => ({ ...channel, categoryKey: category.key, categoryName: category.name })));
  const expected = mode === 'replace' ? [
    ...definition.categories.map(category => ({ kind: 'category', key: category.key, name: category.name, action: 'create' })),
    ...desiredChannels.map(channel => ({ kind: 'channel', key: channel.key, name: channel.name, parent: channel.categoryName, access: channel.access, action: 'create' })),
    ...definition.roles.map(role => ({ kind: 'role', key: role.key, name: role.name, preset: role.preset, permissions: role.permissions, action: 'create' })),
  ] : [
    ...definition.categories.map(category => ({ kind: 'category', key: category.key, name: category.name, action: rows.some(row => row.type === 4 && row.name === category.name) ? 'reuse' : 'create' })),
    ...desiredChannels.map(channel => {
      const matches = rows.filter(row => row.type === channel.type && row.name === channel.name && rows.find(parent => parent.id === row.parent_id)?.name === channel.categoryName);
      if (matches.length > 1) throw problem(`أكثر من قناة باسم «${channel.name}» في التصنيف نفسه. غيّر الاسم قبل التنفيذ.`, 409);
      const existing = matches[0];
      const everyone = (existing?.permission_overwrites || []).find(row => row.id === snapshot.guildId);
      const denied = BigInt(everyone?.deny || '0');
      const actual = (denied & P.ViewChannel) ? 'private' : (denied & P.SendMessages) ? 'read_only' : 'public';
      const targetRole = roles.find(row => row.name === definition.roles.find(role => role.key === channel.roleKey)?.name && !row.managed);
      const roleAllowed = channel.access !== 'private' || Boolean(targetRole && (BigInt((existing?.permission_overwrites || []).find(row => row.id === targetRole.id)?.allow || '0') & P.ViewChannel));
      return { kind: 'channel', key: channel.key, name: channel.name, parent: channel.categoryName, access: channel.access, action: existing ? (actual === channel.access && roleAllowed ? 'reuse' : mode === 'replace' ? 'update' : 'conflict') : 'create', ...(existing ? { existingId: existing.id, actualAccess: actual } : {}) };
    }),
    ...definition.roles.map(role => {
      const existing = roles.find(row => row.name === role.name && !row.managed && row.id !== snapshot.guildId);
      return { kind: 'role', key: role.key, name: role.name, preset: role.preset, permissions: role.permissions, action: existing ? (mode === 'replace' && (String(existing.permissions) !== role.permissions || existing.color !== role.color) ? 'update' : 'reuse') : 'create', ...(existing ? { existingId: existing.id, currentPermissions: String(existing.permissions), hasAdministrator: Boolean(BigInt(existing.permissions || '0') & P.Administrator) } : {}) };
    }),
  ];
  if (expected.some(item => item.action === 'conflict')) throw problem('بعض القنوات الموجودة تحمل الاسم نفسه لكن صلاحياتها مختلفة. غيّر اسم القناة في القالب أو اختر الاستبدال لمراجعة تعديلها.', 409);
  const deletions = mode === 'replace' ? {
    channels: rows.map(row => ({ id: row.id, name: row.name, type: row.type })),
    roles: roles.filter(row => row.id !== snapshot.guildId && !row.managed).map(row => ({ id: row.id, name: row.name, position: row.position })),
  } : { channels: [], roles: [] };
  return { mode, createOrReuse: expected, deletions, warning: mode === 'replace' ? 'حذف القنوات يمحو رسائلها ولا يمكن استعادتها من Discord. حذف الرتب يزيلها من الأعضاء. يُنشأ الهيكل الجديد أولًا ثم تُحذف العناصر القديمة.' : null };
}

export { ROLE_PRESETS, SAFE_ROLE_BITS };
