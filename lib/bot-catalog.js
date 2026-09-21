// This list is the contract for registration, execution, settings and the UI.
export const BOT_COMMANDS = Object.freeze([
  { key: 'help', title: 'المساعدة', group: 'أساسي', description: 'يعرض الأوامر المفعلة لهذا السيرفر.', discordDescription: 'عرض المساعدة', permission: 'الجميع', example: 'الأوامر المفعلة لهذا السيرفر.' },
  { key: 'ping', title: 'فحص الاستجابة', group: 'أساسي', description: 'يقيس سرعة استجابة البوت.', discordDescription: 'فحص سرعة الاستجابة', permission: 'الجميع', example: 'Pong — الاستجابة مستقرة.' },
  { key: 'about', title: 'عن ديسكوكو', group: 'أساسي', description: 'يعرّف الأعضاء بوظيفة البوت.', discordDescription: 'عرض معلومات Diskoko', permission: 'الجميع', example: 'مساعد مجتمعك في ديسكوكو.' },
]);
export const BOT_COMMAND_KEYS = Object.freeze(BOT_COMMANDS.map(command => command.key));
export const DEFAULT_BOT_COMMAND_KEYS = Object.freeze([...BOT_COMMAND_KEYS]);
export function validBotCommandKeys(keys) {
  return Array.isArray(keys) ? [...new Set(keys.map(String).filter(key => BOT_COMMAND_KEYS.includes(key)))] : [...DEFAULT_BOT_COMMAND_KEYS];
}
