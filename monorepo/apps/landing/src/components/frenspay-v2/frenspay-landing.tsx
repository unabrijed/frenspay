'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { MouseEventHandler } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

import { V2FoldedNote } from './folded-note';
import { V2HeroCopy } from './hero-copy';
import { V2Navigation } from './navigation';

export function FrensPayV2Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const lenisRef = useRef<Lenis | null>(null);

  const focusFList = useCallback(() => {
    const target = document.getElementById('fp-v2-flist');
    const focusTarget = document.getElementById('fp-v2-flist-email') ?? document.getElementById('fp-v2-flist-status');
    if (!target || !focusTarget) return;

    const finish = () => focusTarget.focus({ preventScroll: true });
    if (lenisRef.current) {
      const journey = rootRef.current?.querySelector<HTMLElement>('.fp-journey');
      lenisRef.current.scrollTo(journey ?? 0, { offset: 0, duration: 0.82, onComplete: finish });
    } else {
      target.scrollIntoView({ behavior: 'auto', block: 'center' });
      window.setTimeout(finish, 0);
    }
  }, []);

  const showFyi = useCallback(() => {
    const journey = rootRef.current?.querySelector<HTMLElement>('.fp-journey');
    if (!journey) return;
    const destination = journey.offsetTop + (journey.offsetHeight - window.innerHeight) * 0.78;
    if (lenisRef.current) lenisRef.current.scrollTo(destination, { duration: 1.1 });
    else window.scrollTo({ top: destination, behavior: 'auto' });
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    gsap.registerPlugin(ScrollTrigger);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lenis: Lenis | null = null;
    let ticker: ((time: number) => void) | null = null;

    if (!reduced) {
      lenis = new Lenis({
        duration: 1.1,
        smoothWheel: true,
        wheelMultiplier: 0.88,
        touchMultiplier: 1,
      });
      lenisRef.current = lenis;
      lenis.on('scroll', ScrollTrigger.update);
      ticker = (time: number) => lenis?.raf(time * 1000);
      gsap.ticker.add(ticker);
      gsap.ticker.lagSmoothing(0);
    }

    const mm = gsap.matchMedia();
    const context = gsap.context(() => {
      if (!reduced) {
        gsap.to('.fp-scroll-progress', {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: { start: 0, end: 'max', scrub: true },
        });
      }

      ScrollTrigger.create({
        start: 0,
        end: 'max',
        onUpdate: (self) => root.querySelector('.fp-nav')?.classList.toggle('is-scrolled', self.scroll() > 80),
      });

      mm.add(
        {
          desktop: '(min-width: 961px)',
          tablet: '(min-width: 641px) and (max-width: 960px)',
          mobile: '(max-width: 640px)',
          motion: '(prefers-reduced-motion: no-preference)',
        },
        (matchContext) => {
          const conditions = matchContext.conditions as {
            desktop: boolean;
            tablet: boolean;
            mobile: boolean;
            motion: boolean;
          };

          if (!conditions.motion) {
            gsap.set('.fp-word-strip', { yPercent: -75 });
            return;
          }

          const entrance = gsap.timeline({ defaults: { ease: 'power4.out' } });
          entrance
            .fromTo('.fp-background-f', { opacity: 0, scale: 0.96 }, { opacity: 0.58, scale: 1, duration: 0.65 }, 0)
            .fromTo('.fp-hero-line-inner', { yPercent: 110 }, { yPercent: 0, stagger: 0.08, duration: 0.82 }, 0.08)
            .fromTo('.fp-hero-supporting', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' }, 0.28)
            .fromTo(
              '.fp-note-entrance',
              { x: conditions.mobile ? '22vw' : '34vw', y: conditions.mobile ? -18 : -28, rotation: 7 },
              { x: 0, y: 0, rotation: 0, duration: 1.05 },
              0.18,
            )
            .fromTo('.fp-note-underlayer', { x: 38, y: 34, rotation: 4 }, { x: 0, y: 0, rotation: 1.4, duration: 0.78, ease: 'power3.out' }, 0.34)
            .fromTo('.fp-receipt-layer', { y: 46, rotation: 3 }, { y: 0, rotation: -1.1, duration: 0.72, ease: 'power3.out' }, 0.39)
            .fromTo('.fp-seal', { scale: 0.72, rotation: 18, opacity: 0 }, { scale: 1, rotation: 5, opacity: 1, duration: 0.62, ease: 'back.out(1.25)' }, 0.74);

          const wordTimeline = gsap.timeline({ delay: 1.62 });
          [25, 50, 75].forEach((position) => {
            wordTimeline
              .to({}, { duration: 1.25 })
              .to('.fp-word-strip', { yPercent: -position, rotation: position === 50 ? -0.28 : 0.24, duration: 0.58, ease: 'power3.inOut' })
              .to('.fp-word-strip', { rotation: 0, duration: 0.16, ease: 'power2.out' });
          });

          let wordResolved = false;
          const noteX = conditions.desktop ? () => -window.innerWidth * 0.245 : 0;
          const noteY = conditions.mobile ? -56 : conditions.tablet ? -42 : 18;
          const unfoldedScale = conditions.mobile ? 0.82 : conditions.tablet ? 0.73 : 0.69;
          const sealY = conditions.mobile ? 380 : conditions.tablet ? 440 : 510;

          const story = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: {
              trigger: '.fp-journey',
              start: 'top top',
              end: 'bottom bottom',
              scrub: true,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                if (self.progress > 0.18 && !wordResolved) {
                  wordResolved = true;
                  wordTimeline.progress(1).kill();
                  gsap.set('.fp-word-strip', { yPercent: -75, rotation: 0 });
                }
              },
            },
          });

          story
            .to('.fp-note-motion', { x: noteX, y: noteY, rotation: -1, scale: 0.94, duration: 0.18 }, 0)
            .to('.fp-hero-copy', { y: '-7vh', duration: 0.18 }, 0)
            .to('.fp-hero-supporting', { opacity: 0.42, duration: 0.18 }, 0)
            .to('.fp-background-f', { scale: 1.08, opacity: 0.42, duration: 0.18 }, 0)
            .to('.fp-front-flap', { rotationX: -112, y: 24, duration: 0.24 }, 0.18)
            .to('.fp-note-fold', { rotateY: 72, opacity: 0.28, duration: 0.2 }, 0.18)
            .to('.fp-receipt-layer', { y: 48, x: -10, duration: 0.24 }, 0.18)
            .to('.fp-note-underlayer', { x: 9, y: 13, duration: 0.24 }, 0.18)
            .to('.fp-seal', { rotation: -4, duration: 0.24 }, 0.18)
            .to('.fp-flist-strip', { opacity: 0, y: 20, pointerEvents: 'none', duration: 0.12 }, 0.22)
            .to('.fp-unfold-sheet', { clipPath: 'inset(0% 0% 0% 0%)', scaleY: 1, y: 0, opacity: 1, duration: 0.28 }, 0.42)
            .to('.fp-note-motion', { y: conditions.mobile ? -155 : -170, rotation: 0, scale: unfoldedScale, duration: 0.28 }, 0.42)
            .to('.fp-note-face', { y: -42, duration: 0.28 }, 0.42)
            .to('.fp-receipt-layer', { y: 82, duration: 0.28 }, 0.42)
            .to('.fp-mystery-line', { yPercent: 0, opacity: 1, stagger: 0.08, duration: 0.18 }, 0.7)
            .fromTo('.fp-mostly', { opacity: 0, scale: 0.92, rotation: -8 }, { opacity: 1, scale: 1, rotation: -2, duration: 0.12 }, 0.88)
            .to('.fp-seal', { x: conditions.mobile ? -42 : -92, y: sealY, rotation: -1, scale: 0.78, duration: 0.12 }, 0.88)
            .to('.fp-resolution', { opacity: 1, y: 0, duration: 0.1 }, 0.9);

          if (conditions.desktop || conditions.tablet) {
            const depth = root.querySelector<HTMLElement>('.fp-note-depth');
            const note = root.querySelector<HTMLElement>('.fp-note');
            if (depth && note && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
              const toX = gsap.quickTo(depth, '--fp-pointer-x', { duration: 0.42, ease: 'power2.out' });
              const toY = gsap.quickTo(depth, '--fp-pointer-y', { duration: 0.42, ease: 'power2.out' });
              const move = (event: PointerEvent) => {
                if ((event.target as Element).closest('.fp-flist-strip')) return;
                const rect = note.getBoundingClientRect();
                toX(((event.clientX - rect.left) / rect.width - 0.5) * 2);
                toY(((event.clientY - rect.top) / rect.height - 0.5) * 2);
              };
              const leave = () => { toX(0); toY(0); };
              note.addEventListener('pointermove', move, { passive: true });
              note.addEventListener('pointerleave', leave, { passive: true });
              return () => {
                note.removeEventListener('pointermove', move);
                note.removeEventListener('pointerleave', leave);
              };
            }
          }
        },
      );
    }, root);

    let active = true;
    void document.fonts.ready.then(() => {
      if (active) ScrollTrigger.refresh();
    });

    return () => {
      active = false;
      mm.revert();
      context.revert();
      if (ticker) gsap.ticker.remove(ticker);
      gsap.ticker.lagSmoothing(500, 33);
      lenis?.destroy();
      lenisRef.current = null;
    };
  }, []);

  const returnToForm = useCallback<MouseEventHandler<HTMLAnchorElement>>((event) => {
    event.preventDefault();
    focusFList();
  }, [focusFList]);

  return (
    <div className="fp-v2-page" id="fp-v2-top" ref={rootRef}>
      <div className="fp-scroll-progress" aria-hidden="true" />
      <div className="fp-noise" aria-hidden="true" />
      <V2Navigation onFListClick={focusFList} onFyiClick={showFyi} />
      <main>
        <section className="fp-journey" aria-label="A note passed between frens">
          <div className="fp-sticky-stage">
            <div className="fp-canvas-field" aria-hidden="true" />
            <span className="fp-background-f" aria-hidden="true">f</span>
            <span className="fp-print-line fp-print-line-a" aria-hidden="true" />
            <span className="fp-print-line fp-print-line-b" aria-hidden="true" />
            <span className="fp-registration fp-registration-a" aria-hidden="true">+</span>
            <span className="fp-registration fp-registration-b" aria-hidden="true">08—26 / PASS</span>
            <section className="fp-hero" aria-label="FrensPay introduction">
              <V2HeroCopy />
            </section>
            <div className="fp-note-stage">
              <V2FoldedNote onReturnToForm={returnToForm} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
