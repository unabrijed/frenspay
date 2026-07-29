import { PhoneMockup } from '@/components/PhoneMockup';
import { Pill } from '@/components/Pill';
import { QuoteWidget } from '@/components/QuoteWidget';
import { Reveal } from '@/components/Reveal';
import { Waitlist } from '@/components/Waitlist';

const DEMO_URL = '#'; // TODO(bridge): deployed web-app URL

const h2 = 'text-[clamp(1.9rem,4vw,3rem)] font-bold leading-[1.1] tracking-[-0.02em]';

export default function Page() {
  return (
    <main id="top">
      <Hero />
      <Marquee />
      <Statement />
      <Personas />
      <Quote />
      <HowItWorks />
      <Features />
      <Comparison />
      <FList />
      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <section className="p-2 sm:p-4">
      <div className="relative overflow-hidden rounded-[32px] bg-[linear-gradient(160deg,#c84b34_0%,#a6341f_55%,#7e2513_100%)]">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(255,218,211,0.25),transparent)]"
        />
        <nav className="relative flex items-center justify-between px-6 pt-6 sm:px-10">
          <a href="#top" className="text-[26px] font-bold tracking-[-0.02em] text-white">
            fpay
          </a>
          <div className="flex items-center gap-5">
            <a href={DEMO_URL} className="hidden text-[15px] font-semibold text-white/85 transition-colors hover:text-white sm:block">
              Try the demo
            </a>
            <Pill href="#flist" variant="white">
              Join the f list
            </Pill>
          </div>
        </nav>

        <div className="relative mx-auto grid max-w-[1180px] items-center gap-12 px-6 pb-16 pt-12 sm:px-10 lg:grid-cols-12 lg:pb-24 lg:pt-20">
          <div className="lg:col-span-7">
            <p className="eyebrow hero-rise text-peach">Now boarding · the f list</p>
            <h1 className="hero-rise mt-4 text-[clamp(2.6rem,6vw,4.4rem)] font-bold leading-[1.04] tracking-[-0.02em] text-white [animation-delay:80ms]">
              Pay like a local, anywhere you travel.
            </h1>
            <p className="hero-rise mt-5 max-w-md text-lg text-peach/90 [animation-delay:160ms]">
              One balance in dollars. Spend in rupees, instantly.
            </p>
            <div className="hero-rise mt-9 flex flex-wrap items-center gap-6 [animation-delay:240ms]">
              <Pill href="#flist" variant="ink">
                Join the f list
              </Pill>
              <a href={DEMO_URL} className="text-[15px] font-semibold text-white/85 transition-colors hover:text-white">
                Try the demo →
              </a>
            </div>
          </div>

          <div className="relative mx-auto hero-rise lg:col-span-5 [animation-delay:240ms]">
            <div className="floaty">
              <PhoneMockup />
            </div>
            <div className="floaty-fast absolute -left-8 top-20 hidden items-center gap-2 rounded-full bg-white px-4 py-2.5 shadow-lift sm:flex">
              <span className="h-2 w-2 rounded-full bg-terra" />
              <span className="tabular text-[13px] font-semibold">Rate locked · 0:41</span>
            </div>
            <div className="floaty-slow absolute -right-4 bottom-24 hidden items-center gap-2 rounded-full bg-white px-4 py-2.5 shadow-lift sm:flex">
              <span className="h-2 w-2 rounded-full bg-teal" />
              <span className="tabular text-[13px] font-semibold">₹240 paid · instant</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STOPS = [
  'Chai stall',
  'Auto rickshaw',
  'Street food',
  'Train tickets',
  'Kirana store',
  'Split the bill',
  'Hotel checkout',
  'Museum entry',
];

function Marquee() {
  return (
    <div className="overflow-hidden border-b border-hair py-4">
      <div className="marquee flex w-max">
        {[0, 1].map((i) => (
          <div key={i} aria-hidden={i === 1} className="flex shrink-0 items-center">
            {STOPS.map((s) => (
              <span key={s} className="eyebrow flex items-center whitespace-nowrap text-muted/70">
                <span className="px-5">{s}</span>
                <span className="text-terra/50">·</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Statement() {
  return (
    <section className="px-6 py-24 sm:py-32">
      <Reveal className="mx-auto max-w-3xl text-center">
        <h2 className={h2}>
          Your card charges you to be foreign. <span className="text-terra">Your balance shouldn&apos;t.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted">
          fpay holds one balance in dollars and spends it like it grew up in India — scan any QR at any stall, and the
          merchant is paid in rupees before you&apos;ve pocketed your phone.
        </p>
      </Reveal>
    </section>
  );
}

function Personas() {
  return (
    <section className="px-6 pb-24">
      <div className="mx-auto grid max-w-[1180px] gap-5 lg:grid-cols-5">
        <Reveal className="lg:col-span-3">
          <div className="h-full rounded-[24px] bg-surface-low p-8 ring-1 ring-hair sm:p-10">
            <p className="eyebrow text-terra">For the trip</p>
            <h3 className="mt-3 text-[26px] font-bold leading-tight tracking-[-0.01em]">
              Land with dollars. Leave no trace of fees.
            </h3>
            <p className="mt-3 max-w-md text-muted">
              Scan the QR like everyone else in line. You see the rate, the fee, and when it lands — then the merchant
              gets rupees, instantly.
            </p>
            <div className="mt-8 max-w-[280px] rounded-[16px] bg-white p-4 shadow-tactile ring-1 ring-hair">
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] font-medium">Chai</span>
                <span className="tabular text-[15px] font-bold">₹40</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[13px] text-muted">≈ $0.48</span>
                <span className="rounded-full bg-teal-soft px-2.5 py-0.5 text-[11px] font-bold text-teal-on">Settled</span>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={100} className="lg:col-span-2">
          <div className="h-full rounded-[24px] bg-teal-soft p-8 text-teal-on sm:p-10">
            <p className="eyebrow text-teal">For the group</p>
            <h3 className="mt-3 text-[26px] font-bold leading-tight tracking-[-0.01em]">
              Split it by @handle. Settle it in seconds.
            </h3>
            <p className="mt-3 text-teal-on/80">
              Send or request with a name, not a number. @asha owes you for the cab? One tap, done.
            </p>
            <div className="mt-8 flex w-fit items-center gap-3 rounded-full bg-white/85 py-2 pl-2 pr-4 shadow-tactile">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-peach text-[13px] font-bold text-terra">
                a
              </span>
              <span className="text-[14px] font-semibold">@asha</span>
              <span className="tabular text-[14px] font-semibold text-terra">Request $6.20</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Quote() {
  return (
    <section id="quote" className="bg-surface-low px-6 py-24 sm:py-28">
      <div className="mx-auto max-w-[1180px]">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="eyebrow text-terra">The quote</p>
          <h2 className={`${h2} mt-3`}>Know the damage. Before the damage.</h2>
          <p className="mx-auto mt-5 max-w-lg text-muted">
            Every payment shows the rate, the fee, and the arrival time up front — and the rate holds still for 45
            seconds while you decide.
          </p>
        </Reveal>
        <Reveal delay={120} className="mt-12">
          <QuoteWidget />
        </Reveal>
      </div>
    </section>
  );
}

const STEPS = [
  ['01', 'Scan the QR.', 'Any stall, any shop. The same code everyone else scans.'],
  ['02', 'Check the quote.', 'Rate, fee, arrival time. Locked for 45 seconds while you look.'],
  ['03', "It's paid.", 'The merchant has rupees. Your balance shows the dollars. Done.'],
] as const;

function HowItWorks() {
  return (
    <section className="px-6 py-24 sm:py-28">
      <div className="mx-auto max-w-[1180px]">
        <Reveal>
          <p className="eyebrow text-terra">How it works</p>
        </Reveal>
        <div className="mt-6 border-t border-hair">
          {STEPS.map(([n, head, body], i) => (
            <Reveal key={n} delay={i * 100}>
              <div className="grid items-baseline gap-2 border-b border-hair py-8 sm:grid-cols-12 sm:gap-4 sm:py-10">
                <span className="tabular text-[44px] font-extrabold leading-none text-transparent [-webkit-text-stroke:1.5px_#a6341f] sm:col-span-2 sm:text-[60px]">
                  {n}
                </span>
                <h3 className="mt-2 text-[24px] font-bold tracking-[-0.01em] sm:col-span-4 sm:mt-0 sm:text-[28px]">{head}</h3>
                <p className="text-muted sm:col-span-6 sm:text-[17px]">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function MiniRing() {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r={r} fill="none" stroke="#ffdad3" strokeWidth="4" />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke="#a6341f"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - 37 / 45)}
        transform="rotate(-90 24 24)"
      />
      <text x="24" y="28" textAnchor="middle" fontSize="12" fontWeight="700" fill="#1e1b19" style={{ fontVariantNumeric: 'tabular-nums' }}>
        37
      </text>
    </svg>
  );
}

function FeatureCard({
  wide,
  delay,
  title,
  body,
  children,
}: {
  wide?: boolean;
  delay?: number;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <Reveal delay={delay} className={wide ? 'md:col-span-2' : ''}>
      <div className="flex h-full flex-col justify-between gap-6 rounded-[20px] bg-white p-7 shadow-tactile ring-1 ring-hair sm:p-8">
        <div>
          <h3 className="text-[22px] font-bold tracking-[-0.01em]">{title}</h3>
          <p className={`mt-2.5 text-muted ${wide ? 'max-w-xl' : ''}`}>{body}</p>
        </div>
        {children}
      </div>
    </Reveal>
  );
}

function Features() {
  return (
    <section className="px-6 pb-24">
      <div className="mx-auto grid max-w-[1180px] gap-5 md:grid-cols-2">
        <FeatureCard
          wide
          title="You're always made whole."
          body="If a payment ever fails mid-flight, fpay reroutes it silently. If it can't, you're refunded automatically. You never chase your own money."
        >
          <span className="tabular w-fit rounded-full bg-surface-ctr px-4 py-2 text-[13px] font-semibold">
            Rerouted · 0.8s · Paid ✓
          </span>
        </FeatureCard>

        <FeatureCard
          delay={80}
          title="45 seconds of certainty."
          body="The rate you see is the rate you pay. It holds while you decide."
        >
          <MiniRing />
        </FeatureCard>

        <FeatureCard
          delay={160}
          title="No fee surprises."
          body="Rate + fee + arrival time, printed on every quote. Before you confirm, not after."
        >
          <div className="tabular w-fit rounded-[14px] bg-surface-ctr px-4 py-3 text-[13px] font-medium text-muted">
            ₹83.20 / $1 · fee $0.10 · instant
          </div>
        </FeatureCard>

        <FeatureCard
          delay={240}
          title="Money between friends."
          body="Send and request by @handle or phone. No account numbers, no screenshots of QR codes."
        >
          <div className="flex flex-wrap gap-2">
            {['@asha', '@rohan', '@you'].map((h) => (
              <span key={h} className="rounded-full bg-peach px-3.5 py-1.5 text-[13px] font-semibold text-terra-deep">
                {h}
              </span>
            ))}
          </div>
        </FeatureCard>
      </div>
    </section>
  );
}

const COMPARE = [
  ['3–5% foreign fees, discovered later', 'The fee is on the quote'],
  ['A rate that settles days later', 'A rate locked for 45 seconds'],
  ['“Card not accepted” at the stall', 'The same QR everyone scans'],
  ['Declines you sort out yourself', 'Reroutes or refunds, automatically'],
] as const;

function Comparison() {
  return (
    <section className="px-6 pb-24">
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
          <div className="bg-[linear-gradient(160deg,#c84b34,#a6341f)] p-8 text-white sm:p-10">
            <p className="eyebrow text-peach">fpay</p>
            <ul className="mt-6 divide-y divide-white/20">
              {COMPARE.map(([, right]) => (
                <li key={right} className="py-4 text-[15px] font-medium sm:text-[16px]">
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

function FList() {
  return (
    <section id="flist" className="px-6 py-24 sm:py-32">
      <Reveal className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <p className="eyebrow text-terra">Pre-launch</p>
        <h2 className={`${h2} mt-3`}>First we board the f list. Then we board the plane.</h2>
        <p className="mt-5 max-w-md text-muted">
          fpay is pre-launch. Leave your email and you&apos;re first through the gate.
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
    <footer className="mt-4 rounded-t-[32px] bg-ink text-white">
      <div className="mx-auto max-w-[1180px] px-6 pt-14 sm:px-10">
        <div className="flex flex-col justify-between gap-6 border-b border-white/10 pb-10 sm:flex-row sm:items-center">
          <span className="text-[20px] font-bold tracking-[-0.02em] text-terra-ctr">fpay</span>
          <nav className="flex gap-7 text-[14px] font-medium text-white/70">
            <a href={DEMO_URL} className="transition-colors hover:text-white">
              Try the demo
            </a>
            <a href="#flist" className="transition-colors hover:text-white">
              the f list
            </a>
          </nav>
        </div>
        <p className="pt-8 text-[13px] text-white/50">© 2026 fpay · Made for people in line at a chai stall.</p>
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
