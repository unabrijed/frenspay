import { dissolveAt, isFinderCell, rampAt } from './qrGeometry';
import { mulberry32 } from './rand';

/* The section figures.

   The hero establishes an atom — a rounded square on an exact pitch, ink or
   terracotta, opacity decaying on a quantized ramp. Everything below the hero is
   drawn with that same atom, so the page has one motif rather than a particle
   hero bolted onto card UI. Each figure diagrams its section's argument; none of
   them is decoration sitting next to the point.

   Ink is `currentColor` so a figure inverts by inheriting from its section —
   which is what lets the same primitive sit on canvas and on the ink band. */

type Cell = { tint?: boolean; o?: number; dx?: number; dy?: number } | null;
type CellFn = (x: number, y: number) => Cell;

export function ModuleFigure({
  cols,
  rows,
  cell,
  m = 10,
  className = '',
}: {
  cols: number;
  rows: number;
  cell: CellFn;
  m?: number;
  className?: string;
}) {
  const mods = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = cell(x, y);
      if (!c) continue;
      mods.push(
        <rect
          key={`${x}-${y}`}
          x={x * m + (c.dx ?? 0)}
          y={y * m + (c.dy ?? 0)}
          width={m - 2}
          height={m - 2}
          rx="2"
          opacity={c.o ?? 1}
          fill={c.tint ? 'var(--color-terra)' : 'currentColor'}
        />,
      );
    }
  }
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${cols * m} ${rows * m}`}
      width={cols * m}
      height={rows * m}
      className={className}
    >
      {mods}
    </svg>
  );
}

/* Seeded figures are precomputed at module scope rather than drawing inside the
   render callback: mulberry32 is sequence-dependent, and a value that shifted
   with render order would break the static export's byte-for-byte guarantee. */
function precompute(cols: number, rows: number, seed: number, fn: (rnd: () => number, x: number, y: number) => Cell) {
  const rnd = mulberry32(seed);
  const out: Cell[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) out.push(fn(rnd, x, y));
  return (x: number, y: number) => out[y * cols + x];
}

/* Hold dollars — one balance. Every cell filled, uniform, no variance at all.
   Doubles as the "exact pitch" side of the comparison. */
export const solid: CellFn = () => ({});

/* Lock the rate — the middle row is held while everything around it recedes. */
export const locked = (rows: number): CellFn => {
  const mid = (rows - 1) / 2;
  return (_x, y) => (y === Math.floor(mid) ? { tint: true } : { o: 0.28 });
};

/* Pay instantly — the hero's release, at a fraction of the amplitude. Same
   dissolveAt/rampAt the code itself runs on, so the two are provably one system. */
export const streaming = (cols: number, rows: number) =>
  precompute(cols, rows, 20260804, (rnd, x) => {
    const t = dissolveAt(x, cols);
    if (t > 0 && rnd() < t * 0.62) return null;
    return { o: rampAt(t) };
  });

/* Your bank card abroad — the geometry deliberately deleted from the hero in
   this same change, rehomed to the one place on the page where being off-grid
   is the argument rather than a bug.

   Applied uniformly rather than as the hero's left-to-right ramp: a card that
   works on its left and fails on its right would muddle the point. */
export const scattered = (cols: number, rows: number) =>
  precompute(cols, rows, 20260805, (rnd) => {
    if (rnd() < 0.18) return null;
    return {
      dx: (rnd() - 0.5) * 7,
      dy: (rnd() - 0.5) * 7,
      o: 0.3 + rnd() * 0.45,
    };
  });

/* Split it by @handle — one block becomes two, on the same pitch. Splitting a
   bill doesn't damage the money, it just divides it. */
export const paired = (cols: number): CellFn => {
  const gap = Math.floor(cols / 2);
  return (x) => (x === gap ? null : {});
};

/* Security — the finder pattern alone, at rest. Literally the mark a scanner
   orients against, and the same geometry the code is built from. */
export const finder: CellFn = (x, y) => (isFinderCell(x, y) ? {} : null);
