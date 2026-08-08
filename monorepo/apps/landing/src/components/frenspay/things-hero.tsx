'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';

import { InlineFListForm } from '@/components/frenspay/inline-f-list-form';
import { ThingsBackdrop } from '@/components/frenspay/things-backdrop';
import { PayNote, PlayCradle, RelayNote, StayKnot } from '@/components/frenspay/things-objects';
import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

// play and pay sit opposite each other: in a four-slide loop that is the only
// arrangement where they are never neighbours.
//
// `sky` is the flat colour of each scene's own top row, sampled by scenes.mjs.
// The page paints it above the illustration so the scene has no top edge — it
// just becomes paper — and tweens between them so the page changes temperature
// as it advances.
//
// `Object` is the insert shot: the close-up of what the two figures in that
// scene are doing. `side` puts it on the opposite side of the frame from the
// scene's own subject (measured positions live in the mobile --scene-dx block in
// globals.css) so the two balance instead of stacking.
const SLIDES = [
  { word: 'play', ...FRENSPAY_COPY.slides.play, sky: '#fad5a0', Object: PlayCradle, side: 'right' },
  { word: 'stay', ...FRENSPAY_COPY.slides.stay, sky: '#fbe6c8', Object: StayKnot, side: 'left' },
  { word: 'pay', ...FRENSPAY_COPY.slides.pay, sky: '#f9ddb8', Object: PayNote, side: 'left' },
  { word: 'relay', ...FRENSPAY_COPY.slides.relay, sky: '#fce5c2', Object: RelayNote, side: 'right' },
] as const;

// Also the duration of each scene's slow zoom, handed to CSS as --hold so this
// stays the only place the interval is written down.
const HOLD_MS = 6000;
const SWAP_MS = 650;

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function ThingsHero() {
  const [index, setIndex] = useState(0);
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

  const paused = focused || engaged || stopped || reducedMotion;

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
      style={{ '--sky': SLIDES[index].sky, '--hold': `${HOLD_MS}ms` } as CSSProperties}
    >
      <h1 className="sr-only">things between frens</h1>
      <ThingsBackdrop scenes={SLIDES} index={index} />
      <header className="things-topline safe-x">
        <div>
          <p className="things-eyebrow">Things between frens</p>
          <p className="things-support">{FRENSPAY_COPY.supporting}</p>
        </div>
        <span className="things-home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" width="22" height="28" />
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
        // Only keyboard focus pauses: clicking a tabIndex element focuses it
        // too, and pausing on that stops the rotation for good.
        onFocusCapture={(event) => {
          const target = event.target as HTMLElement;
          if (target.matches?.(':focus-visible')) setFocused(true);
        }}
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
