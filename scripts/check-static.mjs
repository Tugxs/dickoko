import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const files = fs.readdirSync(root).filter(name => name.endsWith('.html'));
const dynamicRoutes = new Set(['/admin', '/admin-login', '/dashboard', '/login', '/studio']);
const errors = [];
for (const file of files) {
  const document = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8')).window.document;
  for (const element of document.querySelectorAll('[href], [src]')) {
    const attribute = element.hasAttribute('href') ? 'href' : 'src';
    const value = element.getAttribute(attribute)?.trim();
    if (!value || value.startsWith('#') || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(value)) continue;
    const url = new URL(value, `https://diskoko.local/${file}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/') || pathname.startsWith('/auth/') || dynamicRoutes.has(pathname)) continue;
    const relative = pathname.replace(/^\//, '') || 'index.html';
    if (relative.includes('..') || !fs.existsSync(path.join(root, relative))) errors.push(`${file}: ${attribute}=${value}`);
  }
}
if (errors.length) {
  console.error(`Broken local links/assets:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`Checked local links and assets in ${files.length} HTML documents.`);
