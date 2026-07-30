// Pure-CSS mock of the real fpay home screen (apps/web (tabs)/home): top bar,
// "Active in India" pill, global balance, Scan/Send/Request/Add, USD card, activity.
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const glyphs = {
  scan: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />,
  send: <path d="M7 17L17 7M9 7h8v8" />,
  request: <path d="M17 7L7 17M15 17H7V9" />,
  add: <path d="M12 5v14M5 12h14" />,
};

function Icon({ d, size = 20, className = '' }: { d: keyof typeof glyphs; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
      {glyphs[d]}
    </svg>
  );
}

function Action({ label, d }: { label: string; d: keyof typeof glyphs }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-peach text-terra shadow-tactile">
        <Icon d={d} />
      </span>
      <span className="text-[11px] font-semibold">{label}</span>
    </div>
  );
}

function Row({ initial, name, sub, amount, positive }: { initial: string; name: string; sub: string; amount: string; positive?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-outline-var/60 bg-white px-3.5 py-3 shadow-tactile">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-ctr text-[12px] font-semibold text-muted">
        {initial}
      </span>
      <span className="flex-1">
        <span className="block text-[13px] font-semibold leading-tight">{name}</span>
        <span className="block text-[11px] text-muted">{sub}</span>
      </span>
      <span className={`tabular text-[13px] font-semibold ${positive ? 'text-teal' : ''}`}>{amount}</span>
    </div>
  );
}

export function PhoneMockup() {
  return (
    <div className="w-[300px] rounded-[26px] bg-canvas px-4 pb-5 pt-4 shadow-phone ring-1 ring-white/50 sm:w-[340px]">
      {/* top bar */}
      <div className="flex items-center justify-between px-0.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-ctr text-[13px] font-semibold text-muted">A</span>
        <span className="text-[18px] font-extrabold tracking-[-0.02em] text-terra">fpay</span>
        <span className="relative flex h-8 w-8 items-center justify-center text-terra">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden {...stroke}>
            <path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M10.5 20a1.7 1.7 0 0 0 3 0" />
          </svg>
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full border border-canvas bg-terra" />
        </span>
      </div>

      {/* global balance */}
      <div className="mt-3 flex flex-col items-center pb-4 pt-2">
        <span className="flex items-center gap-1.5 rounded-full bg-surface-ctr px-3 py-1.5 text-teal">
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden {...stroke}>
            <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <span className="eyebrow text-muted">Active in India</span>
        </span>
        <span className="mt-3.5 text-[12px] text-muted">Global balance</span>
        <span className="tabular mt-0.5 text-[40px] font-extrabold leading-[1.1] tracking-[-0.02em]">
          <span className="mr-0.5 text-[24px] font-semibold text-muted/70">$</span>1,284.60
        </span>
      </div>

      {/* actions */}
      <div className="flex justify-between px-2">
        <Action label="Scan" d="scan" />
        <Action label="Send" d="send" />
        <Action label="Request" d="request" />
        <Action label="Add" d="add" />
      </div>

      {/* USD wallet card */}
      <div className="mt-4 rounded-[18px] border border-outline-var/60 bg-white p-4 shadow-tactile">
        <div className="flex items-start justify-between">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-soft text-teal">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden {...stroke}>
              <path d="M20 7H5a2 2 0 0 1 0-4h13v4M20 7a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5M16.5 14h.01" />
            </svg>
          </span>
          <span className="rounded-lg bg-teal-soft px-2 py-1 text-[10px] font-semibold tracking-wide text-teal">PRIMARY</span>
        </div>
        <div className="mt-3">
          <span className="block text-[12px] text-muted">US Dollars</span>
          <span className="tabular block text-[19px] font-semibold">$1,284.60</span>
        </div>
      </div>

      {/* recent activity */}
      <div className="mt-4">
        <div className="flex items-center justify-between px-0.5 pb-2">
          <span className="text-[14px] font-semibold">Recent activity</span>
          <span className="text-[11px] font-semibold text-terra">See all</span>
        </div>
        <div className="flex flex-col gap-2">
          <Row initial="C" name="Chai Point" sub="Settled · just now" amount="− ₹40" />
          <Row initial="A" name="@asha" sub="Received" amount="+ $5.00" positive />
        </div>
      </div>
    </div>
  );
}
