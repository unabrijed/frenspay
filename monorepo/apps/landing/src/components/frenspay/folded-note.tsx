'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  motion,
  useAnimationControls,
  useMotionValue,
  useSpring,
} from 'framer-motion';
import type { MotionStyle, MotionValue } from 'framer-motion';

import { FRENSPAY_COPY } from '@/lib/frenspay-copy';
import { NOTE_MOTION, SOFT_EASE } from '@/lib/motion';

import { InlineFListForm } from './inline-f-list-form';
import { PaperDetails } from './paper-details';
import { WordStrip } from './word-strip';

export type FoldedNoteMode = 'story' | 'folded' | 'unfolded';

export function FoldedNote({
  mode,
  mystery,
  reducedMotion,
  progress,
}: {
  mode: FoldedNoteMode;
  mystery: ReactNode;
  reducedMotion: boolean;
  progress?: MotionValue<number>;
}) {
  const [interacting, setInteracting] = useState(false);
  const [pointerEnabled, setPointerEnabled] = useState(false);
  const noteRect = useRef<DOMRect | null>(null);
  const entrance = useAnimationControls();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const pointerX = useSpring(rawX, { stiffness: 110, damping: 20, mass: 0.45 });
  const pointerY = useSpring(rawY, { stiffness: 110, damping: 20, mass: 0.45 });

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setPointerEnabled(query.matches && !reducedMotion && mode === 'story');
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [mode, reducedMotion]);

  useLayoutEffect(() => {
    if (reducedMotion || mode !== 'story') return;
    entrance.set({ opacity: 0, x: 340, y: -30, rotate: 6 });
    const frame = requestAnimationFrame(() => {
      void entrance.start({
        opacity: 1,
        x: 0,
        y: 0,
        rotate: 0,
        transition: { delay: NOTE_MOTION.noteDelay, duration: NOTE_MOTION.noteDuration, ease: SOFT_EASE },
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [entrance, mode, reducedMotion]);

  const pointerStyle = {
    '--pointer-x': pointerX,
    '--pointer-y': pointerY,
  } as unknown as MotionStyle;

  return (
    <motion.div className="note-entrance" animate={entrance}>
      <div className="note-idle" data-paused={interacting || reducedMotion || mode !== 'story'}>
        <motion.article
          className={`folded-note note-mode-${mode}`}
          aria-label="A folded FrensPay note"
          style={pointerStyle}
          onPointerEnter={(event) => {
            if (!pointerEnabled) return;
            noteRect.current = event.currentTarget.getBoundingClientRect();
          }}
          onPointerMove={(event) => {
            const rect = noteRect.current;
            if (!pointerEnabled || !rect) return;
            rawX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2);
            rawY.set(((event.clientY - rect.top) / rect.height - 0.5) * 2);
          }}
          onPointerLeave={() => {
            noteRect.current = null;
            rawX.set(0);
            rawY.set(0);
          }}
        >
          <div className="paper-layer peach-underlayer" aria-hidden="true" />
          <div className="paper-layer back-sheet" aria-hidden="true">
            <span>FP / PASS—01</span>
          </div>

          <section className="paper-layer unfold-sheet" aria-label="The unfolded note">
            <div className="fold-rule fold-rule-a" aria-hidden="true" />
            <div className="fold-rule fold-rule-b" aria-hidden="true" />
            <div className="unfold-grain" aria-hidden="true" />
            {mystery}
          </section>

          <section className="paper-layer main-sheet" aria-label="The front of the note">
            <span className="paper-grain" aria-hidden="true" />
            <span className="folded-corner" aria-hidden="true" />
            <span className="edge-code" aria-hidden="true">FP—08 / KEEP FOLDED</span>
            <p className="note-primary-copy">{FRENSPAY_COPY.headline[0]}</p>
            <WordStrip progress={progress} reducedMotion={reducedMotion} />
            <PaperDetails />
          </section>

          <aside className="paper-layer receipt-strip" aria-hidden="true">
            <span className="receipt-hole" />
            <span>fyi / 08—26</span>
            <span className="receipt-rule" />
            <strong>considered settled</strong>
            <span className="receipt-rule short" />
            <span>pass it on →</span>
          </aside>

          <div className="paper-layer front-flap" aria-hidden="true">
            <span className="flap-rule" />
            <p>{FRENSPAY_COPY.headline[1]}</p>
            <span className="flap-micro">f-us / f-found / 003</span>
          </div>

          <div className="frenspay-seal" aria-hidden="true">
            <span className="seal-letter">f</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="seal-mark" src="/logo-mark.svg" alt="" width="48" height="62" />
          </div>

          {mode !== 'unfolded' ? <InlineFListForm onInteractionChange={setInteracting} /> : null}
        </motion.article>
      </div>
    </motion.div>
  );
}
