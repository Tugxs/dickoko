import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'work'].includes(entry.name)) continue;
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(relative);
    else if (entry.name.startsWith('.env') && entry.name !== '.env.example') files.push({ path: relative, privateEnv: true });
    else if (/\.(?:js|mjs|json|html|yaml|yml|md|txt)$/.test(entry.name)) files.push({ path: relative });
  }
}
walk(root);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:mfa\.[\w-]{50,}|(?:[MN][\w-]{23,28})\.[\w-]{6,7}\.[\w-]{25,40})\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/,
];
const findings = [];
for (const file of files) {
  if (file.privateEnv) { findings.push(`${path.relative(root, file.path)}: private environment file`); continue; }
  const text = fs.readFileSync(file.path, 'utf8');
  for (const pattern of patterns) if (pattern.test(text)) findings.push(`${path.relative(root, file.path)}: possible credential`);
}
if (findings.length) { console.error(findings.join('\n')); process.exit(1); }
console.log(`No obvious credentials or private .env files in ${files.length} source files.`);
