import { mulberry32 } from './rand';

/* The QR's geometry, deliberately kept OUT of a 'use client' module.

   Both the hero (a client component, because it tracks the pointer) and the
   section figures (server-rendered) draw from these, and a client module's
   exports cannot be called from the server. So the maths lives here and the
   components import it — which is also what guarantees the figures below the
   hero run the same ramp as the code itself rather than a copy of it.

   Decorative pixel-QR, deliberately not scannable (aria-hidden, no scan CTA).
   Upgrade path once DEMO_URL is live: generate a real matrix at build time
   (`qrcode` devDep, ECC-H) and keep the dissolve away from the finder corners. */

const N = 21; // modules per side
export const M = 12; // px per module

// The svg viewBox — exactly the module grid, no slack. Every module sits on the
// M pitch now, so the box IS the content box and .qr-mask is what softens the
// dissolving edge. PixelField rasterises the same geometry at this size, so the
// particle formation lines up with the SVG it replaces without any tuning.
export const QR_W = N * M;
export const QR_H = N * M;

const FINDERS = [
  [0, 0],
  [14, 0],
  [0, 14],
] as const;

/* The filled cells of a finder: the 7×7 outer ring plus the 3×3 core. Exported
   because the Security figure draws one on its own — the mark a scanner orients
   against is that section's whole argument, and it should be the same geometry
   the code itself is built from. */
export const isFinderCell = (x: number, y: number) =>
  FINDERS.some(([fx, fy]) => {
    const dx = x - fx;
    const dy = y - fy;
    if (dx < 0 || dx > 6 || dy < 0 || dy > 6) return false;
    return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
  });

/* Dissolve strength: 0 until 4/7 of the way across, ramping to 1 at the right
   edge. Defaults reproduce the code's own columns 12→20 exactly; the cols
   argument is what lets the smaller section figures run the same ramp. */
export const dissolveAt = (x: number, cols = N) =>
  Math.max(0, Math.min(1, (x - cols * (12 / 21)) / (cols * (8 / 21))));

/* Quantized opacity decay — the single most load-bearing constant on this page.
   A clean five-step ramp reads as resonance; the per-module random fade it
   replaced read as noise. Never interpolate it: the banding IS the effect. */
export const RAMP = [1, 0.65, 0.5, 0.4, 0.3] as const;
export const rampAt = (t: number) => RAMP[Math.min(RAMP.length - 1, Math.round(t * 4))];

// d/dx/dy drive the entrance: delay in ms, and the offset each module flies in
// from. Nothing here perturbs the resting position — x/y are always on-pitch.
export type Px = { x: number; y: number; o: number; terra: boolean; d: number; dx: number; dy: number };

function qrPixels(): Px[] {
  const rnd = mulberry32(20260731);
  const inFinderZone = (x: number, y: number) =>
    FINDERS.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);

  const px: Px[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const finder = isFinderCell(x, y);
      if (!finder && (inFinderZone(x, y) || rnd() > 0.45)) continue;
      const terra = finder || rnd() < 0.15;
      const t = dissolveAt(x);
      // The cull ramp is the ONLY randomness left in the resting artwork. The
      // code coming apart is expressed by modules being absent and by the
      // opacity ramp — never by modules sitting off-grid.
      if (t > 0 && rnd() < t * 0.55) continue;
      px.push({
        x: x * M,
        y: y * M,
        o: rampAt(t),
        terra,
        // Delay tracks the column, so the code assembles as a left-to-right
        // wave: solid corner first, dissolving edge last.
        d: Math.round(300 + (x / N) * 600 + rnd() * 80),
        dx: Math.round(12 + rnd() * 24), // flies in from the right, with the flow
        dy: Math.round((rnd() - 0.5) * 16),
      });
    }
  }
  return px;
}

export const PIXELS = qrPixels();
