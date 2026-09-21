const base = (process.env.SMOKE_BASE_URL || 'https://diskoko.com').replace(/\/$/, '');
async function check(route, expectedStatus, verify = () => true) {
  const response = await fetch(`${base}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  if (response.status !== expectedStatus || !verify(response, body)) throw new Error(`${route}: unexpected response (${response.status})`);
  console.log(`${response.status} ${route}`);
}
await check('/api/health', 200, (_response, body) => {
  const health = JSON.parse(body);
  return health.ok === true && health.database === 'ready' && typeof health.bot?.online === 'boolean';
});
await check('/', 200, (_response, body) => body.includes('runnerCanvas') && body.includes('/assets/diskoko-logo.png'));
await check('/account.html', 200, (_response, body) => body.includes('id="workspace"'));
await check('/studio.html', 200, (_response, body) => body.includes('id="workspace"'));
await check('/assets/diskoko-logo.png', 200, response => response.headers.get('content-type')?.startsWith('image/png'));
await check('/admin', 302, response => response.headers.get('location') === '/admin-login');
await check('/admin-console.html', 301, response => response.headers.get('location') === '/admin');
await check('/api/admin/stats', 401);
console.log('Public smoke checks passed. Authenticated admin and Discord mutations require a separate signed-in verification.');
