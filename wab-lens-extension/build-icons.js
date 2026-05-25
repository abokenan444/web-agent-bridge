// Build PNG icons for the WAB Lens extension. Pure Node, zero deps.
// Run: `node wab-lens-extension/build-icons.js`
//
// Produces icons/icon{16,32,48,128}.png with a dark navy background + a
// minimalist green WAB mark (centered square + check). The Web Store will
// accept these for review; for marketing you may want to swap them for
// higher-fidelity artwork later.

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Tiny PNG encoder (8-bit RGBA) ────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, c]);
}
function encodePng(size, draw) {
  // raw scanlines: filter byte 0 + RGBA pixels
  const stride = size * 4;
  const raw = Buffer.alloc(size * (1 + stride));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + stride)] = 0;
    for (let x = 0; x < size; x++) {
      const px = draw(x, y, size);
      const off = y * (1 + stride) + 1 + x * 4;
      raw[off] = px[0]; raw[off + 1] = px[1]; raw[off + 2] = px[2]; raw[off + 3] = px[3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Mark drawing ─────────────────────────────────────────────────────────
const BG = [11, 15, 23, 255];        // #0b0f17 navy
const FG = [16, 185, 129, 255];      // #10b981 emerald
const TR = [0, 0, 0, 0];             // transparent
function drawMark(x, y, size) {
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const dx = x - cx;
  const dy = y - cy;
  const r  = size * 0.5;
  // Rounded-square mask via Chebyshev distance with corner softening.
  const cheb = Math.max(Math.abs(dx), Math.abs(dy));
  if (cheb > r - 0.5) return TR;
  const corner = Math.hypot(Math.max(Math.abs(dx) - r * 0.7, 0), Math.max(Math.abs(dy) - r * 0.7, 0));
  if (corner > r * 0.3) return TR;
  // Check-mark: two segments forming a ✓ across the lower half.
  // Use SDF-like distance to two line segments.
  const nx = dx / r;
  const ny = dy / r;
  function segDist(ax, ay, bx, by) {
    const px = nx - ax, py = ny - ay;
    const wx = bx - ax, wy = by - ay;
    const t = Math.max(0, Math.min(1, (px * wx + py * wy) / (wx * wx + wy * wy)));
    const qx = ax + t * wx - nx;
    const qy = ay + t * wy - ny;
    return Math.hypot(qx, qy);
  }
  const d1 = segDist(-0.55, 0.05, -0.10, 0.45);
  const d2 = segDist(-0.10, 0.45,  0.55, -0.30);
  const thickness = Math.max(0.10, 1.6 / size);
  if (d1 < thickness || d2 < thickness) return FG;
  return BG;
}

// ── Emit files ───────────────────────────────────────────────────────────
const OUT = path.join(__dirname, 'icons');
fs.mkdirSync(OUT, { recursive: true });
for (const sz of [16, 32, 48, 128]) {
  const buf = encodePng(sz, drawMark);
  const p   = path.join(OUT, `icon${sz}.png`);
  fs.writeFileSync(p, buf);
  console.log(`wrote ${path.relative(process.cwd(), p)} (${buf.length} bytes)`);
}
