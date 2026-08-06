'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { useReducedMotion } from 'framer-motion';

import { InlineFListForm } from '@/components/frenspay/inline-f-list-form';
import { PayNote, PlayCradle, StayKnot, StrayKite } from '@/components/frenspay/things-objects';
import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

const SLIDES = [
  { word: 'play', bg: 'var(--color-terra)', Figure: PlayCradle },
  { word: 'stay', bg: 'var(--color-teal)', Figure: StayKnot },
  { word: 'stray', bg: 'var(--color-muted)', Figure: StrayKite },
  { word: 'pay', bg: 'var(--color-ink)', Figure: PayNote },
] as const;

// Role of slide i relative to the active index: the offsets walk clockwise.
const ROLES = ['center', 'right', 'back', 'left'] as const;
const HOLD_MS = 6000;
const SWAP_MS = 650;

export function ThingsHero() {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [beckoned, setBeckoned] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());
  const lockRef = useRef(false);
  const pointerXRef = useRef<number | null>(null);
  const beckonTimerRef = useRef<number | null>(null);

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
          <img src="/logo-mark.svg" alt="" width="13" height="17" />
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
        {SLIDES.map((slide, i) => {
          const role = ROLES[(i - index + SLIDES.length) % SLIDES.length];
          return (
            <div key={slide.word} className={`things-item is-${role}`} aria-hidden="true">
              <slide.Figure active={role === 'center'} reducedMotion={reducedMotion} />
            </div>
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
            <span className={index === SLIDES.length - 1 ? 'is-active' : undefined}>
              {FRENSPAY_COPY.mystery.join(' ')} {FRENSPAY_COPY.interruption}
            </span>
          </p>
          <div className={`things-join${beckoned ? ' is-beckoned' : ''}`}>
            <InlineFListForm onInteractionChange={setEngaged} />
          </div>
          <div className="things-controls">
            <button type="button" className="things-arrow" aria-label="previous thing" onClick={() => navigate(-1)}>
              <ArrowIcon flipped />
            </button>
            <button type="button" className="things-arrow" aria-label="next thing" onClick={() => navigate(1)}>
              <ArrowIcon />
            </button>
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
        </div>
        <button type="button" className="things-join-link" onClick={focusJoin}>
          <span>{FRENSPAY_COPY.fList}</span>
          <ArrowIcon />
        </button>
      </footer>
      <div className="things-grain" aria-hidden="true" />
    </div>
  );
}

function ArrowIcon({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={flipped ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}
