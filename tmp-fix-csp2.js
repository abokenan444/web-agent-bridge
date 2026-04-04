const fs = require('fs');
const file = '/var/www/webagentbridge/server/index.js';
let src = fs.readFileSync(file, 'utf8');

// Replace line by line for robustness
src = src.replace(
  /connectSrc:\s*\["'self'",\s*'ws:',\s*'wss:'\]/,
  `connectSrc: ["'self'", 'ws:', 'wss:', 'https://web-agent-bridge-production.up.railway.app']`
);

src = src.replace(
  /fontSrc:\s*\["'self'",\s*'https:',\s*'data:'\]/,
  `fontSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'data:']`
);

src = src.replace(
  /frameSrc:\s*\["'none'"\]/,
  `frameSrc: ["'self'", 'https://web-agent-bridge-production.up.railway.app', 'https://www.youtube.com']`
);

src = src.replace(
  /frameAncestors:\s*\["'none'"\]/,
  `frameAncestors: ["'self'"]`
);

// Add mediaSrc after frameAncestors if not present
if (!src.includes('mediaSrc')) {
  src = src.replace(
    /frameAncestors: \["'self'"\],/,
    `frameAncestors: ["'self'"],\n        mediaSrc: ["'self'", 'blob:'],`
  );
}

fs.writeFileSync(file, src);

// Verify
const check = fs.readFileSync(file, 'utf8');
console.log('connectSrc OK:', check.includes('railway.app'));
console.log('frameSrc OK:', check.includes("frameSrc: [\"'self'\""));
console.log('fonts OK:', check.includes('fonts.googleapis.com'));
console.log('mediaSrc OK:', check.includes('mediaSrc'));
