export const PLAN_CATALOG = Object.freeze({
  free: { name: 'Free', monthlyPrice: 0, annualPrice: 0, servers: 1, teamSeats: 1, changeSetsPerMonth: 10, scheduledMessages: 1, analyticsDays: 7, auditDays: 20, customBots: 1, customTemplates: 2 },
  starter: { name: 'Starter', monthlyPrice: 49, annualPrice: 490, servers: 1, teamSeats: 1, changeSetsPerMonth: 300, scheduledMessages: 20, analyticsDays: 30, auditDays: 90, customBots: 5, customTemplates: 20 },
  growth: { name: 'Growth', monthlyPrice: 129, annualPrice: 1290, servers: 3, teamSeats: 5, changeSetsPerMonth: 3000, scheduledMessages: 200, analyticsDays: 90, auditDays: 365, customBots: 20, customTemplates: 100 },
  business: { name: 'Business', monthlyPrice: 299, annualPrice: 2990, servers: 10, teamSeats: 20, changeSetsPerMonth: 15000, scheduledMessages: 1000, analyticsDays: 365, auditDays: 365, customBots: 100, customTemplates: 500 },
});

const LEGACY_PLANS = Object.freeze({ trial: 'free', complete: 'business', pro: 'growth', studio: 'business' });
export const BILLING_PLANS = new Set([...Object.keys(PLAN_CATALOG), ...Object.keys(LEGACY_PLANS)]);
export const BILLING_STATUSES = new Set(['trial', 'active', 'past_due', 'grace', 'cancelled', 'expired']);

export function canonicalPlan(plan) {
  const value = String(plan || 'free').toLowerCase();
  return LEGACY_PLANS[value] || (PLAN_CATALOG[value] ? value : 'free');
}

export function entitlementsFor(user) {
  const key = canonicalPlan(user?.plan);
  return { plan: key, ...PLAN_CATALOG[key] };
}

export function subscriptionAccess(subscription, now = new Date()) {
  const status = String(subscription?.status || 'trial');
  if (status === 'active' || status === 'trial') return { mode: 'full', reason: null };
  const graceUntil = subscription?.grace_until ? new Date(subscription.grace_until) : null;
  if ((status === 'past_due' || status === 'grace') && graceUntil && graceUntil > now) {
    return { mode: 'full', reason: 'payment_grace', graceUntil: graceUntil.toISOString() };
  }
  return { mode: 'read_only', reason: status === 'past_due' || status === 'grace' ? 'payment_overdue' : 'subscription_inactive' };
}

export function usageAlert(capacity) {
  if (!capacity || !Number.isFinite(capacity.limit) || capacity.limit <= 0) return null;
  const percent = Math.min(100, Math.round((capacity.used / capacity.limit) * 100));
  if (percent >= 100) return { level: 'blocked', percent, message: 'وصلت إلى الحد المتاح في خطتك.' };
  if (percent >= 80) return { level: 'warning', percent, message: 'استخدمت 80٪ أو أكثر من الحد المتاح.' };
  return null;
}

export function publicPlanCatalog() {
  return Object.entries(PLAN_CATALOG).map(([key, plan]) => ({ key, ...plan, annualSaving: plan.monthlyPrice * 12 - plan.annualPrice }));
}
