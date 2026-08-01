import { Fragment } from 'react';
import type { CSSProperties } from 'react';

import { CityProvider } from '@/components/CityContext';
import { CityPills } from '@/components/CityPills';
import { GlyphBackdrop } from '@/components/GlyphBackdrop';
import { Logo, Wordmark } from '@/components/Logo';
import { MoneyDust } from '@/components/MoneyDust';
import { Pill } from '@/components/Pill';
import { QrStage } from '@/components/PixelField';
import { Rail } from '@/components/QrHero';
import { QuoteWidget } from '@/components/QuoteWidget';
import { Reveal } from '@/components/Reveal';
import { Waitlist } from '@/components/Waitlist';

const DEMO_URL = '#'; // TODO(bridge): deployed web-app URL

const h2 = 'text-[clamp(2rem,4vw,3rem)] font-extrabold leading-[1.02] tracking-[-0.03em]';

/* Headlines arrive a word at a time, so the type itself carries motion rather
   than the whole block sliding as one slab. The mask does the clipping (see
   .word-mask); --i is what cascades them. */
function Words({ children }: { children: string }) {
  return (
    <>
      {children.split(' ').map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="word-mask">
            <span className="word" style={{ '--i': i } as CSSProperties}>
              {w}
            </span>
          </span>
        </Fragment>
      ))}
    </>
  );
}

export default function Page() {
  return (
    <CityProvider>
      <MoneyDust />
      <main id="top">
        <Nav />
        <Hero />
        <Countries />
        <HowItWorks />
        <Rates />
        <Comparison />
        <Security />
        <FList />
        <Footer />
      </main>
    </CityProvider>
  );
}

function Nav() {
  return (
    <header className="nav-bar sticky top-0 z-40">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-4 sm:px-10">
        <a href="#top" aria-label="FrensPay — top of page">
          <Logo markClass="h-8" wordClass="text-[24px] text-ink" />
        </a>
        <nav className="hidden items-center gap-7 text-[15px] font-semibold text-muted md:flex">
          <a href="#top" className="transition-colors hover:text-ink">
            Product
          </a>
          <a href="#countries" className="transition-colors hover:text-ink">
            Countries
          </a>
          <a href="#how" className="transition-colors hover:text-ink">
            How it works
          </a>
          <a href="#rates" className="transition-colors hover:text-ink">
            Rates
          </a>
          <a href="#security" className="transition-colors hover:text-ink">
            Security
          </a>
        </nav>
        <Pill href="#flist" variant="terra">
          Get fpay
        </Pill>
      </div>
      {/* How far down the page you are — pure CSS, see .progress. */}
      <span aria-hidden className="progress" />
    </header>
  );
}

/* The pitch and the code hold still (.hero-pin) while the four steps of a
   payment scroll past them — desktop only, and only where scroll timelines
   exist. Everywhere else this is the same stacked hero on a load timer. */
function Hero() {
  return (
    <section className="px-6 pb-16 pt-12 sm:px-10 lg:pb-20 lg:pt-16">
      <div className="mx-auto grid max-w-[1180px] gap-14 lg:grid-cols-12">
        <div className="relative lg:col-span-6">
          <GlyphBackdrop className="-left-4 -top-20 -z-10 text-[clamp(9rem,16vw,14rem)] lg:-left-8" />
          <h1 className="load-words text-[clamp(2.8rem,6.5vw,4.5rem)] font-extrabold leading-[0.98] tracking-[-0.035em]">
            <Words>Global dollars. Local scan.</Words>
          </h1>
          <p className="animate-blur-fade-up mt-5 max-w-md text-lg leading-relaxed text-muted [--d:280ms]">
            One balance in dollars. Scan the QR that&apos;s already on the counter. They&apos;re paid instantly, in
            their own money.
          </p>
          <div className="animate-blur-fade-up mt-9 flex flex-wrap items-center gap-6 [--d:400ms]">
            <Pill href="#flist" variant="terra">
              Start with dollars
            </Pill>
            <a
              href={DEMO_URL}
              className="text-[15px] font-semibold text-terra transition-colors hover:text-terra-deep"
            >
              Run a payment →
            </a>
          </div>
          {/* The rails, not a count. fpay is pre-launch — any "N countries"
              number would be a claim we'd have to walk back. */}
          <p className="animate-blur-fade-up eyebrow mt-7 text-muted [--d:520ms]">
            UPI · PromptPay · Pix · DuitNow
          </p>
          {/* No entrance class here — the pixels assembling ARE the entrance.
              QrStage renders the SVG QR plus, where WebGL2 allows, a particle
              field anchored to it. */}
          <div className="hero-pin mt-12 flex justify-center lg:justify-start">
            <QrStage />
          </div>
        </div>
        <div className="lg:col-span-6">
          <Rail />
        </div>
      </div>
    </section>
  );
}

function Countries() {
  return (
    <section id="countries" className="relative overflow-hidden px-6 pb-24 pt-4 sm:pb-28">
      <GlyphBackdrop className="-right-6 top-0 -z-10 text-[clamp(7rem,12vw,11rem)]" />
      <Reveal className="mx-auto max-w-[1180px] text-center">
        <CityPills />
        <p className="mx-auto mt-5 max-w-md text-[15px] text-muted">
          Wherever scan-and-pay already works. Tap a city — the payment above and the quote below follow.
        </p>
      </Reveal>
    </section>
  );
}

const FEATURES = [
  { title: 'Hold dollars', line: 'Top up once. One USD balance for every country you land in.', d: 'dollar' },
  { title: 'Lock the rate', line: 'The rate on screen freezes before you confirm — nothing settles differently later.', d: 'lock' },
  { title: 'Pay instantly', line: "The merchant has their money before you've pocketed your phone.", d: 'bolt' },
] as const;

const fGlyphs = {
  dollar: (
    <path d="M12 3v18M16.5 6.5c-1-1-2.7-1.5-4.5-1.5-2.2 0-4 1.1-4 3s1.6 2.6 4 3c2.4.4 4 1.1 4 3s-1.8 3-4 3c-1.8 0-3.5-.5-4.5-1.5" />
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  bolt: <path d="M13 3 5 13.5h5.5L11 21l8-10.5h-5.5L13 3Z" />,
} as const;

function FIcon({ d }: { d: keyof typeof fGlyphs }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {fGlyphs[d]}
    </svg>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="px-6 py-24 sm:py-28">
      <Reveal className="mx-auto max-w-[1180px]" variant="wipe scale">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow text-terra">How it works</p>
          <h2 className={`${h2} mt-3`}>
            <Words>Dollars in. Local money out.</Words>
          </h2>
        </div>
        <div className="relative mt-12 grid gap-5 md:grid-cols-3">
          <span
            aria-hidden
            className="absolute left-[14%] right-[14%] top-[60px] z-[1] hidden border-t-2 border-dashed border-terra/20 md:block"
          />
          {FEATURES.map((f, i) => (
            <div key={f.title} className="stag rounded-[28px] bg-surface-low p-8" style={{ '--i': i } as CSSProperties}>
              <span className="relative z-[2] flex h-14 w-14 items-center justify-center rounded-full bg-peach text-terra shadow-tactile">
                <FIcon d={f.d} />
              </span>
              <h3 className="mt-6 text-[20px] font-extrabold tracking-[-0.01em]">{f.title}</h3>
              <p className="mt-2 text-[15px] text-muted">{f.line}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col justify-between gap-6 rounded-[28px] bg-teal-soft p-8 text-teal-on sm:flex-row sm:items-center sm:p-10">
          <div>
            <h3 className="text-[26px] font-extrabold leading-tight tracking-[-0.01em]">Split it by @handle.</h3>
            <p className="mt-2 max-w-md text-teal-on">
              Send or request by name or phone — no account numbers, no screenshots of QR codes.
            </p>
          </div>
          <div className="flex w-fit shrink-0 items-center gap-3 rounded-full bg-white/85 py-2 pl-2 pr-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-peach text-[13px] font-semibold text-terra">
              a
            </span>
            <span className="text-[14px] font-semibold">@asha</span>
            <span className="tabular text-[14px] font-semibold text-terra">Request $6.20</span>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* The one full-bleed brand surface in the middle of the page. Five near-cream
   sections in a row is what made the scroll feel flat; this breaks it, and a
   brand-gradient surface is the one place texture (.grain) and a slow ambient
   drift are already on-system. */
function Rates() {
  return (
    <section id="rates" className="grain brand-gradient gradient-drift px-6 py-24 text-white sm:py-28">
      <Reveal className="mx-auto max-w-[1180px]" variant="wipe">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className={h2}>
            <Words>Type a price. See what leaves your balance.</Words>
          </h2>
          {/* Solid white: on the gradient's light stop (#c84b34) /75 is ~3.3:1. */}
          <p className="mx-auto mt-4 max-w-lg text-white">
            The rate, the fee, and the arrival time — all before you confirm. The rate holds still while you decide.
          </p>
        </div>
        <div className="mt-12">
          <QuoteWidget />
        </div>
      </Reveal>
    </section>
  );
}

const COMPARE = [
  ['3–5% foreign fees, discovered later', 'The fee is on the quote'],
  ['A rate that settles days later', "A rate that's locked when you pay"],
  ['“Card not accepted” at the stall', 'The same QR everyone scans'],
  ['Declines you sort out yourself', 'Reroutes or refunds, automatically'],
] as const;

function Comparison() {
  return (
    <section className="px-6 py-24 sm:py-28">
      <Reveal className="mx-auto max-w-[1180px]" variant="split">
        <div className="grid overflow-hidden rounded-[28px] md:grid-cols-2">
          <div data-col="l" className="bg-ink p-8 text-white sm:p-10">
            <p className="eyebrow text-white/65">Your bank card abroad</p>
            <ul className="mt-6 divide-y divide-white/10">
              {COMPARE.map(([left], i) => (
                <li
                  key={left}
                  className="stag py-4 text-[15px] text-white/70 sm:text-[16px]"
                  style={{ '--i': i } as CSSProperties}
                >
                  {left}
                </li>
              ))}
            </ul>
          </div>
          <div data-col="r" className="grain brand-gradient p-8 text-white sm:p-10">
            <p className="eyebrow text-white">fpay</p>
            <ul className="mt-6 divide-y divide-white/20">
              {/* Same index as the left column, so the pairs land together. */}
              {COMPARE.map(([, right], i) => (
                <li
                  key={right}
                  className="stag py-4 text-[15px] font-semibold sm:text-[16px]"
                  style={{ '--i': i } as CSSProperties}
                >
                  {right}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const SECURITY = [
  'Only you can move your money. Not fpay, not anyone else.',
  'Every payment is approved on your device before any money moves.',
  'The price on screen when you tap Pay is the price that settles — rate and fee itemized first.',
  'Lose your phone, lose nothing. Sign in with your email on any device — your balance is already there.',
] as const;

function Security() {
  return (
    <section id="security" className="px-6 py-24 sm:py-28">
      <Reveal className="mx-auto max-w-2xl" variant="wipe">
        <p className="eyebrow text-terra">Security</p>
        <h2 className={`${h2} mt-3`}>
          <Words>Your money. Only your say-so.</Words>
        </h2>
        <ul className="mt-8 divide-y divide-hair border-t border-hair">
          {SECURITY.map((line, i) => (
            <li key={line} className="stag py-4 text-[16px] text-muted" style={{ '--i': i } as CSSProperties}>
              {line}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

function FList() {
  return (
    <section id="flist" className="px-6 py-24 sm:py-32">
      <Reveal className="mx-auto flex max-w-2xl flex-col items-center text-center" variant="wipe">
        <h2 className={h2}>
          <Words>First we board the f list. Then we board the plane.</Words>
        </h2>
        <p className="mt-5 max-w-md text-muted">
          The f list is the early-access queue. fpay is pre-launch — leave your email and you&apos;re first through the
          gate.
        </p>
        <div className="mt-9 flex w-full justify-center">
          <Waitlist />
        </div>
        <a href={DEMO_URL} className="mt-6 text-[14px] font-semibold text-terra transition-colors hover:text-terra-deep">
          or try the demo first →
        </a>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-4 rounded-t-[28px] bg-ink text-white">
      <div className="mx-auto max-w-[1180px] px-6 pt-14 sm:px-10">
        <div className="flex flex-col justify-between gap-6 border-b border-white/10 pb-10 sm:flex-row sm:items-center">
          <Logo markClass="h-7" wordClass="text-[20px] text-white" />
          <nav className="flex gap-7 text-[14px] font-semibold text-white/70">
            <a href={DEMO_URL} className="transition-colors hover:text-white">
              Try the demo
            </a>
            <a href="#flist" className="transition-colors hover:text-white">
              the f list
            </a>
          </nav>
        </div>
        <p className="pt-8 text-[13px] text-white/65">© 2026 fpay · Made for people in line at a street stall.</p>
      </div>
      <div aria-hidden className="overflow-hidden">
        <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
          <Wordmark className="footer-mark block text-[clamp(3.2rem,10.5vw,8.2rem)] leading-none text-terra-ctr/90" />
        </div>
      </div>
    </footer>
  );
}
