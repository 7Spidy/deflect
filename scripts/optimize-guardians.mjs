#!/usr/bin/env node
/**
 * art-src/<id>.png  ->  public/guardians/<id>.webp
 *
 * Resizes to 1080x1920 (cover) and applies a black-point crush so near-black
 * haze becomes true black: the engine composites the art with `screen`, which
 * shows anything above black.
 *
 *   npm run art
 *   npm run art -- --black-point 14 --quality 92
 */
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "art-src");
const OUT = path.join(ROOT, "public", "guardians");

const W = 1080;
const H = 1920;
const MAX_BYTES = 350 * 1024;
const BORDER = 8;
const BORDER_WARN = 3;

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v)) {
    console.error(`--${name} needs a number`);
    process.exit(2);
  }
  return v;
}

const BP = flag("black-point", 10);
const QUALITY = flag("quality", 88);

/** Max luminance (0..255) over the outer BORDER px of an image. */
async function borderMax(input) {
  const { data, info } = await sharp(input)
    .removeAlpha()
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let max = 0;
  for (let y = 0; y < height; y++) {
    const edgeRow = y < BORDER || y >= height - BORDER;
    for (let x = 0; x < width; x++) {
      if (!edgeRow && x >= BORDER && x < width - BORDER) {
        x = width - BORDER - 1; // skip the interior of this row
        continue;
      }
      const v = data[(y * width + x) * channels];
      if (v > max) max = v;
    }
  }
  return max;
}

async function main() {
  let files;
  try {
    files = (await readdir(SRC)).filter((f) => f.toLowerCase().endsWith(".png")).sort();
  } catch {
    console.error(`No ${path.relative(ROOT, SRC)}/ directory. Put the source PNGs there.`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No PNGs in ${path.relative(ROOT, SRC)}/`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  const a = 255 / (255 - BP);
  const b = -(BP * 255) / (255 - BP);
  console.log(`black point ${BP}, quality ${QUALITY}`);

  let failed = false;
  for (const file of files) {
    const id = file.replace(/\.png$/i, "");
    const src = path.join(SRC, file);
    const dest = path.join(OUT, `${id}.webp`);

    const meta = await sharp(src).metadata();
    const aspect = meta.width / meta.height;
    if (Math.abs(aspect / (W / H) - 1) > 0.01) {
      console.warn(
        `  warn ${id}: source is ${meta.width}x${meta.height} (${aspect.toFixed(3)}), not 9:16; cover will crop`,
      );
    }

    const resized = await sharp(src)
      .removeAlpha()
      .resize(W, H, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    const before = await borderMax(resized);

    const crushed = await sharp(resized).linear(a, b).png().toBuffer();
    const after = await borderMax(crushed);

    await sharp(crushed).webp({ quality: QUALITY, effort: 6 }).toFile(dest);
    const { size } = await stat(dest);
    const kb = (size / 1024).toFixed(0);

    let note = "";
    if (size > MAX_BYTES) {
      note += `  FAIL over ${MAX_BYTES / 1024} KB, lower --quality`;
      failed = true;
    }
    if (after > BORDER_WARN) note += `  WARN border luminance ${after} > ${BORDER_WARN}`;
    console.log(`  ${id.padEnd(20)} ${kb.padStart(5)} KB  border max ${before} -> ${after}${note}`);
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
