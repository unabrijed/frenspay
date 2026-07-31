import { CityProvider } from '@/components/CityContext';
import { CityPills } from '@/components/CityPills';
import { Pill } from '@/components/Pill';
import { QrHero } from '@/components/QrHero';
import { QuoteWidget } from '@/components/QuoteWidget';
import { Reveal } from '@/components/Reveal';
import { Waitlist } from '@/components/Waitlist';

const DEMO_URL = '#'; // TODO(bridge): deployed web-app URL

const h2 = 'text-[clamp(1.7rem,3vw,2.4rem)] font-extrabold leading-[1.1] tracking-[-0.02em]';

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
    <header className="mx-auto flex max-w-[1180px] items-center justify-between px-6 pt-6 sm:px-10">
      <a href="#top" className="text-[24px] font-extrabold tracking-[-0.02em] text-terra">
        fpay
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
    </header>
  );
}

function Hero() {
  return (
    <section className="px-6 pb-16 pt-14 sm:px-10 lg:pb-20 lg:pt-20">
      <div className="mx-auto grid max-w-[1180px] items-center gap-14 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h1 className="hero-rise text-[clamp(2.4rem,5vw,3.6rem)] font-extrabold leading-[1.06] tracking-[-0.03em]">
            Your dollars speak local.
          </h1>
          <p className="hero-rise mt-5 max-w-md text-lg leading-relaxed text-muted [animation-delay:120ms]">
            Hold one USD balance. Scan the QR every shop already uses — the merchant is paid instantly in their own
            currency, at a rate you locked first.
          </p>
          <div className="hero-rise mt-9 flex flex-wrap items-center gap-6 [animation-delay:240ms]">
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
        </div>
        <div className="hero-rise lg:col-span-7 [animation-delay:160ms]">
          <QrHero />
        </div>
      </div>
    </section>
  );
}

function Countries() {
  return (
    <section id="countries" className="px-6 pb-24 pt-4 sm:pb-28">
      <Reveal className="mx-auto max-w-[1180px] text-center">
        <CityPills />
        <p className="mx-auto mt-5 max-w-md text-[15px] text-muted">
          Works wherever QR scan-and-pay does. Tap a city — the payment above and the quote below follow.
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
      <Reveal className="mx-auto max-w-[1180px]">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow text-terra">How it works</p>
          <h2 className={`${h2} mt-3`}>Dollars in. Local money out.</h2>
        </div>
        <div className="relative mt-12 grid gap-5 md:grid-cols-3">
          <span
            aria-hidden
            className="absolute left-[14%] right-[14%] top-[60px] z-[1] hidden border-t-2 border-dashed border-terra/20 md:block"
          />
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-[28px] bg-surface-low p-8">
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
            <p className="mt-2 max-w-md text-teal-on/80">
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

function Rates() {
  return (
    <section id="rates" className="bg-surface-low px-6 py-24 sm:py-28">
      <Reveal className="mx-auto max-w-[1180px]">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className={h2}>Type a price. See exactly what you&apos;d pay.</h2>
          <p className="mx-auto mt-4 max-w-lg text-muted">
            Every payment shows the rate, the fee, and the arrival time before you confirm — and the rate holds still
            while you decide.
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
      <Reveal className="mx-auto max-w-[1180px]">
        <div className="grid overflow-hidden rounded-[28px] md:grid-cols-2">
          <div className="bg-ink p-8 text-white sm:p-10">
            <p className="eyebrow text-white/50">Your bank card abroad</p>
            <ul className="mt-6 divide-y divide-white/10">
              {COMPARE.map(([left]) => (
                <li key={left} className="py-4 text-[15px] text-white/70 sm:text-[16px]">
                  {left}
                </li>
              ))}
            </ul>
          </div>
          <div className="grain brand-gradient p-8 text-white sm:p-10">
            <p className="eyebrow text-peach">fpay</p>
            <ul className="mt-6 divide-y divide-white/20">
              {COMPARE.map(([, right]) => (
                <li key={right} className="py-4 text-[15px] font-semibold sm:text-[16px]">
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
      <Reveal className="mx-auto max-w-2xl">
        <p className="eyebrow text-terra">Security</p>
        <h2 className={`${h2} mt-3`}>Money that behaves.</h2>
        <ul className="mt-8 divide-y divide-hair border-t border-hair">
          {SECURITY.map((line) => (
            <li key={line} className="py-4 text-[16px] text-muted">
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
      <Reveal className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <h2 className={h2}>First we board the f list. Then we board the plane.</h2>
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
          <span className="text-[20px] font-extrabold tracking-[-0.02em] text-terra-ctr">fpay</span>
          <nav className="flex gap-7 text-[14px] font-semibold text-white/70">
            <a href={DEMO_URL} className="transition-colors hover:text-white">
              Try the demo
            </a>
            <a href="#flist" className="transition-colors hover:text-white">
              the f list
            </a>
          </nav>
        </div>
        <p className="pt-8 text-[13px] text-white/50">© 2026 fpay · Made for people in line at a street stall.</p>
      </div>
      <div aria-hidden className="overflow-hidden">
        <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
          <span className="block translate-y-[22%] text-[clamp(6rem,19vw,15rem)] font-extrabold leading-none tracking-[-0.04em] text-terra-ctr/90">
            fpay
          </span>
        </div>
      </div>
    </footer>
  );
}
