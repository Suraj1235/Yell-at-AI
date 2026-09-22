// Generate the Subtext Desktop placeholder icon set.
//
// `tauri-build` refuses to build on Windows without `icons/icon.ico`, and
// `tauri build` needs the PNG/ICNS set, so these have to exist before the crate
// compiles at all. Rather than check in opaque binaries nobody can regenerate,
// the art is drawn here in plain Node - no dependencies, matching the rest of
// this repo - and the output is committed.
//
// The mark: a dark rounded square with a teal-to-violet waveform, which is the
// palette the landing page and the overlay pill already use. It is a
// placeholder, not a finished brand asset.
//
//   node apps/desktop/scripts/generate-icons.mjs
//
// Run from the repo root or from apps/desktop; paths resolve off this file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = join(HERE, "..", "src-tauri", "icons");

// Brand palette, same values as apps/desktop/src/*.html and apps/web/style.css.
const BACKDROP_TOP = [0x16, 0x19, 0x20];
const BACKDROP_BOTTOM = [0x0b, 0x0c, 0x0f];
const TEAL = [0x2d, 0xd4, 0xbf];
const VIOLET = [0x8b, 0x5c, 0xf6];

// Five bars, tallest slightly left of centre, like a spoken phrase peaking early.
const BAR_HEIGHTS = [0.3, 0.56, 0.8, 0.46, 0.32];
const SUPERSAMPLE = 4;

// --- drawing -------------------------------------------------------------

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t))
  ];
}

/** Signed distance from `(x, y)` to a rounded rectangle, negative inside. */
function roundedRectDistance(x, y, left, top, width, height, radius) {
  const cx = Math.abs(x - (left + width / 2)) - (width / 2 - radius);
  const cy = Math.abs(y - (top + height / 2)) - (height / 2 - radius);
  const dx = Math.max(cx, 0);
  const dy = Math.max(cy, 0);
  return Math.sqrt(dx * dx + dy * dy) + Math.min(Math.max(cx, cy), 0) - radius;
}

/** Render one RGBA pixel of the mark at unit coordinates in [0, 1). */
function shade(u, v) {
  const plateRadius = 0.22;
  const plate = roundedRectDistance(u, v, 0, 0, 1, 1, plateRadius);
  if (plate > 0) return [0, 0, 0, 0];

  // Backdrop: a vertical gradient so the mark does not read as a flat block.
  let [r, g, b] = mixColor(BACKDROP_TOP, BACKDROP_BOTTOM, v);
  let a = 255;

  // Rim light: a teal-to-violet hairline just inside the plate edge.
  const rim = 0.018;
  if (plate > -rim) {
    const strength = 1 - Math.abs(plate + rim / 2) / (rim / 2);
    const rimColor = mixColor(TEAL, VIOLET, (u + v) / 2);
    const weight = Math.max(0, Math.min(1, strength)) * 0.75;
    r = Math.round(lerp(r, rimColor[0], weight));
    g = Math.round(lerp(g, rimColor[1], weight));
    b = Math.round(lerp(b, rimColor[2], weight));
  }

  // Waveform bars.
  const barWidth = 0.088;
  const gap = 0.05;
  const span = BAR_HEIGHTS.length * barWidth + (BAR_HEIGHTS.length - 1) * gap;
  const startX = (1 - span) / 2;

  for (let index = 0; index < BAR_HEIGHTS.length; index += 1) {
    const left = startX + index * (barWidth + gap);
    const height = BAR_HEIGHTS[index];
    const top = (1 - height) / 2;
    const distance = roundedRectDistance(u, v, left, top, barWidth, height, barWidth / 2);
    if (distance > 0) continue;
    const barColor = mixColor(TEAL, VIOLET, index / (BAR_HEIGHTS.length - 1));
    r = barColor[0];
    g = barColor[1];
    b = barColor[2];
    a = 255;
  }

  return [r, g, b, a];
}

/** Render the mark at `size` px as RGBA, supersampled for clean edges. */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Accumulate premultiplied, so fully transparent samples outside the
      // rounded corners cannot darken the edge pixels.
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const u = (x * SUPERSAMPLE + sx + 0.5) * step;
          const v = (y * SUPERSAMPLE + sy + 0.5) * step;
          const [sr, sg, sb, sa] = shade(u, v);
          const alpha = sa / 255;
          rSum += sr * alpha;
          gSum += sg * alpha;
          bSum += sb * alpha;
          aSum += alpha;
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const offset = (y * size + x) * 4;
      if (aSum > 0) {
        pixels[offset] = Math.min(255, Math.round(rSum / aSum));
        pixels[offset + 1] = Math.min(255, Math.round(gSum / aSum));
        pixels[offset + 2] = Math.min(255, Math.round(bSum / aSum));
        pixels[offset + 3] = Math.min(255, Math.round((aSum / samples) * 255));
      } else {
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 0;
      }
    }
  }
  return pixels;
}

// --- PNG -----------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// --- ICO -----------------------------------------------------------------

/**
 * Classic BMP (DIB) icon entry. PNG-compressed entries are legal since Vista,
 * but the resource compilers in the Windows build path are happier with DIBs,
 * and `tauri-build` runs one of them on every Windows build.
 */
function encodeDib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR image + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const stride = size * 4;
  const xor = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * stride; // DIBs are bottom-up
    for (let x = 0; x < size; x += 1) {
      const from = source + x * 4;
      const to = y * stride + x * 4;
      xor[to] = rgba[from + 2]; // B
      xor[to + 1] = rgba[from + 1]; // G
      xor[to + 2] = rgba[from]; // R
      xor[to + 3] = rgba[from + 3]; // A
    }
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskStride * size, 0);
  header.writeUInt32LE(xor.length + and.length, 20);
  return Buffer.concat([header, xor, and]);
}

function encodeIco(entries) {
  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(entries.length, 4);
  let offset = directory.length;
  const blobs = [];
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0;
    directory[at + 3] = 0;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
    blobs.push(entry.data);
  });
  return Buffer.concat([directory, ...blobs]);
}

// --- ICNS ----------------------------------------------------------------

function encodeIcns(entries) {
  const blocks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(blocks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, 4, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

// --- main ----------------------------------------------------------------

function main() {
  mkdirSync(ICON_DIR, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const raster = new Map(sizes.map((size) => [size, render(size)]));
  const png = new Map(sizes.map((size) => [size, encodePng(size, raster.get(size))]));

  const written = [];
  const write = (name, data) => {
    writeFileSync(join(ICON_DIR, name), data);
    written.push({ name, bytes: data.length });
  };

  write("32x32.png", png.get(32));
  write("128x128.png", png.get(128));
  write("128x128@2x.png", png.get(256));
  write("icon.png", png.get(512));
  write(
    "icon.ico",
    encodeIco(
      [16, 24, 32, 48, 64, 128, 256].map((size) => ({
        size,
        data: encodeDib(size, raster.get(size))
      }))
    )
  );
  write(
    "icon.icns",
    encodeIcns([
      { type: "ic11", data: png.get(32) },
      { type: "ic12", data: png.get(64) },
      { type: "ic07", data: png.get(128) },
      { type: "ic08", data: png.get(256) },
      { type: "ic09", data: png.get(512) }
    ])
  );

  process.stdout.write(
    `${JSON.stringify(
      { schema: "subtext/desktop-icons/v1", directory: ICON_DIR, written },
      null,
      2
    )}\n`
  );
}

main();
