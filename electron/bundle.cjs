const path = require('node:path');

const APP_URL = 'wordtrail://app/';
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff'
};

// Decode before resolving, and check using the host OS's path rules (including
// backslashes on Windows). Never expose files outside the production bundle.
function resolveBundlePath(root, requestUrl) {
  const url = new URL(requestUrl);
  if (url.protocol !== 'wordtrail:' || url.hostname !== 'app' || url.port || url.username || url.password) return null;
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.includes(':')) return null;
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? file : null;
}

function isAppUrl(value, devUrl) {
  try {
    const url = new URL(value);
    if (devUrl) return url.origin === new URL(devUrl).origin;
    return url.protocol === 'wordtrail:' && url.host === 'app' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

module.exports = { APP_URL, isolationHeaders, resolveBundlePath, isAppUrl, isExternalUrl };
