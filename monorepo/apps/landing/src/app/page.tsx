import { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { AppLink } from '@/components/AppLink';
import { CityProvider } from '@/components/CityContext';
import { CityPills } from '@/components/CityPills';
import { Logo, Wordmark } from '@/components/Logo';
import {
  ModuleFigure,
  brokenFinder,
  contrast,
  finder,
  holed,
  locked,
  paired,
  scattered,
  solid,
  spread,
  stepped,
  streaming,
} from '@/components/ModuleFigure';
import { Pill } from '@/components/Pill';
import { QrStage } from '@/components/PixelField';
import { Rail } from '@/components/QrHero';
import { QuoteWidget } from '@/components/QuoteWidget';
import { Reveal } from '@/components/Reveal';
import { Waitlist } from '@/components/Waitlist';

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
        <a href="#top" aria-label="fpay, back to top">
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
            <AppLink className="text-[15px] font-semibold text-terra transition-colors hover:text-terra-deep">
              Run a payment →
            </AppLink>
          </div>
          {/* The rails, not a count. fpay is pre-launch, so any "N countries"
              number would be a claim we would have to walk back. */}
          <p className="animate-blur-fade-up eyebrow mt-7 text-muted [--d:520ms]">
            UPI · PromptPay · Pix · DuitNow
          </p>
          {/* No entrance class here: the pixels assembling ARE the entrance.
              QrStage renders the real, scannable code plus, where WebGL2
              allows, a particle field carrying the trail it sheds. */}
          <div className="mt-12 flex justify-center lg:justify-start">
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
        Tap a city. The payment above and the quote below follow.
      </p>
    </Section>
  );
}

/* Three beats, and they are the actual sequence: one balance goes in, a local
   code is scanned, local money comes out. This section used to be four features
   numbered 01-04 as though they were steps, while the hero rail told a
   different four. The flow is told once now, here, where there is room.

   The figures are the same atom the hero draws with. The block is one balance;
   the finder is literally the mark a scanner orients against; the streaming
   edge is the code's own release at a fraction of the amplitude. */
const STEPS = [
  {
    title: 'Top up once, in dollars',
    line: 'One balance. Not a wallet per country, not a card per currency.',
    cell: solid,
  },
  {
    title: 'Scan whatever is on the counter',
    line: 'UPI, PromptPay, Pix, DuitNow. The same code everyone else in the queue is scanning.',
    cell: finder,
  },
  {
    title: 'They are paid in their own money',
    line: 'At the rate you saw, which stopped moving before you tapped. They never learn you paid in dollars.',
    cell: streaming(7, 7),
  },
] as const;

function HowItWorks() {
  return (
    <Section id="how" n="02" label="How it works" title="Dollars in. Local money out.">
      <ol className="border-t border-hair">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="stag flex items-start gap-6 border-b border-hair py-8 sm:gap-8"
            style={{ '--i': i } as CSSProperties}
          >
            <ModuleFigure cols={7} rows={7} m={9} cell={s.cell} className="mt-1 shrink-0 text-terra" />
            <div className="min-w-0">
              <h3 className={h3}>{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.line}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* Not a step, so not in the list. Sending to a person is a different
          motion from paying a counter, and numbering it as the fourth beat of
          "dollars in, local money out" was what made this section incoherent. */}
      <div className="stag mt-10 flex items-start gap-6 sm:gap-8" style={{ '--i': 3 } as CSSProperties}>
        <ModuleFigure cols={7} rows={7} m={9} cell={paired(7)} className="mt-1 shrink-0 text-teal" />
        <div className="min-w-0">
          <p className="eyebrow text-muted">Also</p>
          <h3 className={`${h3} mt-1.5`}>Split it by @handle</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Send or request by name or phone. No account numbers, no screenshots of QR codes.
          </p>
        </div>
      </div>
    </Section>
  );
}

function Rates() {
  return (
    <Section id="rates" n="03" label="Rates" title="Type a price. See what leaves your balance.">
      <p className="max-w-lg text-[15px] text-muted">
        The rate, the fee, and the arrival time, all before you confirm. The rate holds still while you decide.
      </p>
      <div className="mt-9">
        <QuoteWidget />
      </div>
    </Section>
  );
}

/* Four contrasts, each a row. The pairs used to live in two independent lists
   inside a 2-column grid: index-aligned in the source, but the moment a left
   item wrapped to two lines the pair it belonged to drifted out of line, and
   the pairing is the entire argument. One row per pair fixes that by
   construction, at any width.

   The figure is the hinge of its own row: the broken state, a gutter, then the
   same atom resolved. */
/* Every half is 7x7, so the finder pattern fits its row exactly and all four
   figures share one footprint. A narrower grid clipped the finder to its left
   edge, which reads as a bug rather than as the mark it is. */
const HALF = 7;
const GAP = 2;
const FIG_COLS = HALF * 2 + GAP;

const COMPARE = [
  {
    left: '3 to 5% in foreign fees, found on the statement',
    right: 'The fee is on the quote, before you tap',
    fig: contrast(scattered(HALF, HALF), solid, HALF, GAP),
  },
  {
    left: 'A rate that settles days later',
    right: 'A rate that stops moving when you pay',
    fig: contrast(stepped(HALF, HALF), locked(HALF), HALF, GAP),
  },
  {
    left: '"Card not accepted" at the stall',
    right: 'The same code everyone else scans',
    fig: contrast(brokenFinder(), finder, HALF, GAP),
  },
  {
    left: 'Declines you sort out yourself',
    right: 'Reroutes or refunds, automatically',
    fig: contrast(holed(HALF, HALF), paired(HALF), HALF, GAP),
  },
] as const;

/* The page's one tonal inversion, and the only section that gets extra height. */
function Comparison() {
  return (
    <section className="border-t border-hair bg-ink px-6 py-24 text-white sm:px-10 lg:py-28">
      <Reveal className="mx-auto max-w-[1180px]" variant="wipe">
        <p className="eyebrow text-white/45">
          04 <span className="text-white/25">/</span> The difference
        </p>
        <h2 className={`${h2} mt-4 max-w-xl`}>
          <Words>What your card does. What fpay does.</Words>
        </h2>

        <div className="mt-14 border-t border-white/15">
          {COMPARE.map((c, i) => (
            <div
              key={c.right}
              className="stag grid items-center gap-x-8 gap-y-4 border-b border-white/15 py-7 md:grid-cols-[1fr_auto_1fr] md:gap-x-12"
              style={{ '--i': i } as CSSProperties}
            >
              <p className="text-[15px] text-white/45 sm:text-[16px]">{c.left}</p>
              <ModuleFigure
                cols={FIG_COLS}
                rows={HALF}
                m={7}
                cell={c.fig}
                className="order-first text-white/35 md:order-none"
              />
              <p className="text-[15px] font-semibold sm:text-[17px]">{c.right}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

const SECURITY = [
  'Only you can move your money. Not fpay, not anyone else.',
  'Every payment is approved on your device before any money moves.',
  'The price on screen when you tap Pay is the price that settles. Rate and fee are itemized first.',
  'Lose your phone, lose nothing. Sign in with your email on any device. Your balance is already there.',
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
    <Section id="flist" n="06" label="The f list" title="First we board the f list. Then we board the plane.">
      {/* One person at the centre, and how far one invite reaches. Rings decay
          on the same RAMP the code itself runs on, so the referral loop is
          drawn with the page's atom rather than described only in prose. */}
      <ModuleFigure cols={9} rows={9} m={9} cell={spread} className="mb-9 text-terra" />
      <p className="max-w-md text-muted">
        The f list is the early-access queue. fpay is pre-launch. Leave your email and you&apos;re first through the
        gate.
      </p>
      <div className="mt-9">
        <Waitlist />
      </div>
      <AppLink className="mt-6 inline-block text-[14px] font-semibold text-terra transition-colors hover:text-terra-deep">
        or try the demo first →
      </AppLink>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="bg-ink text-white">
      <div className="mx-auto max-w-[1180px] px-6 pt-14 sm:px-10">
        <div className="flex flex-col justify-between gap-6 border-b border-white/10 pb-10 sm:flex-row sm:items-center">
          <Logo markClass="h-7" wordClass="text-[20px] text-white" />
          <nav className="flex gap-7 text-[14px] font-semibold text-white/70">
            <AppLink className="transition-colors hover:text-white">Try the demo</AppLink>
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
