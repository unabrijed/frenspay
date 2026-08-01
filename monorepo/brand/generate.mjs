// Emits every app icon from logo-mark.svg. Run from the monorepo root: `yarn brand`.
// Outputs are committed — nothing at build time depends on this script.
//
// Scales: 66% mark height matches the composition of src/icon-tile-1254.png. Android's adaptive
// foreground drops to 52% because its art must survive a full circular mask (the ink's
// circumscribed circle is 63% of the mark's own height, so 0.52 * 0.63 * 2 ≈ the 66% safe circle).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const CREAM = '#fff8f4'; // brand.canvas
const TERRA = '#c84b34'; // brand.terracottaContainer

const ICON_SCALE = 0.66; // mark height / canvas
const ADAPTIVE_SCALE = 0.52; // circular-mask safe
const TILE_RADIUS = 0.225; // squircle corner, fraction of the tile

const mark = await readFile(resolve(HERE, 'logo-mark.svg'), 'utf8');
const [, vbW, vbH] = mark.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
const ASPECT = vbW / vbH;

/** The mark's <path> elements, re-coloured and positioned on a `size` canvas at `scale` height. */
function placed(size, scale, colour) {
  const h = size * scale;
  const w = h * ASPECT;
  let paths = mark.slice(mark.indexOf('<path'), mark.lastIndexOf('</svg>'));
  if (colour) paths = paths.replace(/fill="#[0-9a-f]{6}"/g, `fill="${colour}"`);
  return `<g transform="translate(${(size - w) / 2} ${(size - h) / 2}) scale(${h / vbH})">${paths}</g>`;
}

function square(size, { bg, scale = ICON_SCALE, radius = 0, colour } = {}) {
  const r = size * radius;
  const plate = bg
    ? `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${bg}"/>`
    : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
      `viewBox="0 0 ${size} ${size}">${plate}${placed(size, scale, colour)}</svg>`,
  );
}

const written = [];
async function emit(relPath, buf) {
  const out = resolve(REPO, relPath);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, buf);
  written.push(relPath);
}

const png = (svg) => sharp(svg).png({ compressionLevel: 9 }).toBuffer();

// ---- web: landing / web / admin -------------------------------------------------------------
for (const app of ['landing', 'web', 'admin']) {
  await emit(`apps/${app}/src/app/icon.svg`, square(64, { bg: CREAM, radius: TILE_RADIUS }));
  await emit(`apps/${app}/src/app/apple-icon.png`, await png(square(180, { bg: CREAM })));
}

// The bare mark, for the landing lockup (components/Logo.tsx pairs it with live wordmark text).
await emit('apps/landing/public/logo-mark.svg', mark);

// ---- landing: social card --------------------------------------------------------------------
// Derived from the approved reversed lockup (terracotta field, cream mark + FrensPay wordmark)
// rather than re-typeset here — sharp has no access to Hanken Grotesk.
await emit(
  'apps/landing/src/app/opengraph-image.png',
  await sharp(resolve(HERE, 'src/lockup-stacked-terracotta-1672.png'))
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

// ---- mobile ----------------------------------------------------------------------------------
const M = 'apps/mobile/assets/images';
await emit(`${M}/icon.png`, await png(square(1024, { bg: CREAM })));
await emit(`${M}/favicon.png`, await png(square(48, { bg: CREAM })));
await emit(`${M}/splash-icon.png`, await png(square(1024)));
await emit(
  `${M}/android-icon-background.png`,
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: CREAM } })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
await emit(
  `${M}/android-icon-foreground.png`,
  await png(square(1024, { scale: ADAPTIVE_SCALE })),
);
await emit(
  `${M}/android-icon-monochrome.png`,
  await png(square(1024, { scale: ADAPTIVE_SCALE, colour: '#000000' })),
);

console.log(written.map((p) => `  ${p}`).join('\n'));
console.log(`\n${written.length} assets written from brand/logo-mark.svg`);
