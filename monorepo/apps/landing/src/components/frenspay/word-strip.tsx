'use client';

import { useEffect, useState } from 'react';
import { motion, motionValue, useMotionValueEvent } from 'framer-motion';
import type { MotionValue } from 'framer-motion';

import { FRENSPAY_COPY } from '@/lib/frenspay-copy';
import { NOTE_MOTION, PAPER_EASE } from '@/lib/motion';

export function WordStrip({ progress, reducedMotion }: { progress?: MotionValue<number>; reducedMotion: boolean }) {
  const [index, setIndex] = useState(reducedMotion ? FRENSPAY_COPY.words.length - 1 : 0);

  useMotionValueEvent(progress ?? FALLBACK_PROGRESS, 'change', (value) => {
    if (value > 0.22) setIndex(FRENSPAY_COPY.words.length - 1);
  });

  useEffect(() => {
    if (reducedMotion || index >= FRENSPAY_COPY.words.length - 1) return;
    const timer = window.setTimeout(() => setIndex((current) => Math.min(current + 1, FRENSPAY_COPY.words.length - 1)), NOTE_MOTION.wordHoldMs);
    return () => window.clearTimeout(timer);
  }, [index, reducedMotion]);

  return (
    <div className="word-window" aria-label={`frens ${FRENSPAY_COPY.words[index]}`}>
      <span className="word-frens" aria-hidden="true">frens</span>
      <span className="word-mask" aria-hidden="true">
        <motion.span
          className="word-paper-strip"
          animate={{ y: `${index * -25}%`, x: index % 2 ? 2 : 0, rotate: index % 2 ? 0.18 : -0.12 }}
          transition={{ duration: reducedMotion ? 0.16 : NOTE_MOTION.wordTransition, ease: PAPER_EASE }}
        >
          {FRENSPAY_COPY.words.map((word) => <span key={word}>{word}</span>)}
        </motion.span>
      </span>
    </div>
  );
}

// Hooks cannot be conditional; a stable MotionValue keeps the static reduced-
// motion rendering on the same code path when no story progress is supplied.
const FALLBACK_PROGRESS = motionValue(0);
