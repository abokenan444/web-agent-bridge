// Generate a 128x128 branded PNG icon for the WAB VS Code extension.
// Pure Node, no external deps. Run: `node scripts/make-icon.js`
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 128;
const OUT = path.join(__dirname, '..', 'media', 'icon.png');

// ── Pixel buffer (RGBA) ────────────────────────────────────────────────
const pixels = Buffer.alloc(SIZE * SIZE * 4);

// Brand palette — WAB purple → blue gradient with subtle bridge glyph.
const C_BG_TOP    = [0x6E, 0x3FF6 & 0xFF, 0xF6]; // not used, replaced below
const C_TOP       = [0x7C, 0x3A, 0xED]; // violet-600
const C_BOTTOM    = [0x22, 0x55, 0xF6]; // indigo-500ish
const C_FG        = [0xFF, 0xFF, 0xFF];
const C_DOT       = [0xFF, 0xD2, 0x4A]; // amber accent

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function setPx(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) { return; }
  const i = (y * SIZE + x) * 4;
  pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
}

// Rounded-square mask radius
const RADIUS = 22;
function inRoundedRect(x, y) {
  const left = 0, top = 0, right = SIZE - 1, bottom = SIZE - 1;
  if (x >= left + RADIUS && x <= right - RADIUS) { return true; }
  if (y >= top + RADIUS && y <= bottom - RADIUS) { return true; }
  // corner test
  const cx = x < left + RADIUS ? left + RADIUS : right - RADIUS;
  const cy = y < top + RADIUS ? top + RADIUS : bottom - RADIUS;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

// 1) Fill background gradient (top → bottom)
for (let y = 0; y < SIZE; y++) {
  const t = y / (SIZE - 1);
  const r = lerp(C_TOP[0], C_BOTTOM[0], t);
  const g = lerp(C_TOP[1], C_BOTTOM[1], t);
  const b = lerp(C_TOP[2], C_BOTTOM[2], t);
  for (let x = 0; x < SIZE; x++) {
    if (inRoundedRect(x, y)) {
      setPx(x, y, r, g, b, 255);
    } else {
      setPx(x, y, 0, 0, 0, 0);
    }
  }
}

// 2) Draw "bridge" arch — two pillars + arc connecting them
function drawRect(x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (inRoundedRect(x, y)) { setPx(x, y, c[0], c[1], c[2]); }
    }
  }
}
function drawDisc(cx, cy, r, c) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r && inRoundedRect(x, y)) {
        setPx(x, y, c[0], c[1], c[2]);
      }
    }
  }
}
function drawArcBand(cx, cy, rOuter, rInner, c, yMax) {
  for (let y = cy - rOuter; y <= yMax; y++) {
    for (let x = cx - rOuter; x <= cx + rOuter; x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= rOuter * rOuter && d2 >= rInner * rInner && inRoundedRect(x, y)) {
        setPx(x, y, c[0], c[1], c[2]);
      }
    }
  }
}

// Bridge arch (white)
const archCx = 64, archCy = 78;
drawArcBand(archCx, archCy, 38, 32, C_FG, archCy);

// Pillars
drawRect(20, 78, 8, 30, C_FG);
drawRect(100, 78, 8, 30, C_FG);

// Roadway line (deck)
drawRect(16, 88, 96, 4, C_FG);

// Three "data" dots travelling across the bridge — agent traffic
drawDisc(40, 90, 4, C_DOT);
drawDisc(64, 90, 4, C_DOT);
drawDisc(88, 90, 4, C_DOT);

// 3) Top "AI" spark — small diamond above the arch center
function drawDiamond(cx, cy, r, c) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (Math.abs(x - cx) + Math.abs(y - cy) <= r && inRoundedRect(x, y)) {
        setPx(x, y, c[0], c[1], c[2]);
      }
    }
  }
}
drawDiamond(64, 32, 10, C_FG);
drawDiamond(64, 32, 5,  C_DOT);

// ── PNG encoder (RGBA, 8-bit) ──────────────────────────────────────────
function crc32() {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
    T[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) { c = (T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0; }
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
}
const crc = crc32();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcVal]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8]  = 8;   // bit depth
ihdr[9]  = 6;   // color type RGBA
ihdr[10] = 0;   // compression
ihdr[11] = 0;   // filter
ihdr[12] = 0;   // interlace

// Add filter byte (0) at start of each scanline
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`Wrote ${OUT} (${png.length} bytes)`);
