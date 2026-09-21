export const guild = { id: '111111111111111111', name: 'مجتمع التجربة', owner: true, permissions: '32', icon: null, connection: { install_status: 'installed' } };
const plans = [
  { key: 'free', name: 'Free', monthlyPrice: 0, annualPrice: 0, annualSaving: 0, servers: 1, teamSeats: 1, changeSetsPerMonth: 10, scheduledMessages: 1, analyticsDays: 7 },
  { key: 'starter', name: 'Starter', monthlyPrice: 49, annualPrice: 490, annualSaving: 98, servers: 1, teamSeats: 1, changeSetsPerMonth: 300, scheduledMessages: 20, analyticsDays: 30 },
  { key: 'growth', name: 'Growth', monthlyPrice: 129, annualPrice: 1290, annualSaving: 258, servers: 3, teamSeats: 5, changeSetsPerMonth: 3000, scheduledMessages: 200, analyticsDays: 90 },
  { key: 'business', name: 'Business', monthlyPrice: 299, annualPrice: 2990, annualSaving: 598, servers: 10, teamSeats: 20, changeSetsPerMonth: 15000, scheduledMessages: 1000, analyticsDays: 365 },
];
export const account = { user: { id: 1, username: 'اختبار', plan: 'business' }, servers: [guild, { ...guild, id: '222222222222222222', name: 'مجتمع ثانٍ' }], plan: { plan: 'business', status: 'active' }, access: { mode: 'full' }, limits: { plan: 'business', servers: 10 }, usage: { servers: { used: 2, limit: 10 }, customBots: { used: 1, limit: 100 }, customTemplates: { used: 2, limit: 500 }, scheduledMessages: { used: 3, limit: 1000 }, changeSetsPerMonth: { used: 4, limit: 15000 } }, alerts: [], invoices: [], plans };
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
