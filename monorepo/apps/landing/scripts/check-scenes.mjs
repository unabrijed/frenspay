// Asserts the two things about public/scenes that can silently regress:
//
//   1. every scene puts its horizon on the same row, so the sea does not move
//      between slides;
//   2. cream foot chrome clears AA (4.5:1) over the scrim, on every scene, at
//      both the desktop and the mobile scene width.
//
//   node apps/landing/scripts/check-scenes.mjs
//
// (2) is the one worth automating: the foot sits on whatever the illustration
// happens to show there, `play`'s lit surf is much brighter than the other three,
// and nothing about the page would look broken if it slipped.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const appDir = path.resolve(import.meta.dirname, '..');
const sceneDir = path.join(appDir, 'public', 'scenes');
const WORDS = ['play', 'stay', 'pay', 'relay'];
const SCENE_PX = 2000; // the single exported width, see scenes.mjs WIDTHS

// Keep in step with globals.css.
const ASPECT = 2.3222;
const HORIZON_ROW_FRAC = 0.7597;
// Desktop only. Under 768px the foot does not overlay the scene at all — the
// backdrop stops at the foot row and the foot gets a solid ink plate, so cream
// on it is a flat 15.4:1 with nothing to measure. See the mobile block in
// globals.css for why overlaying cannot work on a phone.
const SCENE_W = 1.3; // multiples of 100vw
const VIEWPORT = { w: 1440, h: 900 };
// Mirrors the landing's own @theme block — the check measures the colours the page
// actually paints, so these move with the tokens or it measures nothing.
const CREAM = [252, 232, 203]; // --color-canvas (paper #fce8cb)
const INK = [43, 49, 49]; // --color-ink (#2b3131)
// .things-scrim: height --scrim-h, stops as fractions of that height going up.
const SCRIM_H = 0.2;
const SCRIM_STOPS = [
  [0.0, 0.86],
  [0.65, 0.72],
  [0.88, 0.3],
  [1.0, 0.0],
];
// Where foot text actually sits, as viewport fractions from the bottom. The
// foot's height sets how tall the scrim has to be, and therefore how much of the
// illustration gets darkened — so this shrank when the narrative copy moved out
// of the foot and up into the stage, leaving only the form down here.
const TEXT_ZONE = [0.02, 0.13];
const AA = 4.5;

const chan = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

function scrimAlpha(v, bandHeight) {
  const t = v / bandHeight; // position up the gradient, 0 at the bottom edge
  if (t >= 1) return 0;
  for (let i = 1; i < SCRIM_STOPS.length; i += 1) {
    const [t0, a0] = SCRIM_STOPS[i - 1];
    const [t1, a1] = SCRIM_STOPS[i];
    if (t <= t1) return a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
  }
  return 0;
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(sceneDir, 'manifest.json'), 'utf8'));
  let failures = 0;

  // --- 1. horizon alignment -------------------------------------------------
  const horizons = [];
  for (const word of WORDS) {
    const file = path.join(sceneDir, `${word}-${SCENE_PX}.webp`);
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    const rowLum = [];
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * channels;
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
      rowLum.push(sum / width);
    }
    // Search a tight window around the expected row. A whole-image search is
    // what produced the wrong crop first time round: on three of the four
    // scenes the biggest luminance drop is a haze band or the mountains' mid
    // mass, 20-30px above the water. `relay` is the reason the window has to be
    // this narrow rather than merely narrow — its decoy (the mountains, ~2.6%
    // above the waterline) beats the real edge at some resolutions and loses at
    // others, so anything wider than ~2% makes this check flip with the export
    // size. Widening it is not the fix if this ever fails.
    //
    // This cannot rediscover the horizon from scratch and is not meant to: the
    // crop puts it on HORIZON_ROW by construction, so what is verified is that
    // the files on disk still agree with each other and with the CSS.
    const expected = Math.round(HORIZON_ROW_FRAC * height);
    const span = Math.round(0.015 * height);
    let best = expected;
    for (let y = expected - span; y <= expected + span; y += 1) {
      if (rowLum[y - 3] - rowLum[y + 3] > rowLum[best - 3] - rowLum[best + 3]) best = y;
    }
    horizons.push({ word, row: best, frac: best / height, aspect: width / height, height });
  }

  const rows = horizons.map((h) => (h.frac * horizons[0].height) | 0);
  const spread = Math.max(...rows) - Math.min(...rows);
  console.log('horizon lock');
  for (const h of horizons) {
    console.log(
      `  ${h.word.padEnd(6)} row ${String(h.row).padStart(4)}  ${(h.frac * 100).toFixed(2)}%` +
        `  aspect ${h.aspect.toFixed(4)}`,
    );
  }
  // Scaled to a 1600px-wide scene these rows are ~1:1 with rendered pixels, so
  // 6 is about the most drift that stays invisible on swap.
  if (spread > 6) {
    console.log(`  FAIL spread ${spread}px exceeds 6px`);
    failures += 1;
  } else {
    console.log(`  ok  spread ${spread}px`);
  }
  if (Math.abs(horizons[0].aspect - ASPECT) > 0.005) {
    console.log(`  FAIL aspect ${horizons[0].aspect.toFixed(4)} != ${ASPECT} in globals.css`);
    failures += 1;
  }
  if (new Set(horizons.map((h) => `${h.aspect}`)).size > 1) {
    console.log('  FAIL scenes differ in aspect — re-run scenes.mjs');
    failures += 1;
  }

  // --- 2. cream on the scrimmed foot ---------------------------------------
  console.log('\ndesktop foot contrast (cream on scrim, AA 4.5:1)');
  const sceneH = (VIEWPORT.w * SCENE_W) / ASPECT / VIEWPORT.h; // scene height, viewport fractions

  for (const word of WORDS) {
    const file = path.join(sceneDir, `${word}-${SCENE_PX}.webp`);
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const sky = manifest.skies[word].match(/\w\w/g).map((h) => parseInt(h, 16));

    let worst = Infinity;
    let worstAt = 0;
    for (let step = 0; step <= 40; step += 1) {
      const v = TEXT_ZONE[0] + ((TEXT_ZONE[1] - TEXT_ZONE[0]) * step) / 40;
      // Above the scene the page background continues the scene's own sky.
      let bg = sky;
      if (v < sceneH) {
        const y = Math.min(height - 1, Math.round((1 - v / sceneH) * (height - 1)));
        // Brightest pixel in the row is the worst case for cream text.
        let brightest = null;
        let best = -1;
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * channels;
          const px = [data[i], data[i + 1], data[i + 2]];
          const l = lum(px);
          if (l > best) {
            best = l;
            brightest = px;
          }
        }
        bg = brightest;
      }
      const ratio = contrast(CREAM, over(INK, bg, scrimAlpha(v, SCRIM_H)));
      if (ratio < worst) {
        worst = ratio;
        worstAt = v;
      }
    }

    const ok = worst >= AA;
    if (!ok) failures += 1;
    console.log(
      `  ${word.padEnd(6)} ${ok ? 'ok  ' : 'FAIL'} ${worst.toFixed(2)}:1` +
        `  (worst at ${(worstAt * 100).toFixed(0)}% up)`,
    );
  }

  const plate = contrast(CREAM, INK);
  console.log(`\nmobile foot: cream on the solid ink plate ${plate.toFixed(1)}:1 (no scrim)`);
  if (plate < AA) failures += 1;

  console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

await main();
