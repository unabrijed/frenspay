// Crops the four source illustrations so every one puts its horizon on the same
// row, then encodes them for the web. Run from the monorepo root:
//
//   node apps/landing/scripts/scenes.mjs
//
// Sources are the untracked PNGs at apps/landing/*.png. Output is committed.
//
// Why crop instead of positioning at runtime: a 16:9 image under object-fit:cover
// fills the height of every real viewport, so object-position's vertical term is
// pinned and the horizon cannot be moved. Baking one shared aspect + one shared
// horizon fraction into the files makes the lock free — the CSS needs no
// per-image values at all.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const SRC_W = 1672;
const SRC_H = 941;

// Output box. Bounded at both ends by the two extreme sources: `play` has the
// least sky above its waterline (602px) and `pay` the least water below it
// (188px). 720 @ 0.7597 clears both with ~15px to spare on the tighter one.
const OUT_W = SRC_W;
const OUT_H = 720;
const HORIZON_ROW = 547;

// Waterline y in each source. These were read off the art, not detected: the
// obvious "largest luminance drop across the row means" heuristic picks the haze
// band or the mountains' mid-mass on three of the four, and lands 20-30px high.
// A wrong value here shows up as the sea jumping on slide change, which
// check-scenes.mjs catches by correlating the scenes against each other.
const SCENES = [
  { word: 'play', horizon: 602 }, // ocean horizon under the sun, right of the headland
  { word: 'stay', horizon: 610 }, // far shoreline left and right of the island
  { word: 'pay', horizon: 753 }, // sea meeting the distant hills, left of the bridge
  { word: 'relay', horizon: 612 }, // where the islands meet their reflections
];

// One width only. A second, smaller candidate would never be chosen: the scene
// renders at 130vw on desktop and 260vw on phones, so every real viewport asks
// for more CSS pixels than the viewport is wide and picks the largest candidate
// anyway. srcset here would be mechanism serving nothing.
const WIDTHS = [2000];

const appDir = path.resolve(import.meta.dirname, '..');
const outDir = path.join(appDir, 'public', 'scenes');

const hex = (r, g, b) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

// The seeds above are read off the art to ~5px. Snap each to the steepest
// sky->water step within ±20 rows so the number is repeatable rather than
// eyeballed — check-scenes.mjs runs the same search on the output, and an
// operator-supplied seed would otherwise disagree with it by a few pixels.
const SEED_WINDOW = 20;

async function refineHorizon(src, seed) {
  const { data, info } = await sharp(src).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rowMean = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = 0; x < width; x += 1) sum += data[y * width + x];
    rowMean[y] = sum / width;
  }
  const drop = (y) => rowMean[y - 3] - rowMean[y + 3];
  let best = seed;
  for (let y = Math.max(3, seed - SEED_WINDOW); y <= Math.min(height - 4, seed + SEED_WINDOW); y += 1) {
    if (drop(y) > drop(best)) best = y;
  }
  return best;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const skies = {};

  for (const { word, horizon: seed } of SCENES) {
    const src = path.join(appDir, `${word}.png`);
    const meta = await sharp(src).metadata();
    if (meta.width !== SRC_W || meta.height !== SRC_H) {
      throw new Error(`${word}.png is ${meta.width}x${meta.height}, expected ${SRC_W}x${SRC_H}`);
    }

    const horizon = await refineHorizon(src, seed);
    console.log(`${word.padEnd(6)} horizon ${horizon} (seed ${seed})`);

    const top = horizon - HORIZON_ROW;
    if (top < 0 || top + OUT_H > SRC_H) {
      throw new Error(`${word}: crop rows ${top}..${top + OUT_H} fall outside the source`);
    }

    const cropped = await sharp(src)
      .extract({ left: 0, top, width: OUT_W, height: OUT_H })
      .toBuffer();

    // The page background continues this colour above the scene, so the image
    // needs no top edge. It has to be the true mean of row 0: a sharp resize to
    // 1x1 lands a few units off, and 8 units of blue is enough to draw a visible
    // band across the sky. Measured separately: these skies are flat over the
    // top 80 rows, so one colour genuinely continues them — there is no gradient
    // to match.
    const { data: raw } = await sharp(cropped)
      .extract({ left: 0, top: 0, width: OUT_W, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const acc = [0, 0, 0];
    for (let x = 0; x < OUT_W; x += 1) {
      acc[0] += raw[x * 3];
      acc[1] += raw[x * 3 + 1];
      acc[2] += raw[x * 3 + 2];
    }
    skies[word] = hex(...acc.map((c) => Math.round(c / OUT_W)));

    for (const width of WIDTHS) {
      const out = path.join(outDir, `${word}-${width}.webp`);
      const buf = await sharp(cropped).resize(width).webp({ quality: 80 }).toBuffer();
      await writeFile(out, buf);
      console.log(`${path.relative(appDir, out)}  ${(buf.length / 1024).toFixed(0)}KB`);
    }
  }

  // Stamped so a later reader can tell whether public/scenes matches this script.
  const manifest = {
    out: { width: OUT_W, height: OUT_H, horizonRow: HORIZON_ROW },
    aspect: Number((OUT_W / OUT_H).toFixed(4)),
    horizon: Number((HORIZON_ROW / OUT_H).toFixed(4)),
    skies,
    sourceHashes: Object.fromEntries(
      await Promise.all(
        SCENES.map(async ({ word }) => [
          word,
          createHash('sha256')
            .update(await readFile(path.join(appDir, `${word}.png`)))
            .digest('hex')
            .slice(0, 12),
        ]),
      ),
    ),
  };
  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\naspect ${manifest.aspect}  horizon ${manifest.horizon}`);
  console.log('skies', skies);
}

await main();
