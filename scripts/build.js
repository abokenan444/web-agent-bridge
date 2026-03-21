const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'script', 'ai-agent-bridge.js');
const distDir = path.join(__dirname, '..', 'dist');
const dest = path.join(distDir, 'ai-agent-bridge.min.js');

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const code = fs.readFileSync(src, 'utf-8');

const minified = code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\n\s*\n/g, '\n')
  .replace(/^\s+/gm, '')
  .trim();

fs.writeFileSync(dest, `/* Web Agent Bridge v1.0.0 | MIT License */\n${minified}`);

const srcSize = (fs.statSync(src).size / 1024).toFixed(1);
const destSize = (fs.statSync(dest).size / 1024).toFixed(1);
console.log(`Build complete: ${srcSize}KB → ${destSize}KB (${dest})`);
