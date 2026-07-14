#!/usr/bin/env node
/**
 * Generate PWA icons with zero dependencies.
 *
 * Draws a simple open-book glyph on a rounded indigo tile and encodes it as PNG
 * using only Node core (zlib for the IDAT deflate, hand-rolled CRC for chunks).
 * Produces the sizes referenced by manifest.webmanifest.
 */
import { deflateSync } from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "assets", "icons");

const BG = [79, 70, 229]; // indigo-600
const BG_DARK = [67, 56, 202]; // indigo-700 (subtle vertical shade)
const INK = [255, 255, 255];
const PAGE = [237, 233, 254]; // faint lavender page shading

// --- PNG encoding helpers ---------------------------------------------------
const crcTable = (() => {
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
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // rest zero (compression, filter, interlace)

  // Add a per-row filter byte (0 = none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Drawing ----------------------------------------------------------------
function draw(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  };

  // Maskable icons need their glyph inside the safe zone; give the tile full-bleed
  // background and shrink the book a touch.
  const radius = maskable ? 0 : size * 0.22;
  const inset = maskable ? size * 0.16 : size * 0.14;

  const inRoundedTile = (x, y) => {
    if (radius === 0) return true;
    const min = 0;
    const max = size - 1;
    const dx = x < radius ? radius - x : x > max - radius ? x - (max - radius) : 0;
    const dy = y < radius ? radius - y : y > max - radius ? y - (max - radius) : 0;
    return dx * dx + dy * dy <= radius * radius && x >= min && x <= max && y >= min && y <= max;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundedTile(x, y)) continue;
      // Vertical shade from BG (top) to BG_DARK (bottom).
      const t = y / size;
      const col = [
        Math.round(BG[0] * (1 - t) + BG_DARK[0] * t),
        Math.round(BG[1] * (1 - t) + BG_DARK[1] * t),
        Math.round(BG[2] * (1 - t) + BG_DARK[2] * t),
      ];
      set(x, y, col);
    }
  }

  // Open book: two pages meeting at a central spine, drawn as filled quads.
  const cx = size / 2;
  const top = inset + size * 0.12;
  const bottom = size - inset - size * 0.08;
  const left = inset;
  const right = size - inset;
  const spineTop = top + size * 0.02;
  const spineBottom = bottom;

  const fillTri = (ax, ay, bx, by, ccx, ccy, color, alpha = 255) => {
    const minX = Math.floor(Math.min(ax, bx, ccx));
    const maxX = Math.ceil(Math.max(ax, bx, ccx));
    const minY = Math.floor(Math.min(ay, by, ccy));
    const maxY = Math.ceil(Math.max(ay, by, ccy));
    const area = (bx - ax) * (ccy - ay) - (by - ay) * (ccx - ax);
    if (area === 0) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / area;
        const w1 = ((ccx - bx) * (py - by) - (ccy - by) * (px - bx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) set(x, y, color, alpha);
      }
    }
  };

  const quad = (p1, p2, p3, p4, color, alpha) => {
    fillTri(...p1, ...p2, ...p3, color, alpha);
    fillTri(...p1, ...p3, ...p4, color, alpha);
  };

  // Left page (slightly curved down at the outer edge).
  quad(
    [left, top + size * 0.04],
    [cx, spineTop],
    [cx, spineBottom],
    [left, bottom],
    INK
  );
  // Right page.
  quad(
    [cx, spineTop],
    [right, top + size * 0.04],
    [right, bottom],
    [cx, spineBottom],
    INK
  );

  // Faint page lines to suggest text.
  const lineColor = PAGE;
  const lines = 4;
  for (let i = 1; i <= lines; i++) {
    const ly = Math.round(top + size * 0.12 + ((bottom - top) * 0.62 * i) / (lines + 1));
    for (let x = Math.round(left + size * 0.06); x < Math.round(cx - size * 0.03); x++) set(x, ly, lineColor);
    for (let x = Math.round(cx + size * 0.03); x < Math.round(right - size * 0.06); x++) set(x, ly, lineColor);
  }

  // Spine.
  for (let y = Math.round(spineTop); y <= Math.round(spineBottom); y++) {
    for (let d = -1; d <= 1; d++) set(Math.round(cx) + d, y, BG_DARK);
  }

  return encodePNG(size, size, buf);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const targets = [
    { name: "icon-192.png", size: 192, opts: {} },
    { name: "icon-512.png", size: 512, opts: {} },
    { name: "icon-maskable-512.png", size: 512, opts: { maskable: true } },
    { name: "apple-touch-icon.png", size: 180, opts: {} },
    { name: "favicon-32.png", size: 32, opts: {} },
  ];
  for (const { name, size, opts } of targets) {
    const png = draw(size, opts);
    await writeFile(path.join(OUT_DIR, name), png);
    console.log(`Wrote assets/icons/${name} (${size}x${size}, ${png.length} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
