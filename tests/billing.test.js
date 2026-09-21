import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPlan, entitlementsFor, publicPlanCatalog, subscriptionAccess, usageAlert } from '../lib/billing.js';

test('legacy plans migrate to the matching new entitlement', () => {
  assert.equal(canonicalPlan('trial'), 'free');
  assert.equal(canonicalPlan('complete'), 'business');
  assert.equal(entitlementsFor({ plan: 'complete' }).servers, 10);
});

test('annual pricing always gives exactly two months free', () => {
  for (const plan of publicPlanCatalog()) assert.equal(plan.annualSaving, plan.monthlyPrice * 2);
});

test('past due subscriptions keep full access only inside grace period', () => {
  const now = new Date('2026-09-21T00:00:00Z');
  assert.equal(subscriptionAccess({ status: 'past_due', grace_until: '2026-09-22T00:00:00Z' }, now).mode, 'full');
  assert.equal(subscriptionAccess({ status: 'past_due', grace_until: '2026-09-20T00:00:00Z' }, now).mode, 'read_only');
  assert.equal(subscriptionAccess({ status: 'expired' }, now).mode, 'read_only');
});

test('usage alerts appear at 80 percent and block at 100 percent', () => {
  assert.equal(usageAlert({ used: 79, limit: 100 }), null);
  assert.equal(usageAlert({ used: 80, limit: 100 }).level, 'warning');
  assert.equal(usageAlert({ used: 100, limit: 100 }).level, 'blocked');
});
