export const guild = { id: '111111111111111111', name: 'مجتمع التجربة', owner: true, permissions: '32', icon: null, connection: { install_status: 'installed' } };
export const account = { user: { id: 1, username: 'اختبار', plan: 'complete' }, servers: [guild, { ...guild, id: '222222222222222222', name: 'مجتمع ثانٍ' }], plan: { plan: 'complete', status: 'active' }, limits: { servers: 5 }, usage: { customBots: { used: 1, limit: 5 }, changeSetsPerMonth: { used: 4, limit: 1000 } } };
export const workspace = { guild, connection: { status: 'installed', readable: true, checked_at: '2026-09-20T12:00:00Z' }, bot: { online: true }, channels: [{ id: 'c1', name: 'المجتمع', type: 4, position: 0 }, { id: 'c2', name: 'الدردشة', type: 0, parent_id: 'c1', position: 0 }, { id: 'c3', name: 'الملتقى', type: 2, parent_id: 'c1', position: 1 }], roles: [{ id: guild.id, name: '@everyone', permissions: '0', color: 0, position: 0 }, { id: 'r1', name: 'مشرف', permissions: '8', color: 10456575, position: 1 }], members: 24, onlineMembers: 5, changeSets: [], activity: [], draft: null, preferences: { analytics_enabled: false, analytics_started_at: null } };
export function fixtureResponse(url) {
  if (url === '/api/account/overview') return account;
  if (url === `/api/workspace/${guild.id}`) return workspace;
  if (url.includes('/bot-settings')) return { settings: { enabled: true, command_keys: ['help', 'ping', 'about'], log_channel_id: null, locale: 'ar' } };
  if (url.includes('/schedules')) return { schedules: [] };
  if (url.includes('/analytics')) return { totals: { messages: 0, active_members: 0 }, members: [], channels: [], daily: [], days: 7 };
  if (url === '/api/workspace-templates') return { templates: [{ key: 'gaming', name: 'مجتمع ألعاب', categories: [{ name: 'مجتمع', channels: ['عام'] }], roles: ['عضو'], operations: [{ resource_type: 'channel', name: 'عام' }, { resource_type: 'role', name: 'عضو' }] }] };
  if (url === '/api/csrf-token') return { token: 'test-csrf' };
  return {};
}
