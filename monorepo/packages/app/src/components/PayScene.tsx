'use client';

// PayScene — the wait, made company. While the payment runs, the tracker shows one of three brand
// scenes instead of a bar: the mark relaying its bead, the painting's one rust object crossing the
// water, a stippled cloud edge filling in. One scene per payment (seeded on the order id), two
// phases (securing → sending) that move the scene forward, and a line of copy that changes every
// few seconds — so the frame is never still and never a spinner.
//
// Motion is web-only and lives in globals.css (className / data-*), exactly like the mark: the
// native shim drops className and transition, so the phone gets the static composition at the
// phase's position with the copy still rotating (the same deferral leaf.native.tsx carries).
// Position is an inline `left: 'NN%'` string, which rnStyle() passes through on both renderers.
// Invariant 21: nothing here says or shows who settles — a payment crossing, never a person.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { colors, Mark, Txt, type, View } from '@fpay/ui';

export type PayPhase = 'securing' | 'sending';

const SCENES = ['relay', 'crossing', 'stipple'] as const;

// How far along the frame each phase sits. Two phases because the payer only ever sees two: the
// deposit confirming, then the payout crossing — the claim flips the tracker to the Paid card.
const PROGRESS: Record<PayPhase, number> = { securing: 0.3, sending: 0.7 };

const LINES: Record<PayPhase, string[]> = {
  securing: ['Setting your money aside.', 'Held safe, on your side.', 'Nothing for you to do.'],
  sending: ['On its way.', 'Crossing over.', 'Nearly there.', 'Between frens, this bit takes a moment.'],
};
const ROTATE_MS = 3500;

/** One line at a time from `lines`, advancing every ROTATE_MS; restarts when the set changes. */
function useRotating(lines: string[]): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    const t = setInterval(() => setI((n) => n + 1), ROTATE_MS);
    return () => clearInterval(t);
  }, [lines]);
  return lines[i % lines.length];
}

export function PayScene({ seed, phase }: { seed: string; phase: PayPhase }) {
  // Stable for one payment, different across payments — the order id's last character.
  const scene = SCENES[seed.charCodeAt(seed.length - 1) % SCENES.length];
  const progress = PROGRESS[phase];
  const line = useRotating(LINES[phase]);
  return (
    <View style={styles.wrap}>
      <View className="fp-scene" data-scene={scene} data-phase={phase} style={styles.frame} role="img" aria-label="Payment in progress">
        {scene === 'relay' ? <Relay /> : scene === 'crossing' ? <Crossing progress={progress} /> : <Stipple progress={progress} />}
      </View>
      {/* key={line}: remount so the existing fp-arrive fade plays on every change. Motion is the
          flourish, never the message — the sentence is the signal, on both renderers. */}
      <View key={line} className="fp-arrive" role="status">
        <Txt style={styles.line}>{line}</Txt>
      </View>
    </View>
  );
}

// The mark is the one rust object; the bead is the gap travelling the curve (leaf.tsx's rule — a
// terracotta bead on it would be a second rust event, and read as a dot stuck on the curve). In
// `sending` the two frens lean in (globals.css, off data-phase).
function Relay() {
  return <Mark size={84} state="joining" color={colors.accent} bead={colors.surface} />;
}

// The painting: a horizon that never moves, drybrush water in horizontal streaks that thicken
// toward the viewer and drift slowly, and the single rust object crossing left to right. `left` is
// the phase; the transition eases it there, the bob keeps it afloat in between.
const STREAKS: CSSProperties[] = [
  { top: '52%', left: '30%', width: '38%', opacity: 0.35 },
  { top: '63%', left: '12%', width: '55%', opacity: 0.5 },
  { top: '74%', left: '22%', width: '66%', opacity: 0.7 },
  { top: '85%', left: '4%', width: '84%', opacity: 0.9 },
];
function Crossing({ progress }: { progress: number }) {
  return (
    <>
      <View style={styles.horizon} />
      {STREAKS.map((st, i) => (
        // A negative delay starts each streak mid-cycle, so the four never drift in lockstep.
        <View key={i} className="fp-drift" style={[styles.streak, st, { animationDelay: `${i * -1.5}s` }]} />
      ))}
      <View className="fp-bob" style={[styles.crosser, { left: `${progress * 100}%` }]} />
    </>
  );
}

// The cloud edge: a stippled field of ink dots that fills in from the left as the payment moves,
// with one rust dot breathing at the frontier (the identity sheet's rings, at field scale).
const COLS = 12;
const ROWS = 3;
function Stipple({ progress }: { progress: number }) {
  return (
    <>
      <View style={styles.field}>
        {Array.from({ length: ROWS }, (_, r) => (
          // Every other row sits half a cell over, so the edge breaks into dots instead of a grid.
          <View key={r} style={[styles.fieldRow, r % 2 ? styles.fieldRowShift : null]}>
            {Array.from({ length: COLS }, (_, c) => (
              <View key={c} style={styles.cell}>
                <View style={[styles.dot, { opacity: c / COLS < progress ? 1 : 0.22 }]} />
              </View>
            ))}
          </View>
        ))}
      </View>
      <View style={[styles.frontier, { left: `${progress * 100}%` }]}>
        <View className="pulse-ring" style={styles.frontierRing} />
        <View className="pulse-ring" style={[styles.frontierRing, { animationDelay: '0.6s' }]} />
        <View style={styles.frontierCore} />
      </View>
    </>
  );
}

const styles = {
  wrap: { alignItems: 'center', gap: 14, paddingTop: 10, paddingBottom: 6 },
  frame: { position: 'relative', width: '100%', height: 150, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  line: { ...type.lead, textAlign: 'center', minHeight: 23 },
  // crossing
  horizon: { position: 'absolute', left: 0, right: 0, top: '40%', height: 1, backgroundColor: colors.hair },
  streak: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: colors.secondary },
  crosser: {
    position: 'absolute',
    top: '37%',
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: 5,
    backgroundColor: colors.accent,
    transition: 'left 1200ms var(--ease-soft)',
  },
  // stipple
  field: { width: '100%', gap: 8 },
  fieldRow: { flexDirection: 'row', width: '100%' },
  fieldRowShift: { paddingLeft: `${50 / COLS}%` },
  cell: { width: `${100 / COLS}%`, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.ink, transition: 'opacity 600ms var(--ease-soft)' },
  frontier: {
    position: 'absolute',
    top: '50%',
    width: 26,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'left 1200ms var(--ease-soft)',
  },
  frontierRing: { position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderStyle: 'solid', borderColor: colors.accentLine },
  frontierCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
} satisfies Record<string, CSSProperties>;
