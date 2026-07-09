// Regenerates the app mark: `node scripts/gen-icons.mjs`
//
// The mark is three stacked bars — the Today column, seen from the side. The
// top bar is `--now` amber (what's on your mind); the two beneath are `--past`
// blue, each shorter and fainter, the same item receding into history.
//
// Geometry lives here once and is emitted BOTH as app/icon.svg and as the
// rasterized PNGs, so the vector and the bitmaps can never drift. No image
// libraries are installed (no sharp/rsvg/ImageMagick), so the rasterizer is
// hand-rolled below: rounded-rect coverage via a signed distance field, PNG
// via zlib. Pure geometry, so this stays about 100 lines.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// ── The mark, on a 64×64 grid (tokens copied from app/globals.css) ──────────
const BG = [11, 14, 26]; // --bg-0  #0b0e1a
const NOW = [227, 168, 102]; // --now   #e3a866
const PAST = [110, 139, 196]; // --past  #6e8bc4

const FIELD_RADIUS = 14; // rounded-square corner on the standalone icon
const BARS = [
  { x: 14, y: 14, w: 36, h: 9, r: 3.5, fill: NOW, alpha: 1 },
  { x: 14, y: 27.5, w: 30, h: 9, r: 3.5, fill: PAST, alpha: 0.75 },
  { x: 14, y: 41, w: 24, h: 9, r: 3.5, fill: PAST, alpha: 0.45 },
];

const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

// ── Rasterizer ─────────────────────────────────────────────────────────────

// Signed distance to a rounded rect, negative inside. Straight edges are exact,
// so `clamp(0.5 - d, 0, 1)` gives clean analytic antialiasing — sharper than
// supersampling and it costs one sample per pixel.
function sdf(px, py, { x, y, w, h, r }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// Source-over compositing into a straight-alpha RGBA buffer.
function paint(buf, size, rect, [sr, sg, sb], alpha, scale) {
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Sample at the pixel centre, in the 64-unit design space.
      const d = sdf((px + 0.5) / scale, (py + 0.5) / scale, rect) * scale;
      const sa = Math.min(Math.max(0.5 - d, 0), 1) * alpha;
      if (sa <= 0) continue;

      const i = (py * size + px) * 4;
      const da = buf[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      const mix = (s, dch) => (s * sa + (dch / 255) * da * (1 - sa)) / oa;

      buf[i] = Math.round(mix(sr, buf[i]));
      buf[i + 1] = Math.round(mix(sg, buf[i + 1]));
      buf[i + 2] = Math.round(mix(sb, buf[i + 2]));
      buf[i + 3] = Math.round(oa * 255);
    }
  }
}

// Scale a rect about the grid centre — used to inset content into a maskable
// icon's safe zone.
const shrink = (rect, s) => ({
  x: 32 + (rect.x - 32) * s,
  y: 32 + (rect.y - 32) * s,
  w: rect.w * s,
  h: rect.h * s,
  r: rect.r * s,
});

// `fieldRadius: 0` fills the square edge-to-edge (maskable + Apple, which do
// their own masking); otherwise the rounded square is the icon's own silhouette
// and everything outside it stays transparent.
function render(size, { fieldRadius = FIELD_RADIUS, content = 1 } = {}) {
  const buf = new Uint8Array(size * size * 4);
  const scale = size / 64;
  paint(buf, size, { x: 0, y: 0, w: 64, h: 64, r: fieldRadius }, BG, 1, scale);
  for (const bar of BARS) {
    paint(buf, size, shrink(bar, content), bar.fill, bar.alpha, scale);
  }
  return buf;
}

// ── PNG container ──────────────────────────────────────────────────────────
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, opts) {
  const rgba = render(size, opts);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO container (PNG-in-ICO, universally supported since IE11) ────────────
function ico(sizes) {
  const images = sizes.map((s) => png(s));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s;
    e[1] = s === 256 ? 0 : s;
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });

  return Buffer.concat([header, ...dir, ...images]);
}

// ── SVG (same numbers, so the vector matches the bitmaps exactly) ───────────
const svg = () =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`,
    `  <title>Working Memory</title>`,
    `  <rect width="64" height="64" rx="${FIELD_RADIUS}" fill="${hex(BG)}"/>`,
    ...BARS.map(
      (b) =>
        `  <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.r}" fill="${hex(b.fill)}"` +
        `${b.alpha < 1 ? ` fill-opacity="${b.alpha}"` : ""}/>`,
    ),
    `</svg>`,
  ].join("\n") + "\n";

// ── Emit ───────────────────────────────────────────────────────────────────
mkdirSync("public", { recursive: true });

const out = [
  // Browser tab. SVG is served to modern browsers; the .ico is the fallback.
  ["app/icon.svg", Buffer.from(svg())],
  ["app/favicon.ico", ico([16, 32, 48])],

  // iOS home screen. Apple applies its own squircle and refuses transparency,
  // so this one is full-bleed.
  ["app/apple-icon.png", png(180, { fieldRadius: 0 })],

  // Web app manifest.
  ["public/icon-192.png", png(192)],
  ["public/icon-512.png", png(512)],
  // Maskable: Android may crop to any shape, so the content sits inside the
  // safe zone (the centre 80%) on a full-bleed field.
  ["public/icon-maskable-512.png", png(512, { fieldRadius: 0, content: 0.72 })],
];

for (const [path, data] of out) {
  writeFileSync(path, data);
  console.log(`${path.padEnd(30)} ${data.length.toLocaleString()} bytes`);
}
