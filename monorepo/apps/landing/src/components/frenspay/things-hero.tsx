'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { InlineFListForm } from '@/components/frenspay/inline-f-list-form';
import { PayNote, PlayCradle, RelayNote, StayKnot } from '@/components/frenspay/things-objects';
import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

const SLIDES = [
  { word: 'play', bg: 'var(--color-terra)', caption: FRENSPAY_COPY.captions.play, Figure: PlayCradle },
  { word: 'stay', bg: 'var(--color-ember)', caption: FRENSPAY_COPY.captions.stay, Figure: StayKnot },
  { word: 'relay', bg: 'var(--color-char)', caption: FRENSPAY_COPY.captions.relay, Figure: RelayNote },
  {
    word: 'pay',
    bg: 'var(--color-ink)',
    caption: `${FRENSPAY_COPY.mystery.join(' ')} ${FRENSPAY_COPY.interruption}`,
    Figure: PayNote,
  },
] as const;

// Role of slide i relative to the active index: the offsets walk clockwise.
const ROLES = ['center', 'right', 'back', 'left'] as const;
type Role = (typeof ROLES)[number];

const HOLD_MS = 6000;
const SWAP_MS = 650;

// Springs own x/y/scale/rotate; blur and opacity tween alongside. The items'
// -50% centering lives in the CSS `translate` property, which composes with
// the transform framer writes.
type Pose = { x: string; y: string; scale: number; rotate: number; opacity: number; filter: string };
const ROLE_POSE: Record<'desktop' | 'mobile', Record<Role, Pose>> = {
  desktop: {
    center: { x: '0vw', y: '0vh', scale: 1, rotate: 0, opacity: 1, filter: 'blur(0px)' },
    left: { x: '-24vw', y: '-12vh', scale: 0.3, rotate: -4, opacity: 0.85, filter: 'blur(2px)' },
    right: { x: '24vw', y: '-12vh', scale: 0.3, rotate: 4, opacity: 0.85, filter: 'blur(2px)' },
    back: { x: '0vw', y: '-24vh', scale: 0.24, rotate: 0, opacity: 0.9, filter: 'blur(4px)' },
  },
  mobile: {
    center: { x: '0vw', y: '0vh', scale: 1, rotate: 0, opacity: 1, filter: 'blur(0px)' },
    left: { x: '-34vw', y: '-10vh', scale: 0.22, rotate: -4, opacity: 0.85, filter: 'blur(2px)' },
    right: { x: '34vw', y: '-10vh', scale: 0.22, rotate: 4, opacity: 0.85, filter: 'blur(2px)' },
    back: { x: '0vw', y: '-20vh', scale: 0.18, rotate: 0, opacity: 0.9, filter: 'blur(4px)' },
  },
};
const ROLE_Z: Record<Role, number> = { center: 20, left: 10, right: 10, back: 5 };
const SPRING = { type: 'spring', stiffness: 160, damping: 24 } as const;
const ROLE_TRANSITION = {
  x: SPRING,
  y: SPRING,
  scale: SPRING,
  rotate: SPRING,
  opacity: { duration: 0.65, ease: 'easeInOut' },
  filter: { duration: 0.65, ease: 'easeInOut' },
} as const;

export function ThingsHero() {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [beckoned, setBeckoned] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());
  const lockRef = useRef(false);
  const pointerXRef = useRef<number | null>(null);
  const beckonTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    return () => {
      if (beckonTimerRef.current !== null) window.clearTimeout(beckonTimerRef.current);
    };
  }, []);

  const paused = hovered || focused || engaged || stopped || reducedMotion;

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % SLIDES.length), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused]);

  const navigate = (direction: 1 | -1) => {
    if (lockRef.current) return;
    if (!reducedMotion) {
      lockRef.current = true;
      window.setTimeout(() => {
        lockRef.current = false;
      }, SWAP_MS);
    }
    setIndex((current) => (current + direction + SLIDES.length) % SLIDES.length);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigate(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigate(-1);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    pointerXRef.current = event.clientX;
  };

  const onPointerUp = (event: PointerEvent) => {
    const start = pointerXRef.current;
    pointerXRef.current = null;
    if (start === null) return;
    const delta = event.clientX - start;
    if (Math.abs(delta) > 48) navigate(delta < 0 ? 1 : -1);
    else navigate(1);
  };

  const focusJoin = () => {
    (document.getElementById('f-list-email') ?? document.getElementById('f-list-status'))?.focus();
    setBeckoned(true);
    if (beckonTimerRef.current !== null) window.clearTimeout(beckonTimerRef.current);
    beckonTimerRef.current = window.setTimeout(() => setBeckoned(false), 1000);
  };

  const poses = ROLE_POSE[isMobile ? 'mobile' : 'desktop'];

  return (
    <div
      className="things-hero"
      style={{ backgroundColor: SLIDES[index].bg, '--things-bg': SLIDES[index].bg } as CSSProperties}
    >
      <h1 className="sr-only">things between frens</h1>
      <header className="things-topline safe-x">
        <div>
          <p className="things-eyebrow">Things between frens</p>
          <p className="things-support">{FRENSPAY_COPY.supporting}</p>
        </div>
        <span className="things-home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark-cream.svg" alt="" width="22" height="28" />
          <span>frenspay</span>
        </span>
      </header>

      <section
        className="things-stage"
        role="region"
        aria-roledescription="carousel"
        aria-label="things between frens"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div className="things-ghost" aria-hidden="true">
          {SLIDES.map((slide, i) => (
            <span key={slide.word} className={i === index ? 'is-active' : undefined}>
              {slide.word}.
            </span>
          ))}
        </div>
        <motion.div
          className="things-shadow"
          aria-hidden="true"
          animate={reducedMotion ? { scale: 1 } : { scale: [1, 1.06, 1] }}
          transition={{ duration: 5, ease: 'easeInOut', repeat: Infinity }}
        />
        {SLIDES.map((slide, i) => {
          const role = ROLES[(i - index + SLIDES.length) % SLIDES.length];
          return (
            <motion.div
              key={slide.word}
              className="things-item"
              style={{ zIndex: ROLE_Z[role] }}
              initial={false}
              animate={poses[role]}
              transition={reducedMotion ? { duration: 0 } : ROLE_TRANSITION}
              aria-hidden="true"
            >
              <slide.Figure
                key={String(role === 'center')}
                active={role === 'center'}
                reducedMotion={reducedMotion}
              />
            </motion.div>
          );
        })}
        <p className="sr-only" aria-live={paused ? 'polite' : 'off'}>
          {`slide ${index + 1} of ${SLIDES.length}: frens ${SLIDES[index].word}.`}
        </p>
      </section>

      <footer className="things-foot safe-x">
        <div className="things-foot-left">
          <p className="things-phrase" aria-hidden="true">
            {SLIDES.map((slide, i) => (
              <span key={slide.word} className={i === index ? 'is-active' : undefined}>
                {slide.word === 'pay' ? FRENSPAY_COPY.headline.join(' ') : `frens ${slide.word}.`}
              </span>
            ))}
          </p>
          <p className="things-whisper" aria-hidden="true">
            {SLIDES.map((slide, i) => (
              <span key={slide.word} className={i === index ? 'is-active' : undefined}>
                {slide.caption}
              </span>
            ))}
          </p>
          <div className={`things-join${beckoned ? ' is-beckoned' : ''}`}>
            <InlineFListForm onInteractionChange={setEngaged} />
          </div>
        </div>
        <div className="things-foot-right">
          <div className="things-controls">
            <span className="things-index">
              0{index + 1} / 0{SLIDES.length}
            </span>
            <button
              type="button"
              className="things-pause"
              aria-pressed={stopped}
              onClick={() => setStopped((current) => !current)}
            >
              {stopped ? 'resume' : 'pause'}
            </button>
          </div>
          <button type="button" className="things-join-link" onClick={focusJoin}>
            <span>{FRENSPAY_COPY.fList}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m13 5 7 7-7 7" />
            </svg>
          </button>
        </div>
      </footer>
      <div className="things-vignette" aria-hidden="true" />
      <div className="things-grain" aria-hidden="true" />
    </div>
  );
}
