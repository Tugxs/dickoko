import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const node = process.execPath;
for (const [name, args] of [
  ['syntax', ['--check', 'server.js']],
  ['workspace syntax', ['--check', 'workspace.js']],
  ['account syntax', ['--check', 'account.js']],
  ['checkout syntax', ['--check', 'checkout.js']],
  ['local AI syntax', ['--check', 'scripts/local-ai-worker.mjs']],
  ['admin syntax', ['--check', 'admin-console.20260921.js']],
  ['bot syntax', ['--check', 'discord-bot.js']],
  ['API syntax', ['--check', 'lib/workspace-api.js']],
  ['tests', ['--test', ...readdirSync('tests').filter(name => name.endsWith('.test.js')).map(name => `tests/${name}`)]],
  ['static links', ['scripts/check-static.mjs']],
  ['asset versions', ['scripts/sync-assets.mjs', '--check']],
  ['secret scan', ['scripts/check-secrets.mjs']],
]) {
  process.stdout.write(`\n[${name}]\n`);
  const result = spawnSync(node, args, { stdio: 'inherit', cwd: process.cwd() });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nLocal audit passed. Run npm audit --omit=dev --audit-level=high in CI for current dependency advisories.');
