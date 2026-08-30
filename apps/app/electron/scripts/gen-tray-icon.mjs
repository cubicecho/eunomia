// Renders the tray icon — a minimalist clockface (ring + hands at 10:10) —
// and writes tray-icon.ts with the PNGs embedded as data URLs. Pure node
// (hand-rolled PNG encoder), so regenerating needs no image tooling:
//
//   node scripts/gen-tray-icon.mjs
//
// The icon is white-on-transparent: tray areas on Windows and most Linux
// desktops are dark. Electron's nativeImage can't rasterize SVG, hence PNG.
//
// The dashboard draws the same mark as vectors — apps/web/public/icon.svg
// (favicon) and apps/web/src/components/clock-mark.tsx (header) mirror the
// geometry below, so a design change here means editing those two too.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// --- drawing ---------------------------------------------------------------

/** Distance from point p to the segment (0,0)→b (hands start at the center). */
function distToSegment(px, py, bx, by) {
  const lenSq = bx * bx + by * by;
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.hypot(dx, dy);
}

/** Screen-coords unit vector for a clock angle (degrees clockwise from 12). */
const hand = (deg, len) => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a) * len, y: -Math.cos(a) * len };
};

/**
 * Coverage (0..1) of the clockface at a point, in coords centered on the
 * face with y down. Supersampled by the caller.
 */
function makeFace(size) {
  const rOuter = size * 0.47;
  const ring = size * 0.1; // ring stroke width
  const handW = size * 0.11; // hand stroke width
  // 10:10 — the classic watch-face pose; hands stop short of the ring, and
  // the hour hand is clearly shorter so it reads as a clock, not a chevron.
  const minute = hand(60, rOuter * 0.72);
  const hour = hand(305, rOuter * 0.42);
  return (x, y) => {
    const d = Math.hypot(x, y);
    if (Math.abs(d - (rOuter - ring / 2)) <= ring / 2) return 1;
    if (d < rOuter - ring) {
      if (distToSegment(x, y, minute.x, minute.y) <= handW / 2) return 1;
      if (distToSegment(x, y, hour.x, hour.y) <= handW / 2) return 1;
    }
    return 0;
  };
}

/** White RGBA bitmap of the face, 4×4 supersampled for smooth edges. */
function render(size) {
  const face = makeFace(size);
  const px = new Uint8Array(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS - size / 2;
          const fy = y + (sy + 0.5) / SS - size / 2;
          hits += face(fx, fy);
        }
      }
      const i = (y * size + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 255;
      px[i + 3] = Math.round((hits / (SS * SS)) * 255);
    }
  }
  return px;
}

/**
 * App-icon variant (installer, exe, Start menu): the same white face on a
 * dark disc, so it stays visible on Explorer's light background — unlike the
 * tray variant, which is bare white for dark tray areas.
 */
function renderAppIcon(size) {
  const face = makeFace(size * 0.94);
  const disc = size * 0.5 - size * 0.01;
  const px = new Uint8Array(size * size * 4);
  const SS = 4;
  const DARK = [22, 27, 34]; // the dashboard's panel color
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS - size / 2;
          const fy = y + (sy + 0.5) / SS - size / 2;
          if (face(fx, fy)) {
            r += 255;
            g += 255;
            b += 255;
            a += 1;
          } else if (Math.hypot(fx, fy) <= disc) {
            r += DARK[0];
            g += DARK[1];
            b += DARK[2];
            a += 1;
          }
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return px;
}

// --- PNG encoding ----------------------------------------------------------

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // Raw scanlines, each prefixed with filter byte 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO container with PNG-encoded entries (valid on Vista+). */
function encodeIco(sizes) {
  const pngs = sizes.map((s) => encodePng(s, renderAppIcon(s)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + 16 * sizes.length;
  for (let i = 0; i < sizes.length; i++) {
    const e = Buffer.alloc(16);
    e[0] = sizes[i] === 256 ? 0 : sizes[i]; // 0 means 256
    e[1] = sizes[i] === 256 ? 0 : sizes[i];
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

// --- output ----------------------------------------------------------------

const dataUrl = (size) =>
  `data:image/png;base64,${encodePng(size, render(size)).toString('base64')}`;

const out = `// Generated by scripts/gen-tray-icon.mjs — do not edit by hand.
// A minimalist clockface (white on transparent) at 1x and 2x tray sizes.

export const TRAY_ICON_16 = '${dataUrl(16)}';

export const TRAY_ICON_32 = '${dataUrl(32)}';
`;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
writeFileSync(join(root, 'tray-icon.ts'), out);

// electron-builder picks build/icon.ico up by convention (installer + exe).
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build', 'icon.ico'), encodeIco([16, 32, 48, 256]));

// Oversized preview for eyeballing the design, composited onto a dark tray
// background so the white face is visible (not shipped).
if (process.argv.includes('--preview')) {
  const size = 128;
  const px = render(size);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    px[i] = px[i + 1] = px[i + 2] = Math.round(255 * a + 32 * (1 - a));
    px[i + 3] = 255;
  }
  writeFileSync(join(root, 'tray-icon-preview.png'), encodePng(size, px));
}
console.log('wrote tray-icon.ts');
