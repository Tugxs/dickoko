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
}, {
  key: 'diskoko-gaming-1', name: 'Diskoko Gaming Arabic', icon: '🎮',
  description: 'مجتمع ألعاب عربي متوسط الحجم: ترحيب، تجمع لاعبين، مشاركة لقطات، غرف صوتية، دعم وسجل نشاط مرتب.',
  definition: {
    name: 'Diskoko Gaming Arabic',
    roles: [
      { key: 'moderator', name: '🛡️ مشرف المجتمع', preset: 'moderator', color: 0x8d72e8 },
      { key: 'support', name: '🛟 فريق الدعم', preset: 'support', color: 0x44c7bf },
      { key: 'captain', name: '🏆 قائد فريق', preset: 'vip', color: 0xf4b942 },
      { key: 'gamer', name: '🎮 لاعب', preset: 'member', color: 0x61a7ef },
      { key: 'newcomer', name: '🌱 لاعب جديد', preset: 'member', color: 0x96ad9f },
    ],
    categories: [
      { key: 'start', name: '✦・البداية', channels: [
        { key: 'welcome', name: '👋・الترحيب', type: 0, access: 'read_only', topic: 'أهلًا بكل لاعب جديد في المجتمع' },
        { key: 'rules', name: '📜・القوانين', type: 0, access: 'read_only', topic: 'احترام اللاعبين، منع الإساءة والغش، وتنظيم اللعب' },
        { key: 'announcements', name: '📣・الإعلانات', type: 0, access: 'read_only', topic: 'أخبار المجتمع والمواعيد المهمة' },
      ] },
      { key: 'community', name: '💬・المجتمع', channels: [
        { key: 'general', name: '💬・الشات-العام', type: 0, topic: 'دردشة اللاعبين اليومية' },
        { key: 'introductions', name: '🙌・عرف-بنفسك', type: 0, topic: 'اسمك والألعاب التي تحبها' },
        { key: 'clips', name: '🎬・لقطات-اللعب', type: 0, topic: 'أفضل المقاطع واللحظات من ألعابك' },
        { key: 'memes', name: '😂・ميمز-الألعاب', type: 0, topic: 'ميمز خفيفة مرتبطة بالألعاب' },
      ] },
      { key: 'gaming', name: '🎮・منطقة اللعب', channels: [
        { key: 'looking-for-team', name: '🔎・ابحث-عن-فريق', type: 0, topic: 'اذكر اللعبة والمنصة والوقت المناسب لك' },
        { key: 'game-chat', name: '🕹️・نقاش-الألعاب', type: 0, topic: 'تجاربك ونصائحك عن الألعاب' },
        { key: 'results', name: '🏅・إنجازاتكم', type: 0, topic: 'شارك إنجازاتك ونتائج فريقك' },
        { key: 'events', name: '🏁・الفعاليات', type: 0, access: 'read_only', topic: 'إعلانات البطولات والفعاليات بعد إعدادها' },
      ] },
      { key: 'voice', name: '🔊・الغرف الصوتية', channels: [
        { key: 'lobby', name: '🔊・التجمع', type: 2 },
        { key: 'duo', name: '🎧・ثنائي', type: 2 },
        { key: 'squad', name: '🎙️・سكواد', type: 2 },
        { key: 'captains', name: '🏆・القادة', type: 2, access: 'private', roleKey: 'captain' },
        { key: 'afk', name: '💤・بعيد-عن-الجهاز', type: 2 },
      ] },
      { key: 'help', name: '🛟・المساعدة', channels: [
        { key: 'help-guide', name: '❔・الأسئلة-الشائعة', type: 0, access: 'read_only', topic: 'ضع هنا إجابات الأسئلة المتكررة عن مجتمعك' },
        { key: 'ticket', name: '🎫・افتح-تذكرة', type: 0, access: 'read_only', topic: 'اضغط زر الدعم لطلب المساعدة من الفريق' },
      ] },
      { key: 'staff', name: '🛡️・الإدارة', channels: [
        { key: 'staff-chat', name: '📝・شات-الإدارة', type: 0, access: 'private', roleKey: 'moderator' },
        { key: 'logs', name: '📋・سجل-النشاط', type: 0, access: 'private', roleKey: 'moderator' },
      ] },
    ],
    features: {
      welcome: { enabled: true, title: '🎮 أهلًا بك في ساحة اللعب!', description: 'يا هلا {member}! اقرأ القوانين، عرّفنا بنفسك، وابحث عن فريقك في 🔎・ابحث-عن-فريق. نتمنى لك لعبًا ممتعًا!', color: '#7067dc', channelKey: 'welcome', avatarPosition: 'right' },
      ticket: { enabled: true, title: '🛟 تحتاج مساعدة؟', description: 'عندك مشكلة في السيرفر أو تحتاج مساعدة من الفريق؟ اضغط الزر وافتح تذكرة خاصة.', channelKey: 'ticket', staffRoleKey: 'support', buttonLabel: '🎫 افتح تذكرة دعم', color: '#44c7bf' },
      logs: { enabled: true, mode: 'unified', channelKey: 'logs', events: ['message_create', 'message_update', 'message_delete', 'voice_join', 'voice_leave', 'command'] },
    },
  },
}, {
  key: 'diskoko-streamer', name: 'Diskoko Streamer', icon: '🎥',
  description: 'سيرفر متوسط لصانع محتوى: إعلان البث، جدول المواعيد، المقاطع، مساحة للمشتركين، دعم وإدارة؛ بلا اعتماد تلقائي على منصة بث خارجية.',
  definition: {
    name: 'Diskoko Streamer',
    roles: [
      { key: 'streamer', name: '🎥 صانع المحتوى', preset: 'vip', color: 0xf06487 },
      { key: 'moderator', name: '🛡️ مشرف', preset: 'moderator', color: 0x8d72e8 },
      { key: 'support', name: '🛟 فريق الدعم', preset: 'support', color: 0x48c7bf },
      { key: 'subscriber', name: '💎 مشترك مميز', preset: 'vip', color: 0xe6b64b },
      { key: 'viewer', name: '⭐ متابع', preset: 'member', color: 0x7ca9dc },
    ],
    categories: [
      { key: 'start', name: '✨・ابدأ-هنا', channels: [
        { key: 'welcome', name: '👋・الترحيب', type: 0, access: 'read_only', topic: 'استقبال المتابعين الجدد' },
        { key: 'rules', name: '📜・القوانين', type: 0, access: 'read_only', topic: 'احترام الجميع، منع السبام وحرق المحتوى' },
        { key: 'announcements', name: '📢・الإعلانات', type: 0, access: 'read_only', postRoleKey: 'streamer', topic: 'أخبار صانع المحتوى والمجتمع' },
      ] },
      { key: 'broadcast', name: '🔴・البث-والمحتوى', channels: [
        { key: 'live', name: '🔴・على-البث', type: 0, access: 'read_only', postRoleKey: 'streamer', topic: 'إعلان البث المباشر ورابطه؛ تُنشر الإعلانات يدويًا أو بعد إعداد ربط خارجي' },
        { key: 'schedule', name: '🗓️・جدول-البث', type: 0, access: 'read_only', postRoleKey: 'streamer', topic: 'مواعيد البث القادمة والتغييرات' },
        { key: 'clips', name: '🎬・أفضل-اللقطات', type: 0, topic: 'شارك لقطاتك المفضلة مع المجتمع' },
        { key: 'videos', name: '📺・الفيديوهات', type: 0, access: 'read_only', postRoleKey: 'streamer', topic: 'روابط المقاطع والفيديوهات الجديدة' },
      ] },
      { key: 'community', name: '💬・المجتمع', channels: [
        { key: 'general', name: '💬・الشات-العام', type: 0, topic: 'دردشة المتابعين اليومية' },
        { key: 'suggestions', name: '💡・اقتراحات-المحتوى', type: 0, topic: 'أفكار للبث والحلقات القادمة' },
        { key: 'setups', name: '🖥️・إعداداتكم', type: 0, topic: 'شارك مساحة اللعب أو التصوير وأجهزتك' },
        { key: 'commands', name: '🤖・أوامر-البوت', type: 0, topic: 'استخدم أوامر البوت المتاحة للسيرفر' },
      ] },
      { key: 'subscribers', name: '💎・المشتركون', channels: [
        { key: 'subscriber-chat', name: '💎・شات-المشتركين', type: 0, access: 'private', roleKey: 'subscriber', topic: 'جلسة خاصة لأصحاب رتبة المشترك المميز' },
        { key: 'subscriber-voice', name: '🎙️・صوت-المشتركين', type: 2, access: 'private', roleKey: 'subscriber' },
      ] },
      { key: 'voice', name: '🔊・الغرف-الصوتية', channels: [
        { key: 'lobby', name: '🔊・تجمع-المتابعين', type: 2 },
        { key: 'gaming', name: '🎮・لعب-مع-المتابعين', type: 2 },
        { key: 'afk', name: '💤・بعيد-عن-الجهاز', type: 2 },
      ] },
      { key: 'help', name: '🛟・المساعدة', channels: [
        { key: 'faq', name: '❔・الأسئلة-الشائعة', type: 0, access: 'read_only', topic: 'ضع هنا روابطك وإجابات الأسئلة المتكررة' },
        { key: 'ticket', name: '🎫・فتح-تذكرة', type: 0, access: 'read_only', topic: 'افتح تذكرة خاصة للتواصل مع فريق الدعم' },
      ] },
      { key: 'staff', name: '🛡️・فريق-السيرفر', channels: [
        { key: 'creator-studio', name: '🎥・استديو-صانع-المحتوى', type: 0, access: 'private', roleKey: 'streamer', topic: 'تجهيز الأفكار والمواد قبل نشرها' },
        { key: 'staff-chat', name: '📝・شات-الإدارة', type: 0, access: 'private', roleKey: 'moderator' },
        { key: 'logs', name: '📋・سجل-النشاط', type: 0, access: 'private', roleKey: 'moderator' },
      ] },
    ],
    features: {
      welcome: { enabled: true, title: '🎥 أهلًا بك في مجتمع البث!', description: 'يا هلا {member}! تابع أخبار البث في 🔴・على-البث، وشاركنا رأيك ولقطاتك. نورتنا!', color: '#d967a4', channelKey: 'welcome', avatarPosition: 'right' },
      ticket: { enabled: true, title: '🛟 تواصل مع فريق السيرفر', description: 'عندك استفسار أو مشكلة؟ افتح تذكرة خاصة وسيساعدك الفريق.', channelKey: 'ticket', staffRoleKey: 'support', buttonLabel: '🎫 تواصل مع الدعم', color: '#48c7bf' },
      logs: { enabled: true, mode: 'unified', channelKey: 'logs', events: ['message_create', 'message_update', 'message_delete', 'voice_join', 'voice_leave', 'command'] },
    },
  },
}];
// The catalog stores roles from highest to lowest; the editor can change this order.
const roleOrder = {
  'server-my-arabic': ['moderator', 'support', 'vip', 'member'],
  'streamer-community': ['owner', 'co-owner', 'head-admin', 'admin', 'moderator', 'streamer', 'subscriber', 'first-place', 'viewer-100', 'viewer-80', 'viewer-60', 'viewer-40', 'viewer-20', 'viewer-10', 'viewer', 'follower', 'member', 'muted', 'ask-dm', 'dm-close', 'dm-open', 'pc', 'xbox', 'playstation', 'switch', 'mobile', 'bots'],
  'diskoko-gaming-1': ['moderator', 'support', 'captain', 'gamer', 'newcomer'],
  'diskoko-streamer': ['streamer', 'moderator', 'support', 'subscriber', 'viewer'],
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
      const postRoleKey = access === 'read_only' && type === 0 ? plain(channel.postRoleKey) : '';
      if (access === 'private' && !roleKeys.has(roleKey)) throw problem('القناة الخاصة تحتاج رتبة موجودة داخل القالب.');
      if (postRoleKey && !roleKeys.has(postRoleKey)) throw problem('رتبة النشر في القناة للقراءة فقط غير موجودة داخل القالب.');
      const topic = plain(channel.topic);
      if (topic.length > 1024) throw problem('وصف القناة طويل جدًا.');
      return { key: channelKey, name: channelName, type, access, ...(roleKey ? { roleKey } : {}), ...(postRoleKey ? { postRoleKey } : {}), ...(topic && type === 0 ? { topic } : {}) };
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
      features[kind].avatarPosition = ['left', 'right', 'top', 'center'].includes(feature.avatarPosition) ? feature.avatarPosition : 'right';
      features[kind].bannerPosition = feature.bannerPosition === 'above' ? 'above' : 'below';
      features[kind].composite = feature.composite === true;
      if (features[kind].composite && !features[kind].banner) throw problem('ارفع تصميم الترحيب قبل وضع صورة العضو داخله.');
      if (features[kind].composite && !['left', 'center', 'right'].includes(feature.avatarPosition)) throw problem('اختر موضع صورة العضو داخل التصميم.');
      features[kind].avatarVertical = Math.max(15, Math.min(85, Number(feature.avatarVertical ?? 50)));
      features[kind].avatarRadius = Math.max(60, Math.min(160, Number(feature.avatarRadius ?? 95)));
      if (!Number.isFinite(features[kind].avatarVertical) || !Number.isFinite(features[kind].avatarRadius)) throw problem('موضع صورة العضو غير صالح.');
    } else {
      const staffRoleKey = plain(feature.staffRoleKey);
      if (!roleKeys.has(staffRoleKey)) throw problem('اختر رتبة الدعم من القالب.');
      features[kind].staffRoleKey = staffRoleKey;
      features[kind].color = /^#[0-9a-fA-F]{6}$/.test(plain(feature.color || '#8d72e8')) ? plain(feature.color || '#8d72e8') : (() => { throw problem('لون بطاقة الدعم غير صالح.'); })();
      features[kind].banner = readyImage(feature.banner);
      features[kind].bannerPosition = feature.bannerPosition === 'above' ? 'above' : 'below';
      features[kind].imageStyle = ['logo', 'design'].includes(feature.imageStyle) ? feature.imageStyle : 'normal';
      if (features[kind].imageStyle === 'design' && (!features[kind].banner || features[kind].banner.mime !== 'image/png')) throw problem('ادمج شعار الدعم داخل التصميم الثابت قبل المراجعة.');
      features[kind].buttonLabel = plain(feature.buttonLabel || 'فتح تذكرة دعم');
      if (features[kind].buttonLabel.length > 80) throw problem('نص زر الدعم طويل جدًا.');
    }
  }
  if (rawFeatures.logs?.enabled) {
    const allChannels = categories.flatMap(category => category.channels);
    const byKey = new Map(allChannels.map(channel => [channel.key, channel]));
    const mode = rawFeatures.logs.mode === 'routed' ? 'routed' : 'unified';
    const allowedEvents = ['message_create', 'message_update', 'message_delete', 'voice_join', 'voice_leave', 'command'];
    const events = Array.isArray(rawFeatures.logs.events) ? [...new Set(rawFeatures.logs.events.map(plain))] : allowedEvents;
    if (!events.length || events.some(event => !allowedEvents.includes(event))) throw problem('اختر نوعًا واحدًا على الأقل من أحداث السجل.');
    const channelKey = plain(rawFeatures.logs.channelKey);
    const destination = byKey.get(channelKey);
    if (mode === 'unified' && (!destination || destination.type !== 0)) throw problem('اختر قناة نصية تستقبل اللوق الموحد.');
    let routes = [];
    if (mode === 'routed') {
      if (!Array.isArray(rawFeatures.logs.routes) || !rawFeatures.logs.routes.length || rawFeatures.logs.routes.length > 10) throw problem('أضف من قاعدة واحدة إلى عشر قواعد لوق.');
      const usedKeys = new Set();
      routes = rawFeatures.logs.routes.map((route, index) => {
        const key = plain(route.key || `log-${index + 1}`), targetKey = plain(route.targetKey);
        const target = byKey.get(targetKey);
        const sourceKeys = Array.isArray(route.sourceKeys) ? [...new Set(route.sourceKeys.map(plain))] : [];
        if (!validKey(key) || usedKeys.has(key) || !target || target.type !== 0 || !sourceKeys.length || sourceKeys.length > 40 || sourceKeys.some(source => !byKey.has(source) || source === targetKey)) throw problem('راجع مصادر اللوق والقناة المستقبلة لكل قاعدة.');
        usedKeys.add(key);
        return { key, targetKey, sourceKeys };
      });
    }
    features.logs = { enabled: true, mode, channelKey: mode === 'unified' ? channelKey : routes[0].targetKey, events, routes };
  } else features.logs = { enabled: false };
  return { name, roles, categories, features };
}

export function readyUsageUnits(definition) {
  return definition.categories.length + definition.categories.reduce((count, group) => count + group.channels.length, 0)
    + ['welcome', 'ticket'].filter(kind => definition.features[kind]?.enabled).length
    + (definition.features.logs?.enabled ? definition.features.logs.mode === 'routed' ? definition.features.logs.routes.length : 1 : 0);
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
      const postingRole = roles.find(row => row.name === definition.roles.find(role => role.key === channel.postRoleKey)?.name && !row.managed);
      const postingAllowed = !channel.postRoleKey || Boolean(postingRole && (BigInt((existing?.permission_overwrites || []).find(row => row.id === postingRole.id)?.allow || '0') & P.SendMessages));
      return { kind: 'channel', key: channel.key, name: channel.name, parent: channel.categoryName, access: channel.access, ...(channel.postRoleKey ? { postRole: definition.roles.find(role => role.key === channel.postRoleKey)?.name } : {}), action: existing ? (actual === channel.access && roleAllowed && postingAllowed ? 'reuse' : mode === 'replace' ? 'update' : 'conflict') : 'create', ...(existing ? { existingId: existing.id, actualAccess: actual } : {}) };
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
