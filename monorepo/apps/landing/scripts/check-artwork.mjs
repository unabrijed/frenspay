/* The one check behind the QR rework. Run against a built export:
     yarn workspace @fpay/landing build && yarn workspace @fpay/landing check:artwork

   It asserts the two properties the whole change rests on — every module on an
   exact pitch, and opacity drawn only from the quantized RAMP. Both are easy to
   reintroduce by accident (one stray `+ rnd()` in qrGeometry is all it takes),
   and neither shows up as a type error or a failed build. Reads the exported
   HTML rather than importing the TS, so it needs no loader and no framework. */

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const M = 12;
const RAMP = ['1', '0.65', '0.5', '0.4', '0.3'];

const html = readFileSync(new URL('../out/index.html', import.meta.url), 'utf8');
const re = /<rect x="(\d+)" y="(\d+)" width="10" height="10" rx="2\.5" opacity="([\d.]+)"[^>]*class="qr-px"/g;

const mods = [...html.matchAll(re)].map(([, x, y, o]) => ({ x: +x, y: +y, o }));

assert.ok(mods.length > 150, `expected the QR to render; found ${mods.length} modules`);

const offPitch = mods.filter((m) => m.x % M || m.y % M);
assert.equal(offPitch.length, 0, `${offPitch.length} module(s) off the ${M}px pitch, e.g. ${JSON.stringify(offPitch[0])}`);

const stray = [...new Set(mods.map((m) => m.o))].filter((o) => !RAMP.includes(o));
assert.equal(stray.length, 0, `opacity outside the RAMP: ${stray.join(', ')}`);

console.log(`ok — ${mods.length} modules, all on the ${M}px pitch, opacity in {${RAMP.join(', ')}}`);
