// Emits every derived brand asset. Run from the monorepo root: `yarn brand`.
// Outputs are committed — nothing at build time depends on this script.
//
// TWO sources, one per shape, because one mark cannot do both jobs:
//   logo-lockup.svg  2.05:1  headers and anything horizontal
//   logo-icon.svg    1:1     every square slot (favicon, app icon, avatar)
// The lockup dies below 32px in a square tile and wastes ~60% of its height
// there; see the comment in logo-icon.svg for why the square is redrawn rather
// than scaled. Feeding the lockup into a square output is the one mistake this
// script is arranged to make impossible.
//
// The f mark is retired. Nothing here reads it and nothing should reference it.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const CREAM = '#fff8f4'; // brand.canvas
const TERRA = '#a6341f'; // brand.terracotta — matches the artwork's own fill

const ICON_SCALE = 0.66; // mark size / canvas
const ADAPTIVE_SCALE = 0.52; // survives Android's full circular mask
const TILE_RADIUS = 0.225; // squircle corner, fraction of the tile

/** Inner markup of an <svg>, skipping any leading XML comment and the root tag. */
function inner(text) {
  const open = text.indexOf('<svg');
  return text.slice(text.indexOf('>', open) + 1, text.lastIndexOf('</svg>')).trim();
}

/** viewBox as {x, y, w, h}. Must accept a non-zero origin: the lockup's is `85 30 342 167`. */
function viewBox(text) {
  const m = text.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
  if (!m) throw new Error('no parseable viewBox');
  const [x, y, w, h] = m.slice(1).map(Number);
  return { x, y, w, h };
}

/** Recolour every hex in the artwork. Must cover `stroke` as well as `fill`, and
 *  uppercase as well as lower: the curve is a stroke and the artwork is #A6341F,
 *  so a fill-only lowercase regex silently leaves the cream variants terracotta. */
function recolour(markup, colour) {
  if (!colour) return markup;
  return markup.replace(/(fill|stroke)="#[0-9a-fA-F]{3,8}"/g, (_, attr) => `${attr}="${colour}"`);
}

async function load(name) {
  const text = await readFile(resolve(HERE, name), 'utf8');
  return { markup: inner(text), vb: viewBox(text), text };
}

const lockup = await load('logo-lockup.svg');
const icon = await load('logo-icon.svg');

/** Place a source centred in a w x h box at `scale` of the box, fitting the
 *  SMALLER axis so a wide source can never silently overflow a square one.
 *  `fill="none"` on the group is load-bearing: the curve carries only a stroke
 *  and inherited its fill from the root <svg> we just discarded — without this it
 *  renders as a filled black blob. */
function place({ markup, vb }, w, h, scale, colour) {
  const s = Math.min((w * scale) / vb.w, (h * scale) / vb.h);
  const tx = (w - vb.w * s) / 2 - vb.x * s;
  const ty = (h - vb.h * s) / 2 - vb.y * s;
  return `<g transform="translate(${tx} ${ty}) scale(${s})" fill="none">${recolour(markup, colour)}</g>`;
}

function svgDoc(w, h, body) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  );
}

/** Square tile: optional plate, always the icon cut. */
function square(size, { bg, scale = ICON_SCALE, radius = 0, colour } = {}) {
  const r = size * radius;
  const plate = bg ? `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${bg}"/>` : '';
  return svgDoc(size, size, plate + place(icon, size, size, scale, colour));
}

/** A standalone source file, recoloured, with its own viewBox preserved. */
function bare({ markup, vb }, colour) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" fill="none">` +
      `${recolour(markup, colour)}</svg>\n`,
  );
}

/** Mark over the wordmark. The wordmark stays LIVE TEXT: sharp has no access to
 *  Hanken Grotesk, so it cannot be typeset into a raster, and outlining it would
 *  need the font file, which is not in the repo. SVG-only for that reason. */
function stacked(colour) {
  const W = 512;
  const H = 340;
  const word =
    `<text x="${W / 2}" y="316" text-anchor="middle" fill="${colour}" ` +
    `font-family="Hanken Grotesk, ui-sans-serif, system-ui, sans-serif" ` +
    `font-size="72" font-weight="700" letter-spacing="-1.6">frenspay</text>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none">` +
      `${place(icon, W, 236, 0.92, colour)}${word}</svg>\n`,
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

// ---- web: landing / web / admin --------------------------------------------------------------
for (const app of ['landing', 'web', 'admin']) {
  await emit(`apps/${app}/src/app/icon.svg`, square(64, { bg: CREAM, radius: TILE_RADIUS }));
  await emit(`apps/${app}/src/app/apple-icon.png`, await png(square(180, { bg: CREAM })));
}

// ---- landing: the mark itself, in both shapes and both colourways ----------------------------
await emit('apps/landing/public/logo-lockup.svg', bare(lockup));
await emit('apps/landing/public/logo-lockup-cream.svg', bare(lockup, CREAM));
await emit('apps/landing/public/logo-icon.svg', bare(icon));
await emit('apps/landing/public/logo-icon-cream.svg', bare(icon, CREAM));
await emit('apps/landing/public/logo-stacked.svg', stacked(TERRA));
await emit('apps/landing/public/logo-stacked-cream.svg', stacked(CREAM));

// ---- landing: social card --------------------------------------------------------------------
// Cream icon cut on the terracotta field. Mark-only for the font reason above.
const OG_W = 1200;
const OG_H = 630;
await emit(
  'apps/landing/src/app/opengraph-image.png',
  await sharp({ create: { width: OG_W, height: OG_H, channels: 4, background: TERRA } })
    .composite([{ input: svgDoc(OG_W, OG_H, place(icon, OG_W, OG_H, 0.38, CREAM)) }])
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

// ---- mobile (parked out of the workspace, but must not be left on the retired f) --------------
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
await emit(`${M}/android-icon-foreground.png`, await png(square(1024, { scale: ADAPTIVE_SCALE })));
await emit(
  `${M}/android-icon-monochrome.png`,
  await png(square(1024, { scale: ADAPTIVE_SCALE, colour: '#000000' })),
);

// ---- geometry for the animated React lockup ---------------------------------------------------
// The header logo is inline SVG, not an <img>, because an <img> cannot be animated
// per-element and the dots and curve each move independently. Emitting the numbers
// keeps brand/*.svg the only place the shape is authored — otherwise the component
// becomes a second, silently diverging copy.
function geometry({ markup, vb }) {
  const dots = [...markup.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map((m) => ({
    cx: Number(m[1]),
    cy: Number(m[2]),
    r: Number(m[3]),
  }));
  const link = markup.match(/<path d="([^"]+)"/)?.[1];
  const strokeWidth = Number(markup.match(/stroke-width="([\d.]+)"/)?.[1]);
  if (dots.length !== 2 || !link || !strokeWidth) throw new Error('could not read geometry');
  return { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, dots, link, strokeWidth };
}

await emit(
  'apps/landing/src/components/frenspay/logo-geometry.ts',
  Buffer.from(
    `// GENERATED by brand/generate.mjs from brand/logo-lockup.svg — do not edit.\n` +
      `// Run \`yarn brand\` after changing the artwork.\n` +
      `export const LOCKUP = ${JSON.stringify(geometry(lockup), null, 2)} as const;\n`,
  ),
);

console.log(written.map((p) => `  ${p}`).join('\n'));
console.log(`\n${written.length} assets written from brand/logo-{lockup,icon}.svg`);
