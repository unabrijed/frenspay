import { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { CityProvider } from '@/components/CityContext';
import { CityPills } from '@/components/CityPills';
import { Logo, Wordmark } from '@/components/Logo';
import { ModuleFigure, finder, locked, paired, scattered, solid, streaming } from '@/components/ModuleFigure';
import { Pill } from '@/components/Pill';
import { QrStage } from '@/components/PixelField';
import { Rail } from '@/components/QrHero';
import { QuoteWidget } from '@/components/QuoteWidget';
import { Reveal } from '@/components/Reveal';
import { Waitlist } from '@/components/Waitlist';

const DEMO_URL = '#'; // TODO(bridge): deployed web-app URL

const h2 = 'text-[clamp(2rem,4vw,3rem)] font-extrabold leading-[1.02] tracking-[-0.03em]';
const h3 = 'text-[20px] font-extrabold tracking-[-0.01em]';

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

/* Every section below the hero is the same shape: one hairline at the boundary,
   a numbered label and headline in the narrow left column, content in the wide
   right. Never 50/50, never centred — the asymmetry is what stops six stacked
   sections reading as a template. */
function Section({
  id,
  n,
  label,
  title,
  children,
}: {
  id?: string;
  n: string;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="border-t border-hair px-6 py-20 sm:px-10 lg:py-24">
      <Reveal className="mx-auto grid max-w-[1180px] gap-x-16 gap-y-10 lg:grid-cols-[1fr_1.6fr]" variant="wipe">
        <div>
          <p className="eyebrow text-muted">
            {n} <span className="text-hair">/</span> {label}
          </p>
          <h2 className={`${h2} mt-4 max-w-sm`}>
            <Words>{title}</Words>
          </h2>
        </div>
        <div>{children}</div>
      </Reveal>
    </section>
  );
}

export default function Page() {
  return (
    <CityProvider>
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
        <div className="lg:col-span-6">
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
          {/* The rails, not a count. FrensPay is pre-launch — any "N countries"
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
    <Section id="countries" n="01" label="Countries" title="Wherever scan-and-pay already works.">
      <CityPills />
      <p className="mt-7 max-w-md text-[15px] text-muted">
        Tap a city — the payment above and the quote below follow.
      </p>
    </Section>
  );
}

/* Three states of one atom. The block is a balance; the held row is a rate that
   stops moving; the streaming edge is the hero's own release at a fraction of
   the amplitude. Same pitch, same ramp, same drawing instrument throughout. */
const FEATURES = [
  { title: 'Hold dollars', line: 'Top up once. One USD balance for every country you land in.', cell: solid },
  {
    title: 'Lock the rate',
    line: 'The rate on screen freezes before you confirm — nothing settles differently later.',
    cell: locked(5),
  },
  {
    title: 'Pay instantly',
    line: "The merchant has their money before you've pocketed your phone.",
    cell: streaming(8, 5),
  },
  {
    title: 'Split it by @handle',
    line: 'Send or request by name or phone — no account numbers, no screenshots of QR codes.',
    cell: paired(8),
  },
] as const;

function HowItWorks() {
  return (
    <Section id="how" n="02" label="How it works" title="Dollars in. Local money out.">
      <div className="border-t border-hair">
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            className="stag flex items-start gap-6 border-b border-hair py-7 sm:gap-8"
            style={{ '--i': i } as CSSProperties}
          >
            <span className="tabular eyebrow shrink-0 pt-1 text-muted">0{i + 1}</span>
            <ModuleFigure cols={8} rows={5} m={9} cell={f.cell} className="mt-0.5 shrink-0 text-ink" />
            <div className="min-w-0">
              <h3 className={h3}>{f.title}</h3>
              <p className="mt-1.5 text-[15px] text-muted">{f.line}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Rates() {
  return (
    <Section id="rates" n="03" label="Rates" title="Type a price. See what leaves your balance.">
      <p className="max-w-lg text-[15px] text-muted">
        The rate, the fee, and the arrival time — all before you confirm. The rate holds still while you decide.
      </p>
      <div className="mt-9">
        <QuoteWidget />
      </div>
    </Section>
  );
}

const COMPARE = [
  ['3–5% foreign fees, discovered later', 'The fee is on the quote'],
  ['A rate that settles days later', "A rate that's locked when you pay"],
  ['“Card not accepted” at the stall', 'The same QR everyone scans'],
  ['Declines you sort out yourself', 'Reroutes or refunds, automatically'],
] as const;

const scatteredFig = scattered(9, 6);

/* The page's one tonal inversion, and the only section that gets extra height.
   The figures carry the argument: the left column's modules are off-grid and
   drifting — the exact geometry deleted from the hero in this change — while the
   right column's sit on an exact pitch. */
function Comparison() {
  return (
    <section className="border-t border-hair bg-ink px-6 py-24 text-white sm:px-10 lg:py-28">
      <Reveal className="mx-auto max-w-[1180px]" variant="wipe">
        <p className="eyebrow text-white/45">
          04 <span className="text-white/25">/</span> The difference
        </p>
        <div className="mt-12 grid gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <ModuleFigure cols={9} rows={6} cell={scatteredFig} className="text-white/40" />
            <h3 className={`${h3} mt-7 text-white/70`}>Your bank card abroad</h3>
            <ul className="mt-5 divide-y divide-white/10 border-t border-white/10">
              {COMPARE.map(([left], i) => (
                <li
                  key={left}
                  className="stag py-4 text-[15px] text-white/60 sm:text-[16px]"
                  style={{ '--i': i } as CSSProperties}
                >
                  {left}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <ModuleFigure cols={9} rows={6} cell={solid} className="text-terra-ctr" />
            <h3 className={`${h3} mt-7`}>
              <Wordmark />
            </h3>
            <ul className="mt-5 divide-y divide-white/15 border-t border-white/15">
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
    <Section id="security" n="05" label="Security" title="Your money. Only your say-so.">
      {/* The finder pattern: the mark a scanner orients against, and the same
          geometry the hero code is built from. Nothing about it moves. */}
      <ModuleFigure cols={7} rows={7} m={9} cell={finder} className="mb-9 text-terra" />
      <ul className="divide-y divide-hair border-t border-hair">
        {SECURITY.map((line, i) => (
          <li key={line} className="stag py-4 text-[16px] text-muted" style={{ '--i': i } as CSSProperties}>
            {line}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function FList() {
  return (
    <section id="flist" className="border-t border-hair px-6 py-20 sm:px-10 lg:py-24">
      <Reveal className="mx-auto grid max-w-[1180px] gap-x-16 gap-y-10 lg:grid-cols-[1fr_1.6fr]" variant="wipe">
        <h2 className={`${h2} max-w-sm`}>
          <Words>First we board the f list. Then we board the plane.</Words>
        </h2>
        <div>
          <p className="max-w-md text-muted">
            The f list is the early-access queue. fpay is pre-launch — leave your email and you&apos;re first through
            the gate.
          </p>
          <div className="mt-9">
            <Waitlist />
          </div>
          <a
            href={DEMO_URL}
            className="mt-6 inline-block text-[14px] font-semibold text-terra transition-colors hover:text-terra-deep"
          >
            or try the demo first →
          </a>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-ink text-white">
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
