/* The checks behind the QR artwork. Run against a built export:
     yarn workspace @fpay/landing build && yarn workspace @fpay/landing check:artwork

   Three properties, none of which shows up as a type error or a failed build:

   1. The hero code is the REAL matrix for QR_URL. A wrong or corrupted payload
      still renders as a perfectly plausible QR, so this is compared module for
      module against what the library generates.
   2. Every module sits on the exact pitch. One stray `+ rnd()` in qrGeometry is
      all it takes to reintroduce the smear this system was built to remove.
   3. Opacity is drawn only from the quantized RAMP. The banding is the effect.

   Reads the exported HTML rather than importing the TS, so it needs no loader
   and no framework. */

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import QRCode from 'qrcode';

const M = 12;
const QUIET = 4;
const RAMP = ['1', '0.65', '0.5', '0.4', '0.3'];

const matrixSrc = readFileSync(new URL('../src/components/qrMatrix.ts', import.meta.url), 'utf8');
const QR_URL = /QR_URL = '([^']+)'/.exec(matrixSrc)[1];
const QR_ECC = /QR_ECC = '([^']+)'/.exec(matrixSrc)[1];

const html = readFileSync(new URL('../out/index.html', import.meta.url), 'utf8');
// Code modules are full pitch at rx 2; trail modules are inset by 1 at rx 2.5.
// Both shapes are captured so a module can never escape the checks by changing.
const re = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="\3" rx="([\d.]+)" opacity="([\d.]+)"[^>]*class="qr-px"/g;
const mods = [...html.matchAll(re)].map(([, x, y, w, rx, o]) => {
  const code = +w === M;
  // Normalise the trail's 1px inset back onto the pitch it was drawn from.
  return { x: +x - (code ? 0 : 1), y: +y - (code ? 0 : 1), w: +w, rx: +rx, o, code };
});

assert.ok(mods.length > 150, `expected the QR to render; found ${mods.length} modules`);

// --- 1. the code is the real thing -----------------------------------------
const { size, data } = QRCode.create(QR_URL, { errorCorrectionLevel: QR_ECC }).modules;
const wantDark = new Set();
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) if (data[y * size + x]) wantDark.add(`${x * M},${y * M}`);
}

// Modules left of the quiet zone are the code; anything beyond it is the trail.
const codeEdge = size * M;
const gotDark = new Set(mods.filter((m) => m.x < codeEdge).map((m) => `${m.x},${m.y}`));

const missing = [...wantDark].filter((k) => !gotDark.has(k));
const extra = [...gotDark].filter((k) => !wantDark.has(k));
assert.equal(missing.length, 0, `${missing.length} module(s) missing from the code, e.g. ${missing[0]}`);
assert.equal(extra.length, 0, `${extra.length} module(s) not in the code, e.g. ${extra[0]}`);

// Nothing may sit inside the quiet zone, or the code stops being findable.
const inQuiet = mods.filter((m) => m.x >= codeEdge && m.x < codeEdge + QUIET * M);
assert.equal(inQuiet.length, 0, `${inQuiet.length} module(s) inside the ${QUIET}-module quiet zone`);

// Every code module at full opacity: a mid-ramp module is neither dark nor
// light to a scanner, which is worse for it than one that is simply absent.
const dimCode = mods.filter((m) => m.x < codeEdge && m.o !== '1');
assert.equal(dimCode.length, 0, `${dimCode.length} code module(s) below full opacity, e.g. ${JSON.stringify(dimCode[0])}`);

/* The geometry the decoder actually demands, measured rather than assumed: a
   code module must be FULL PITCH so it merges with its neighbours, and rx must
   stay at or below 2. Inset the modules to the page's usual 10px-on-12 and the
   code silently stops scanning while still looking completely correct, which is
   the single easiest way to break this page without any test noticing. */
const badShape = mods.filter((m) => m.x < codeEdge && (m.w !== M || m.rx > 2));
assert.equal(
  badShape.length,
  0,
  `${badShape.length} code module(s) not full-pitch/rx<=2 (a decoder will see a dot grid), e.g. ${JSON.stringify(badShape[0])}`,
);

// --- 2. pitch ---------------------------------------------------------------
const offPitch = mods.filter((m) => m.x % M || m.y % M);
assert.equal(offPitch.length, 0, `${offPitch.length} module(s) off the ${M}px pitch, e.g. ${JSON.stringify(offPitch[0])}`);

// --- 3. ramp ----------------------------------------------------------------
const stray = [...new Set(mods.map((m) => m.o))].filter((o) => !RAMP.includes(o));
assert.equal(stray.length, 0, `opacity outside the RAMP: ${stray.join(', ')}`);

console.log(
  `ok - ${wantDark.size} code modules match ${QR_URL} (ecc ${QR_ECC}, ${size}x${size}), ` +
    `${mods.length - wantDark.size} trail modules, all on the ${M}px pitch, opacity in {${RAMP.join(', ')}}`,
);
