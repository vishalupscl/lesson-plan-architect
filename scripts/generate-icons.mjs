// Generates the PWA icons (open-book glyph on the app's teal) without any
// image dependencies: pixels are drawn in a buffer and encoded as PNG using
// node's zlib. Run `node scripts/generate-icons.mjs` and commit the PNGs —
// this script is not part of the build.

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const OUT_DIR = path.join(PUBLIC_DIR, "icons");

/* ---------------- minimal PNG encoder ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData));
  return Buffer.concat([len, typeData, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------------- drawing ---------------- */

const TEAL_TOP = [0x37, 0x7d, 0x77];
const TEAL_BOTTOM = [0x1d, 0x4b, 0x46];
const WHITE = [0xff, 0xff, 0xff];
const PAGE_SHADOW = [0xd9, 0xea, 0xe7];

function lerp(a, b, t) { return a + (b - a) * t; }

// Signed-area based point-in-triangle test.
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function inQuad(px, py, q) {
  return inTriangle(px, py, q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1])
    || inTriangle(px, py, q[0][0], q[0][1], q[2][0], q[2][1], q[3][0], q[3][1]);
}

// Render one icon at `size`, supersampled 4x for smooth edges.
// rounded: transparent rounded corners; glyphScale: book size relative to canvas.
function renderIcon(size, { rounded = true, glyphScale = 1 } = {}) {
  const SS = 4;
  const S = size * SS;
  const cx = S / 2;
  const cy = S * 0.55;
  const g = glyphScale;

  const halfW = 0.27 * S * g;
  const gap = 0.012 * S * g;
  const topOuter = cy - 0.14 * S * g;
  const topSpine = cy - 0.07 * S * g;
  const botOuter = cy + 0.10 * S * g;
  const botSpine = cy + 0.17 * S * g;

  const leftPage = [[cx - gap, topSpine], [cx - halfW, topOuter], [cx - halfW, botOuter], [cx - gap, botSpine]];
  const rightPage = [[cx + gap, topSpine], [cx + halfW, topOuter], [cx + halfW, botOuter], [cx + gap, botSpine]];
  // Slightly inset under-pages give the book depth.
  const dy = 0.028 * S * g;
  const leftUnder = leftPage.map(([x, y]) => [x, y + dy]);
  const rightUnder = rightPage.map(([x, y]) => [x, y + dy]);

  const radius = rounded ? 0.22 * S : 0;

  const big = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;

      // rounded-corner mask
      let alpha = 255;
      if (radius > 0) {
        const rx = x < radius ? radius - x : x > S - radius ? x - (S - radius) : 0;
        const ry = y < radius ? radius - y : y > S - radius ? y - (S - radius) : 0;
        if (rx > 0 && ry > 0 && rx * rx + ry * ry > radius * radius) alpha = 0;
      }

      let col;
      if (inQuad(x, y, leftPage) || inQuad(x, y, rightPage)) col = WHITE;
      else if (inQuad(x, y, leftUnder) || inQuad(x, y, rightUnder)) col = PAGE_SHADOW;
      else {
        const t = y / S;
        col = [
          Math.round(lerp(TEAL_TOP[0], TEAL_BOTTOM[0], t)),
          Math.round(lerp(TEAL_TOP[1], TEAL_BOTTOM[1], t)),
          Math.round(lerp(TEAL_TOP[2], TEAL_BOTTOM[2], t))
        ];
      }
      big[i] = col[0]; big[i + 1] = col[1]; big[i + 2] = col[2]; big[i + 3] = alpha;
    }
  }

  // Box-filter downsample SS×SS → 1 px.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += big[i]; gg += big[i + 1]; b += big[i + 2]; a += big[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(gg / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ---------------- outputs ---------------- */

fs.mkdirSync(OUT_DIR, { recursive: true });

const outputs = [
  ["icon-192.png", 192, { rounded: true, glyphScale: 1 }],
  ["icon-512.png", 512, { rounded: true, glyphScale: 1 }],
  // Maskable: full-bleed square, glyph inside the 80% safe zone.
  ["icon-maskable-512.png", 512, { rounded: false, glyphScale: 0.72 }],
  // iOS rounds its own corners; must be opaque. Served from the site root,
  // where iOS probes for it by default.
  ["../apple-touch-icon.png", 180, { rounded: false, glyphScale: 0.85 }]
];

for (const [name, size, opts] of outputs) {
  const png = encodePng(size, size, renderIcon(size, opts));
  const outPath = path.join(OUT_DIR, name);
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${path.relative(path.join(PUBLIC_DIR, ".."), outPath)} (${png.length} bytes)`);
}
