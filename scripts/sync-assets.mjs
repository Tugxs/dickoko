import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const files = fs.readdirSync(root).filter(name => name.endsWith('.html'));
const missing = [];
const changed = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const updated = source.replace(/\b(href|src)=(['"])([^'"?#]+\.(?:css|js))(?:\?v=[^'"#]*)?\2/g, (match, attribute, quote, url) => {
    if (/^(?:https?:)?\/\//i.test(url)) return match;
    const relative = url.replace(/^\//, '');
    const asset = path.resolve(root, relative);
    if (!asset.startsWith(root + path.sep) || !fs.existsSync(asset)) { missing.push(`${file}: ${url}`); return match; }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(asset)).digest('hex').slice(0, 10);
    return `${attribute}=${quote}${url}?v=${hash}${quote}`;
  });
  if (updated !== source) {
    changed.push(file);
    if (!checkOnly) fs.writeFileSync(path.join(root, file), updated);
  }
}
if (missing.length) { console.error(`Missing assets:\n${missing.join('\n')}`); process.exit(1); }
if (checkOnly && changed.length) { console.error(`Stale asset versions: ${changed.join(', ')}. Run npm run assets:sync.`); process.exit(1); }
console.log(checkOnly ? `Asset versions match content in ${files.length} HTML documents.` : `Updated asset versions in ${changed.length} HTML documents.`);
