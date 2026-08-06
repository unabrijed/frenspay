'use client';

import { useLayoutEffect, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import {
  motion,
  useAnimationControls,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'framer-motion';
import type { MotionStyle } from 'framer-motion';

import { focusFList } from '@/lib/f-list';
import { FRENSPAY_COPY } from '@/lib/frenspay-copy';
import { NOTE_MOTION, SOFT_EASE, STORY_RANGES } from '@/lib/motion';

import { FoldedNote } from './folded-note';

export function NoteStory({ heroCopy, mysteryCopy }: { heroCopy: ReactNode; mysteryCopy: ReactNode }) {
  const storyRef = useRef<HTMLElement>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const heroEntrance = useAnimationControls();
  const { scrollYProgress } = useScroll({ target: storyRef, offset: ['start start', 'end end'] });
  const centre = useTransform(scrollYProgress, STORY_RANGES.centre, [0, 1]);
  const open = useTransform(scrollYProgress, STORY_RANGES.open, [0, 1]);
  const lengthen = useTransform(scrollYProgress, STORY_RANGES.lengthen, [0, 1]);
  const resolve = useTransform(scrollYProgress, STORY_RANGES.resolve, [0, 1]);
  const heroY = useTransform(scrollYProgress, [0, 0.2], [0, -68]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.16, 0.28], [1, 0.86, 0.16]);
  const backgroundScale = useTransform(scrollYProgress, [0, 0.4], [1, 1.18]);
  const backgroundOpacity = useTransform(scrollYProgress, [0, 0.5], [0.58, 0.2]);
  const returnOpacity = useTransform(scrollYProgress, [0.84, 0.94], [0, 1]);

  useLayoutEffect(() => {
    if (reducedMotion) return;
    heroEntrance.set({ opacity: 0, y: 24, filter: 'blur(8px)' });
    const frame = requestAnimationFrame(() => {
      void heroEntrance.start({
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        transition: { delay: NOTE_MOTION.headlineDelay, duration: NOTE_MOTION.headlineDuration, ease: SOFT_EASE },
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [heroEntrance, reducedMotion]);

  if (reducedMotion) {
    return (
      <section id="top" className="reduced-note-story">
        <span id="f-list" className="story-anchor" />
        <div className="reduced-hero-scene">
          <span className="background-f" aria-hidden="true">f</span>
          <div className="reduced-hero-copy">{heroCopy}</div>
          <div className="reduced-folded-stage">
            <FoldedNote mode="folded" mystery={mysteryCopy} reducedMotion />
          </div>
        </div>
        <span id="fyi" className="story-anchor" />
        <div className="reduced-mystery-scene">
          <FoldedNote mode="unfolded" mystery={mysteryCopy} reducedMotion />
        </div>
        <ReturnToFList />
      </section>
    );
  }

  const storyStyle = {
    '--centre': centre,
    '--open': open,
    '--lengthen': lengthen,
    '--resolve': resolve,
  } as unknown as MotionStyle;

  return (
    <motion.section id="top" ref={storyRef} className="note-story" style={storyStyle}>
      <span id="f-list" className="story-anchor anchor-f-list" />
      <span id="fyi" className="story-anchor anchor-fyi" />
      <div className="story-viewport">
        <div className="background-field" aria-hidden="true" />
        <motion.span
          className="background-f"
          aria-hidden="true"
          style={{ scale: backgroundScale, opacity: backgroundOpacity }}
        >
          f
        </motion.span>
        <span className="editorial-line line-a" aria-hidden="true" />
        <span className="editorial-line line-b" aria-hidden="true" />
        <span className="editorial-mark mark-a" aria-hidden="true">+</span>
        <span className="editorial-mark mark-b" aria-hidden="true">08—26</span>

        <motion.div className="hero-copy-stage" style={{ y: heroY, opacity: heroOpacity }}>
          <motion.div animate={heroEntrance}>{heroCopy}</motion.div>
        </motion.div>

        <div className="note-stage">
          <FoldedNote mode="story" mystery={mysteryCopy} reducedMotion={false} progress={scrollYProgress} />
        </div>

        <motion.div className="return-link-wrap" style={{ opacity: returnOpacity }}>
          <ReturnToFList />
        </motion.div>
      </div>
    </motion.section>
  );
}

function ReturnToFList() {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    focusFList();
  };

  return (
    <a href="#f-list" className="return-link" onClick={onClick}>
      {FRENSPAY_COPY.fList} ↑
    </a>
  );
}
