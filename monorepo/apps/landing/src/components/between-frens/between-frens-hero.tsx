'use client';

import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent } from 'react';

import { captureRef } from '@/components/ref';
import { joinWaitlist, WaitlistApiError } from '@/lib/waitlist';

import styles from './between-frens.module.css';

const VIDEO_SRC = '/videos/frenspay-between-frens.mp4';
const POSTER_SRC = '/images/frenspay-between-frens-poster.webp';
const WORDS = ['play', 'stay', 'stray', 'pay'] as const;

type Segment = 0 | 1 | 2 | 3;
type SubmissionState = 'idle' | 'loading' | 'success';

export function BetweenFrensHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const activeSegmentRef = useRef<Segment>(3);
  const animationFrameRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const warnedRef = useRef(false);
  const [activeSegment, setActiveSegment] = useState<Segment>(3);
  const [posterOnly, setPosterOnly] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [submission, setSubmission] = useState<SubmissionState>('idle');
  const [error, setError] = useState<string | null>(null);

  const setSegment = useCallback((next: Segment) => {
    if (activeSegmentRef.current === next) return;
    activeSegmentRef.current = next;
    setActiveSegment(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    captureRef();

    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const showPay = () => setSegment(3);
    const updateSegment = () => {
      animationFrameRef.current = null;
      if (motionQuery.matches || video.paused || !Number.isFinite(video.duration) || video.duration <= 0) {
        showPay();
        return;
      }

      const quarter = video.duration / WORDS.length;
      const next = Math.min(WORDS.length - 1, Math.floor(video.currentTime / quarter)) as Segment;
      setSegment(next);
    };
    const scheduleSegmentUpdate = () => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(updateSegment);
    };
    const attemptPlayback = () => {
      if (motionQuery.matches) {
        video.pause();
        setPosterOnly(true);
        showPay();
        return;
      }

      const playback = video.play();
      if (playback) {
        void playback.catch(() => {
          if (!mountedRef.current) return;
          setPosterOnly(true);
          showPay();
        });
      }
    };
    const handlePlaying = () => {
      setPosterOnly(false);
      scheduleSegmentUpdate();
    };
    const handlePause = () => showPay();
    const handleError = () => {
      setPosterOnly(true);
      showPay();
      if (!warnedRef.current) {
        warnedRef.current = true;
        console.warn(
          `[BETWEEN FRENS development warning] Missing or unreadable video asset at ${VIDEO_SRC}; poster fallback remains active.`,
        );
      }
    };
    const handleMotionPreference = () => {
      setReducedMotion(motionQuery.matches);
      if (motionQuery.matches) {
        video.pause();
        setPosterOnly(true);
        showPay();
      } else {
        attemptPlayback();
      }
    };

    video.addEventListener('loadedmetadata', scheduleSegmentUpdate);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', scheduleSegmentUpdate);
    video.addEventListener('error', handleError);
    motionQuery.addEventListener('change', handleMotionPreference);
    handleMotionPreference();

    return () => {
      video.removeEventListener('loadedmetadata', scheduleSegmentUpdate);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', scheduleSegmentUpdate);
      video.removeEventListener('error', handleError);
      motionQuery.removeEventListener('change', handleMotionPreference);
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    };
  }, [setSegment]);

  useEffect(() => {
    if (!expanded || submission === 'success') return;
    const focusDelay = reducedMotion ? 0 : 480;
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), focusDelay);
    return () => window.clearTimeout(timer);
  }, [expanded, reducedMotion, submission]);

  const expandForm = (event: MouseEvent<HTMLButtonElement>) => {
    returnFocusRef.current = event.currentTarget;
    setExpanded(true);
    setError(null);
  };

  const collapseForm = () => {
    if (email || submission !== 'idle') return;
    setExpanded(false);
    setError(null);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape' || email) return;
    event.preventDefault();
    collapseForm();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submission === 'loading') return;

    const field = inputRef.current;
    const normalizedEmail = email.trim();
    if (!field || !normalizedEmail || !field.validity.valid) {
      setError('Enter a valid email address.');
      field?.focus();
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setSubmission('loading');
    setError(null);

    try {
      await joinWaitlist(normalizedEmail, controller.signal);
      if (!mountedRef.current) return;
      setSubmission('success');
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (caught instanceof WaitlistApiError && caught.status === 400) {
        setError('That email doesn’t look right. Check it and try again.');
      } else if (caught instanceof WaitlistApiError && caught.status === 429) {
        setError('Too many tries. Give it a minute, then try again.');
      } else {
        setError('Couldn’t join right now. Try again.');
      }
      setSubmission('idle');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return (
    <div className={styles.hero}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.poster} src={POSTER_SRC} alt="" aria-hidden="true" />
      <video
        ref={videoRef}
        className={`${styles.video} ${posterOnly ? styles.videoPosterOnly : ''}`}
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className={`${styles.overlay} ${styles.readabilityOverlay}`} aria-hidden="true" />
      <div className={`${styles.overlay} ${styles.sideOverlay}`} aria-hidden="true" />
      <div className={`${styles.overlay} ${styles.atmosphereOverlay}`} aria-hidden="true" />
      <div className={styles.grain} aria-hidden="true" />

      <header className={styles.header}>
        <nav className={styles.nav} aria-label="Primary">
          <a className={styles.brand} href="/v3" aria-label="FrensPay, back to the beginning">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="" width="17" height="22" />
            <span>frenspay</span>
          </a>
          <div className={styles.navActions}>
            <span className={styles.fyi}>fyi</span>
            <button className={styles.navJoin} type="button" onClick={expandForm} aria-expanded={expanded}>
              join the f-list
            </button>
          </div>
        </nav>
      </header>

      <main className={styles.content}>
        <div className={styles.topArea}>
          <p className={styles.eyebrow}>something between frens</p>
          <h1 className={styles.heading}>
            frens pay.
            <br />
            frens get paid.
          </h1>
          <div className={styles.sequence} aria-label={`play, stay, stray, pay. ${WORDS[activeSegment]} active.`}>
            {WORDS.map((word, index) => (
              <span key={word} className={styles.sequenceItem}>
                {index > 0 ? <span className={styles.separator}>/</span> : null}
                <span className={index === activeSegment ? styles.activeWord : styles.inactiveWord}>{word}</span>
              </span>
            ))}
          </div>
        </div>

        <div className={styles.bottomArea}>
          <p className={styles.supporting}>something for people who know people.</p>
          <div className={`${styles.fListRegion} ${expanded ? styles.fListExpanded : ''}`}>
            <button
              className={styles.editorialAction}
              type="button"
              onClick={expandForm}
              aria-expanded={expanded}
              disabled={expanded}
            >
              <span>join the f-list</span>
              <ArrowUpRight className={styles.actionArrow} aria-hidden="true" strokeWidth={1.8} />
            </button>

            <div className={styles.formStage} aria-hidden={!expanded}>
              {submission === 'success' ? (
                <p className={styles.success} role="status" aria-live="polite">
                  fyi, you’re in.
                </p>
              ) : (
                <form className={styles.form} onSubmit={submit} noValidate aria-busy={submission === 'loading'}>
                  <div className={styles.formLine}>
                    <label className={styles.srOnly} htmlFor="between-frens-email">
                      email address
                    </label>
                    <input
                      ref={inputRef}
                      id="between-frens-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      placeholder="email address"
                      onChange={(event) => setEmail(event.target.value)}
                      onKeyDown={handleInputKeyDown}
                      required
                      disabled={!expanded || submission === 'loading'}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'between-frens-error' : undefined}
                    />
                    <button type="submit" disabled={!expanded || submission === 'loading'}>
                      <span>{submission === 'loading' ? 'joining…' : 'join'}</span>
                      {submission !== 'loading' ? (
                        <ArrowRight aria-hidden="true" strokeWidth={1.8} />
                      ) : null}
                    </button>
                  </div>
                  <div className={styles.status} aria-live="polite" aria-atomic="true">
                    {error ? (
                      <p id="between-frens-error" className={styles.error} role="alert">
                        {error}
                      </p>
                    ) : submission === 'loading' ? (
                      <span className={styles.srOnly}>joining…</span>
                    ) : null}
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
