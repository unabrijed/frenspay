import { PhoneMockup } from '@/components/PhoneMockup';
import { Pill } from '@/components/Pill';
import { QuoteWidget } from '@/components/QuoteWidget';
import { Reveal } from '@/components/Reveal';
import { Waitlist } from '@/components/Waitlist';

const DEMO_URL = '#'; // TODO(bridge): deployed web-app URL

const h2 = 'text-[clamp(1.7rem,3vw,2.4rem)] font-extrabold leading-[1.1] tracking-[-0.02em]';

export default function Page() {
  return (
    <main id="top">
      <Hero />
      <Moments />
      <Quote />
      <Comparison />
      <FList />
      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <section className="p-2 sm:p-4">
      <div className="grain relative overflow-hidden rounded-[28px] bg-[linear-gradient(160deg,#c84b34_0%,#a6341f_55%,#7e2513_100%)]">
        <nav className="relative flex items-center justify-between px-6 pt-6 sm:px-10">
          <a href="#top" className="text-[24px] font-extrabold tracking-[-0.02em] text-white">
            fpay
          </a>
          <div className="flex items-center gap-5">
            <a href={DEMO_URL} className="hidden text-[15px] font-semibold text-white/85 transition-colors hover:text-white sm:block">
              Try the demo
            </a>
            <Pill href="#flist" variant="white">
              Get early access
            </Pill>
          </div>
        </nav>

        <div className="relative mx-auto grid max-w-[1180px] items-end gap-12 px-6 pt-14 sm:px-10 lg:grid-cols-12 lg:pt-20">
          <div className="pb-4 lg:col-span-7 lg:pb-24">
            <h1 className="hero-rise text-[clamp(2.4rem,5vw,3.6rem)] font-extrabold leading-[1.06] tracking-[-0.03em] text-white">
              One balance in dollars. Spend in rupees, instantly.
            </h1>
            <p className="hero-rise mt-5 max-w-md text-lg leading-relaxed text-peach/85 [animation-delay:120ms]">
              Scan the same QR as everyone else — the chai stall, the auto stand, the train counter. fpay pays the
              merchant in rupees the second you tap.
            </p>
            <div className="hero-rise mt-9 flex flex-wrap items-center gap-6 [animation-delay:240ms]">
              <Pill href="#flist" variant="ink">
                Get early access
              </Pill>
              <a href={DEMO_URL} className="text-[15px] font-semibold text-white/85 transition-colors hover:text-white">
                Try the demo →
              </a>
            </div>
          </div>

          <div className="hero-rise relative mx-auto -mb-12 lg:col-span-5 lg:-mb-20 [animation-delay:160ms]">
            <PhoneMockup />
          </div>
        </div>
      </div>
    </section>
  );
}

function Moments() {
  return (
    <section className="px-6 py-24 sm:py-28">
      <Reveal>
        <div className="mx-auto grid max-w-[1180px] gap-5 lg:grid-cols-5">
          <div className="h-full rounded-[28px] bg-surface-low p-8 sm:p-10 lg:col-span-3">
            <h3 className="text-[26px] font-extrabold leading-tight tracking-[-0.01em]">
              Any stall. The same QR everyone scans.
            </h3>
            <p className="mt-3 max-w-md text-muted">
              You see the rate and the fee before you tap — then the merchant has rupees before you&apos;ve pocketed
              your phone.
            </p>
            <div className="mt-10 max-w-[280px] rounded-[16px] bg-white p-4 shadow-tactile">
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] font-semibold">Chai</span>
                <span className="tabular text-[15px] font-semibold">₹40</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[13px] text-muted">≈ $0.48</span>
                <span className="rounded-full bg-teal-soft px-2.5 py-0.5 text-[11px] font-semibold text-teal-on">Settled</span>
              </div>
            </div>
          </div>

          <div className="h-full rounded-[28px] bg-teal-soft p-8 text-teal-on sm:p-10 lg:col-span-2">
            <h3 className="text-[26px] font-extrabold leading-tight tracking-[-0.01em]">Split it by @handle.</h3>
            <p className="mt-3 text-teal-on/80">
              Send or request by name or phone — no account numbers, no screenshots of QR codes. @asha owes you for the
              cab? One tap.
            </p>
            <div className="mt-10 flex w-fit items-center gap-3 rounded-full bg-white/85 py-2 pl-2 pr-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-peach text-[13px] font-semibold text-terra">
                a
              </span>
              <span className="text-[14px] font-semibold">@asha</span>
              <span className="tabular text-[14px] font-semibold text-terra">Request $6.20</span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Quote() {
  return (
    <section id="quote" className="bg-surface-low px-6 py-24 sm:py-28">
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
          <div className="grain bg-[linear-gradient(160deg,#c84b34,#a6341f)] p-8 text-white sm:p-10">
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
