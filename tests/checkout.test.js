import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { account } from './fixtures.js';

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 5)); };

test('checkout reviews an authenticated upgrade and records a request without charging', async () => {
  const dom = new JSDOM(fs.readFileSync(new URL('../checkout.html', import.meta.url), 'utf8'), { url: 'https://diskoko.test/checkout.html?plan=growth&interval=annual', runScripts: 'outside-only' });
  const calls = [];
  dom.window.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const body = url === '/api/account/overview' ? { ...account, plan: { plan: 'free', status: 'trial' }, limits: { ...account.limits, plan: 'free' } }
      : url === '/api/csrf-token' ? { token: 'csrf' }
      : url === '/api/billing/quote' ? { quote: { plan: 'growth', billing_interval: 'annual', subtotal: 129000, discount: 0, total: 129000 } }
      : { request: { total: 129000 } };
    return { ok: true, json: async () => body };
  };
  dom.window.eval(fs.readFileSync(new URL('../checkout.js', import.meta.url), 'utf8'));
  await settle();
  const doc = dom.window.document;
  assert.match(doc.body.textContent, /لن يُخصم منك شيء/);
  assert.match(doc.querySelector('#total').textContent, /١٬٢٩٠|1,290/);
  assert.equal(doc.querySelector('#confirmUpgrade').disabled, false);
  assert.equal(doc.querySelectorAll('input[type="password"],input[autocomplete="cc-number"]').length, 0);
  doc.querySelector('#confirmUpgrade').click(); await settle();
  assert.equal(calls.filter(call => call.url === '/api/billing/upgrade-requests').length, 1);
  assert.match(doc.body.textContent, /لم تُجرَ عملية دفع/);
  dom.window.close();
});
