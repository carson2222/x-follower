/*
 * gen-icons.mjs — generates the extension PNG icons with zero dependencies.
 *
 * Draws a rounded-square gradient badge with a white clock glyph (the "temp"
 * idea = time-limited follow), supersampled 4x for clean anti-aliasing, and
 * encodes PNGs by hand using Node's built-in zlib.
 *
 * Run:  node scripts/gen-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "icons");
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersample factor

const TOP = [20, 184, 166]; // #14b8a6 teal
const BOTTOM = [13, 148, 136]; // #0d9488 teal-dark
const WHITE = [255, 255, 255];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function roundedRectAlpha(x, y, w, h, r) {
  // signed-distance-ish containment for a rounded rect
  const dx = Math.max(r - x, x - (w - r), 0);
  const dy = Math.max(r - y, y - (h - r), 0);
  return Math.hypot(dx, dy) <= r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function renderHiRes(size) {
  const W = size * SS;
  const H = size * SS;
  const buf = new Uint8ClampedArray(W * H * 4);

  const radius = W * 0.22;
  const cx = W / 2;
  const cy = H / 2;
  const R = W * 0.3; // clock radius
  const ring = W * 0.06; // ring thickness
  const handW = W * 0.045;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!roundedRectAlpha(x + 0.5, y + 0.5, W, H, radius)) {
        buf[i + 3] = 0;
        continue;
      }
      // gradient background
      const t = y / H;
      let r = lerp(TOP[0], BOTTOM[0], t);
      let g = lerp(TOP[1], BOTTOM[1], t);
      let b = lerp(TOP[2], BOTTOM[2], t);

      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const isRing = Math.abs(d - R) <= ring / 2;

      // minute hand (up) and hour hand (to ~4 o'clock)
      const dMin = distToSegment(x + 0.5, y + 0.5, cx, cy, cx, cy - R * 0.72);
      const dHour = distToSegment(
        x + 0.5,
        y + 0.5,
        cx,
        cy,
        cx + R * 0.5,
        cy + R * 0.12
      );
      const isHand = dMin <= handW || dHour <= handW;
      const isHub = d <= W * 0.035;

      if (isRing || isHand || isHub) {
        r = WHITE[0];
        g = WHITE[1];
        b = WHITE[2];
      }

      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  return { buf, W, H };
}

function downsample(hi, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const hx = x * SS + sx;
          const hy = y * SS + sy;
          const i = (hy * hi.W + hx) * 4;
          const af = hi.buf[i + 3] / 255;
          r += hi.buf[i] * af;
          g += hi.buf[i + 1] * af;
          b += hi.buf[i + 2] * af;
          a += hi.buf[i + 3];
        }
      }
      const n = SS * SS;
      const aSum = a / n;
      const af = aSum / 255;
      const o = (y * size + x) * 4;
      // un-premultiply so edge colors stay correct
      out[o] = af > 0 ? r / n / af : 0;
      out[o + 1] = af > 0 ? g / n / af : 0;
      out[o + 2] = af > 0 ? b / n / af : 0;
      out[o + 3] = aSum;
    }
  }
  return out;
}

// ---- minimal PNG encoder ---------------------------------------------------

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

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // raw scanlines with filter byte 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x++) {
      raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x];
    }
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- main ------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const hi = renderHiRes(size);
  const rgba = downsample(hi, size);
  const png = encodePng(rgba, size);
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png);
  console.log("wrote", file, png.length, "bytes");
}
