// Emits every derived brand asset. Run from the monorepo root: `yarn brand`.
// Outputs are committed — nothing at build time depends on this script.
//
// ONE source: logo-icon.svg, the square cut (1:1). Under frenspay v2 it is the mark
// everywhere — favicons, app icons, avatars AND the landing header, which used to run the
// wide lockup. Two shapes was one shape too many: the apps had already hand-inlined the icon
// cut (packages/ui + apps/mobile primitives.tsx), so the lockup only ever appeared in one
// header while claiming to be the horizontal mark.
//
// The lockup and the f mark are both retired. Neither is read here and nothing should
// reference them; brand/logo-lockup.svg is kept only as the drawing it was authored as.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const CREAM = '#fce8cb'; // brand.paper
const TERRA = '#b94f2b'; // brand.terracotta — matches the artwork's own fill

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
 *  Spectral, so it cannot be typeset into a raster, and outlining it would need the
 *  font file, which is not in the repo. SVG-only for that reason. */
function stacked(colour) {
  const W = 512;
  const H = 340;
  // Spectral 300, lowercase, -0.018em — the system's display setting. `frenspay` is brand
  // copy, so it is the voice and never the mono.
  const word =
    `<text x="${W / 2}" y="316" text-anchor="middle" fill="${colour}" ` +
    `font-family="Spectral, Georgia, serif" ` +
    `font-size="72" font-weight="300" letter-spacing="-1.3">frenspay</text>`;
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

// ---- web: landing / web / admin / lp -----------------------------------------------------------
for (const app of ['landing', 'web', 'admin', 'lp']) {
  await emit(`apps/${app}/src/app/icon.svg`, square(64, { bg: CREAM, radius: TILE_RADIUS }));
  await emit(`apps/${app}/src/app/apple-icon.png`, await png(square(180, { bg: CREAM })));
}

// ---- lp: home-screen install icons (manifest.ts). Full-bleed like apple-icon, the two sizes Chrome
// requires before it offers to install.
for (const size of [192, 512]) {
  await emit(`apps/lp/public/icon-${size}.png`, await png(square(size, { bg: CREAM })));
}

// ---- landing: the mark itself, in both shapes and both colourways ----------------------------
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

// ---- social: X / Twitter ----------------------------------------------------------------------
// Uploaded by hand; nothing at build time reads brand/social/. PNG because X will not take an SVG.
//
// Full-bleed, NOT the squircle used for icon.svg: X crops a profile picture to a circle, so a
// rounded-square plate only loses its corners.
//
// ICON_SCALE (0.66) is deliberately overridden. It is tuned for a squircle, where the corners are
// the constraint; here the constraint is the inscribed circle, and 0.66 leaves the ink only ~45% of
// the tile's height, which is what turns the mark to a blob at the 48px timeline size. The art's own
// box is 256x173 of the 256 viewBox, so at scale s the half-diagonal is 154.5s and must clear r=200
// — s <= 1.29, i.e. a scale term of 0.83. 0.78 takes most of that and keeps ~12px of air.
const AVATAR_SCALE = 0.78;
// Both colourways: which one holds up at 48px is a look-at-it call, and the second line is free.
await emit(
  'brand/social/x-avatar.png',
  await png(square(400, { bg: TERRA, colour: CREAM, scale: AVATAR_SCALE })),
);
await emit(
  'brand/social/x-avatar-cream.png',
  await png(square(400, { bg: CREAM, scale: AVATAR_SCALE })),
);

// Header, 1500x500. No wordmark and no tagline: the name is already the avatar and the X display
// name, and a third copy on the header is the thing to avoid. (It would also be impossible — see
// stacked() on why sharp cannot typeset Hanken Grotesk.)
//
// `cover` + `bottom` crops ~195 rows of sky off the top, which is the most the source allows and
// puts the horizon at 69% of the banner. That matters: everything X overlays is along the bottom,
// so the two figures need to sit above it, and the bottom-left where the avatar lands must be
// empty. In `pay` it is open water.
const BANNER_SCENE = 'pay'; // swap to play / stay / relay — this is the only line that changes
await emit(
  'brand/social/x-banner.png',
  await sharp(resolve(REPO, `apps/landing/public/scenes/${BANNER_SCENE}-2000.webp`))
    .resize(1500, 500, { fit: 'cover', position: 'bottom' })
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
    `// GENERATED by brand/generate.mjs from brand/logo-icon.svg — do not edit.\n` +
      `// Run \`yarn brand\` after changing the artwork.\n` +
      `export const MARK = ${JSON.stringify(geometry(icon), null, 2)} as const;\n`,
  ),
);

console.log(written.map((p) => `  ${p}`).join('\n'));
console.log(`\n${written.length} assets written from brand/logo-icon.svg`);
