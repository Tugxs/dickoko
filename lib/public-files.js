const publicFiles = new Set([
  'index.html', 'account.html', 'studio.html', 'checkout.html',
  'plans.html', 'privacy.html', 'terms.html', 'usage.html', 'why-diskoko.html',
  'knowledge.html', 'quickstart.html', 'faq.html', 'safety.html', 'reports.html',
  'contact.html', 'status.html', 'changelog.html', 'bot-docs.html',
  'discord-permissions.html', 'fair-use.html', 'cookie-policy.html',
  'dpa.html', 'refund-policy.html', 'delete-account.html', 'security-vulnerability.html',
  'app.js', 'control-center.js', 'mouse-field.js', 'account.js', 'checkout.js', 'workspace.js', 'ai-library-catalog.js',
  'reports.js',
  'styles.css', 'dashboard.css', 'workspace.css', 'checkout.css', 'legal.css', 'logo-unified.css',
  'assets/diskoko-logo.png',
]);

export function isPublicStaticPath(pathname) {
  const path = String(pathname || '').replace(/^\/+/, '') || 'index.html';
  if (publicFiles.has(path)) return true;
  return !path.includes('/') && publicFiles.has(`${path}.html`);
}

