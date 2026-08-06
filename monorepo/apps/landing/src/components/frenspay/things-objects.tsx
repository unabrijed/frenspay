'use client';

import type { ReactNode } from 'react';

import { motion } from 'framer-motion';

import { PAPER_EASE } from '@/lib/motion';

// Four string-and-paper objects for /v4, all hand-authored constants on an
// 800x600 viewBox — SSR-deterministic. Morph keyframes within one path must
// share an identical command structure (same M/C/L/Q counts): framer-motion
// only interpolates `d` strings under that condition, and a mismatch silently
// degrades the morph to a snap.

type FigureProps = { active: boolean; reducedMotion: boolean };

const EASE = 'easeInOut' as const;
const SETTLE = { duration: 0.65, ease: EASE };
const PAPER = [...PAPER_EASE] as [number, number, number, number];

/* frens play. — a cat's cradle: two strings held taut between four pinch
   points, morphing between string figures (sag → X-cross → double wave). */

const CRADLE_TOP = [
  'M140 180 C220 235 300 262 400 262 C480 262 545 240 590 220 C625 205 645 192 660 180',
  'M140 180 C230 280 320 355 410 358 C490 360 545 320 585 275 C620 236 645 205 660 180',
  'M140 180 C210 260 270 305 370 300 C450 296 480 235 545 218 C590 206 630 190 660 180',
];
const CRADLE_BOTTOM = [
  'M140 420 C220 365 300 338 400 338 C480 338 545 360 590 380 C625 395 645 408 660 420',
  'M140 420 C230 320 320 245 410 242 C490 240 545 280 585 325 C620 364 645 395 660 420',
  'M140 420 C210 340 270 295 370 300 C450 304 480 365 545 382 C590 394 630 410 660 420',
];

const stringMotion = (frames: string[], run: boolean, reducedMotion: boolean) => ({
  initial: reducedMotion ? false : ({ pathLength: 0 } as const),
  animate: {
    pathLength: 1,
    d: run ? [frames[0], frames[1], frames[2], frames[0]] : frames[0],
  },
  transition: {
    pathLength: { duration: 1.1, ease: 'easeOut' as const },
    d: run ? { duration: 9, ease: EASE, repeat: Infinity } : SETTLE,
  },
});

export function PlayCradle({ active, reducedMotion }: FigureProps) {
  const run = active && !reducedMotion;
  return (
    <svg viewBox="0 0 800 600" fill="none" aria-hidden="true">
      {(
        [
          [140, 180],
          [660, 180],
          [140, 420],
          [660, 420],
        ] as const
      ).map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9" fill="var(--color-peach-dim)" />
      ))}
      <motion.path
        d={CRADLE_TOP[0]}
        stroke="var(--color-canvas)"
        strokeWidth="8"
        strokeLinecap="round"
        {...stringMotion(CRADLE_TOP, run, reducedMotion)}
      />
      <motion.path
        d={CRADLE_BOTTOM[0]}
        stroke="var(--color-peach)"
        strokeWidth="8"
        strokeLinecap="round"
        {...stringMotion(CRADLE_BOTTOM, run, reducedMotion)}
      />
    </svg>
  );
}

/* frens stay. — two cords entering from opposite edges, looped through each
   other and gently tightening. The casing path repeats the left cord in the
   page background colour, slightly wider, so the left cord reads as passing
   over the right one at every crossing. */

const KNOT_LEFT = [
  'M-30 310 C90 310 190 306 268 288 C356 268 404 212 382 166 C360 120 282 118 244 162 C206 206 218 292 288 332 C338 360 396 362 436 342',
  'M-30 310 C90 310 195 306 276 290 C360 272 398 220 378 178 C358 136 292 134 258 172 C224 210 234 284 296 320 C342 346 392 350 428 334',
];
const KNOT_RIGHT = [
  'M830 310 C710 310 610 306 532 288 C444 268 396 212 418 166 C440 120 518 118 556 162 C594 206 582 292 512 332 C462 360 404 362 364 342',
  'M830 310 C710 310 605 306 524 290 C440 272 402 220 422 178 C442 136 508 134 542 172 C576 210 566 284 504 320 C458 346 408 350 372 334',
];

const cordMotion = (frames: string[], run: boolean, reducedMotion: boolean) => ({
  initial: reducedMotion ? false : ({ pathLength: 0 } as const),
  animate: {
    pathLength: 1,
    d: run ? [frames[0], frames[1]] : frames[1],
  },
  transition: {
    pathLength: { duration: 1.2, ease: 'easeOut' as const },
    d: run
      ? { duration: 6, ease: EASE, repeat: Infinity, repeatType: 'mirror' as const }
      : SETTLE,
  },
});

export function StayKnot({ active, reducedMotion }: FigureProps) {
  const run = active && !reducedMotion;
  return (
    <svg viewBox="0 0 800 600" fill="none" aria-hidden="true">
      <motion.path
        d={KNOT_RIGHT[1]}
        stroke="var(--color-peach)"
        strokeWidth="8"
        strokeLinecap="round"
        {...cordMotion(KNOT_RIGHT, run, reducedMotion)}
      />
      <motion.path
        d={KNOT_LEFT[1]}
        strokeWidth="20"
        strokeLinecap="round"
        style={{ stroke: 'var(--things-bg, var(--color-ink))', transition: 'stroke 650ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        {...cordMotion(KNOT_LEFT, run, reducedMotion)}
      />
      <motion.path
        d={KNOT_LEFT[1]}
        stroke="var(--color-canvas)"
        strokeWidth="8"
        strokeLinecap="round"
        {...cordMotion(KNOT_LEFT, run, reducedMotion)}
      />
    </svg>
  );
}

/* frens relay. — a folded note passed point to point along a dashed arc,
   vanishing at the hand-off and reappearing at the start: the pass repeats.
   Arc keyframes are the cubic M110 430 C220 220 580 220 690 430 sampled at
   t = 0, .25, .5, .75, 1; rotation is a stylized tangent. */

const RELAY_ARC = 'M110 430 C220 220 580 220 690 430';
const RELAY_X = [110, 232, 400, 568, 690];
const RELAY_Y = [422, 304, 265, 304, 422];
const RELAY_ROTATE = [-24, -10, 0, 10, 24];
const RELAY_PASS = { duration: 6, ease: EASE, repeat: Infinity };
const RELAY_APEX = { x: RELAY_X[2], y: RELAY_Y[2], rotate: 0, opacity: 1 };

export function RelayNote({ active, reducedMotion }: FigureProps) {
  const run = active && !reducedMotion;
  return (
    <svg viewBox="0 0 800 600" fill="none" aria-hidden="true">
      <circle cx="110" cy="430" r="9" fill="var(--color-peach-dim)" />
      <circle cx="690" cy="430" r="9" fill="var(--color-peach-dim)" />
      <motion.path
        d={RELAY_ARC}
        stroke="var(--color-canvas)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="2 16"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reducedMotion ? 0 : 1.1, ease: 'easeOut' }}
      />
      <motion.g
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={
          run
            ? { x: RELAY_X, y: RELAY_Y, rotate: RELAY_ROTATE, opacity: [0, 1, 1, 1, 0] }
            : RELAY_APEX
        }
        transition={
          run
            ? {
                x: RELAY_PASS,
                y: RELAY_PASS,
                rotate: RELAY_PASS,
                opacity: { ...RELAY_PASS, times: [0, 0.14, 0.5, 0.86, 1] },
              }
            : { x: SETTLE, y: SETTLE, rotate: SETTLE, opacity: { duration: 0.4 } }
        }
      >
        <rect x="-32" y="-22" width="64" height="44" rx="4" stroke="var(--color-canvas)" strokeWidth="5" />
        <path d="M12 -22 L32 -22 L32 -2 Z" fill="var(--color-peach)" />
        <path d="M12 -22 L32 -2" stroke="var(--color-canvas)" strokeWidth="4" strokeLinejoin="round" />
        <path d="M-20 4 L10 4" stroke="var(--color-peach-dim)" strokeWidth="4" strokeLinecap="round" />
      </motion.g>
    </svg>
  );
}

/* frens pay. — a paper note tearing along its perforation into two halves,
   one for each fren. Both halves share the same jagged edge polyline so the
   pieces visibly belong to one sheet. */

const NOTE_TEAR = 'L398 470 L392 428 L407 386 L390 342 L406 300 L388 258 L408 214 L390 172 Z';
const NOTE_LEFT = `M400 130 L178 130 Q150 130 150 158 L150 442 Q150 470 178 470 ${NOTE_TEAR}`;
const NOTE_RIGHT = `M400 130 L622 130 Q650 130 650 158 L650 442 Q650 470 622 470 ${NOTE_TEAR}`;
const TEAR_MS = 1.6;

export function PayNote({ active, reducedMotion }: FigureProps) {
  const run = active && !reducedMotion;
  const half = (side: 1 | -1, children: ReactNode) => (
    <motion.g
      animate={
        run
          ? { x: [0, 0, side * 60], rotate: [0, 0, side * 2.4] }
          : { x: side * 60, rotate: side * 2.4 }
      }
      transition={
        run
          ? {
              x: { duration: TEAR_MS, ease: PAPER, times: [0, 0.55, 1] },
              rotate: { duration: TEAR_MS, ease: PAPER, times: [0, 0.55, 1] },
            }
          : { x: SETTLE, rotate: SETTLE }
      }
    >
      <motion.g
        animate={run ? { y: [-3, 3] } : { y: 0 }}
        transition={
          run
            ? { duration: 5, ease: EASE, repeat: Infinity, repeatType: 'mirror', delay: TEAR_MS }
            : SETTLE
        }
      >
        {children}
      </motion.g>
    </motion.g>
  );

  return (
    <svg viewBox="0 0 800 600" fill="none" aria-hidden="true">
      <motion.g
        initial={reducedMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reducedMotion ? 0 : TEAR_MS * 0.3, ease: 'easeOut' }}
      >
        {half(
          -1,
          <>
            <path d={NOTE_LEFT} stroke="var(--color-canvas)" strokeWidth="7" strokeLinejoin="round" />
            <path
              d="M195 235 L340 235 M195 285 L320 285 M195 335 L332 335"
              stroke="var(--color-peach)"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </>,
        )}
        {half(
          1,
          <>
            <path d={NOTE_RIGHT} stroke="var(--color-canvas)" strokeWidth="7" strokeLinejoin="round" />
            <path
              d="M460 235 L610 235 M460 285 L590 285"
              stroke="var(--color-peach)"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </>,
        )}
        <motion.path
          d="M399 124 L399 476"
          stroke="var(--color-peach-dim)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="1 11"
          animate={run ? { opacity: [0, 0, 1, 1, 0] } : { opacity: 0 }}
          transition={
            run
              ? { duration: TEAR_MS, times: [0, 0.25, 0.4, 0.55, 0.8], ease: 'linear' }
              : { duration: 0.3 }
          }
        />
      </motion.g>
    </svg>
  );
}
