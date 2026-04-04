const fs = require('fs');
const file = '/var/www/webagentbridge/server/index.js';
let src = fs.readFileSync(file, 'utf8');

const oldCSP = `connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'https:', 'data:'],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],`;

const newCSP = `connectSrc: ["'self'", 'ws:', 'wss:', 'https://web-agent-bridge-production.up.railway.app'],
        fontSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'data:'],
        frameSrc: ["'self'", 'https://web-agent-bridge-production.up.railway.app', 'https://www.youtube.com'],
        frameAncestors: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],`;

if (src.includes(oldCSP)) {
  src = src.replace(oldCSP, newCSP);
  fs.writeFileSync(file, src);
  console.log('CSP updated successfully');
} else {
  console.log('Old CSP not found — may already be patched or different');
  const idx = src.indexOf('connectSrc');
  if (idx > -1) console.log('connectSrc found at char', idx, ':', src.substring(idx, idx + 80));
}
