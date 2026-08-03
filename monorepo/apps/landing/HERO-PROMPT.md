# fpay landing — hero-only build prompt

Build spec for a complete redo of `apps/landing` as a single hero section. Written to be
handed to a generator (or a person) whole.

---

**Build a single-page React + TypeScript landing page for a payments app called "fpay" (full name "FrensPay") using Next.js 15 App Router, Tailwind CSS v4, and hand-authored inline SVG. The page is one full-viewport hero section, centered, with a live one-line FX quote and an email waitlist form that carries a referral code. There is nothing below the fold — no feature sections, no footer.**

## Stack — match this exactly, it is an existing workspace

- **Next.js 15 App Router with `output: 'export'`** (fully static, no server). React 19. Not Vite, no `index.html`.
- **Tailwind CSS v4, CSS-first.** There is NO `tailwind.config.ts` and one must not be created — the theme lives in an `@theme` block inside `src/app/globals.css`. PostCSS config is one line: `export default { plugins: { '@tailwindcss/postcss': {} } };`
- **Fonts via `next/font/google` in `src/app/layout.tsx`** — no `<link>` tags, no `@import`, no Google Fonts URL:
  ```ts
  import { Hanken_Grotesk } from 'next/font/google';
  const hanken = Hanken_Grotesk({ subsets: ['latin'], weight: ['400','600','800'], variable: '--font-hanken', display: 'swap' });
  ```
  Applied as `<html lang="en" className={hanken.variable}>`. **One family for the entire page.** No display font, no typewriter font, **no serif anywhere** — a second family is the single fastest way to make this read as generated.
- **No icon library.** `lucide-react`, heroicons, react-icons are all forbidden — the app's five dependencies are `next`, `react`, `react-dom`, `@vercel/analytics`, `@vercel/speed-insights`, and that list does not grow. Every glyph is a hand-authored inline SVG at `strokeWidth="2.5"`.
- **Path alias `@/` → `src/`** (already in `tsconfig.json`).
- Dev: `yarn dev:landing` from the monorepo root (Yarn 1 workspaces; port 3003). Deployed static to `frenspay.xyz`.
- Page title: `fpay: instant global payments from one dollar balance`. OG description: `Global dollars. Local scan. Paid instantly, at a rate you locked first.`

## Theme — `@theme` block in `src/app/globals.css`

```css
@theme {
  --font-sans: var(--font-hanken), ui-sans-serif, system-ui, sans-serif;

  --color-canvas:      #fff8f4;  /* warm cream page ground */
  --color-ink:         #1e1b19;
  --color-muted:       #58413d;
  --color-hair:        #e8e1dd;  /* every 1px rule on the page */
  --color-terra:       #a6341f;  /* the brand colour */
  --color-terra-deep:  #aa3621;
  --color-terra-ctr:   #c84b34;
  --color-peach:       #ffdad3;
  --color-teal:        #416467;  /* the "confirmed" signal, and only that */
  --color-teal-soft:   #c1e7ea;
  --color-teal-on:     #294c4f;

  --ease-soft: cubic-bezier(0.16, 1, 0.3, 1);
  --shadow-tactile: 0 4px 20px rgba(74,70,67,0.05), inset 0 1px 0 rgba(255,255,255,1);
  --shadow-lift:    0 8px 30px rgba(140,113,108,0.15);
  --shadow-btn:     0 4px 14px rgba(166,52,31,0.2), inset 0 1px 0 rgba(255,255,255,0.2);
  --shadow-pressed: 0 1px 3px rgba(74,70,67,0.16), inset 0 1px 0 rgba(255,255,255,0.18);
}
```

Two hand-written utilities in the same file:

- `.eyebrow` — `font-size:11px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase;`. **The one label recipe.** Every small label on the page uses it unmodified; never vary it.
- `.tabular` — `font-variant-numeric: tabular-nums;`. Every number on the page uses it, so figures don't jitter as they change.

## Layout — one section, one viewport

`<section className="relative flex min-h-svh flex-col overflow-hidden bg-canvas text-ink">`

**Background (z-0, `pointer-events-none`, `aria-hidden`):** no video, no image, no canvas, nothing that loops. Two static layers only:

1. A soft radial wash anchored bottom-center: `background: radial-gradient(120% 70% at 50% 108%, #ffdad3 0%, rgba(255,216,211,0) 62%)`.
2. A grain overlay on top of it at `opacity:0.05; mix-blend-mode:overlay`, using an inline SVG data-URI `feTurbulence` (`type="fractalNoise" baseFrequency="0.8" numOctaves="3"`).

**Top bar:** `flex items-center justify-between px-6 py-5 sm:px-10`, not sticky (there is nowhere to scroll to).

- Left: the logo lockup — `/logo-mark.svg` at `h-8` beside the wordmark `fpay` at `text-[24px] font-extrabold tracking-[-0.02em] text-ink`. Live text, never an image.
- Right: one text link, `Try the demo →`, `text-[15px] font-semibold text-terra transition-colors hover:text-terra-deep`. **No nav links** — a nav pointing at sections that no longer exist is the most common way this redo goes wrong. No Login button; there is no account to log into yet.

**Centered content column:** `relative z-10 mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center px-6 pb-16 text-center`.

### 1. Rails eyebrow

`<p className="eyebrow text-muted">UPI · PromptPay · Pix · DuitNow</p>`

These are the rails, deliberately not a country count — fpay is pre-launch and any "N countries" number is a claim that would have to be walked back.

### 2. H1

`mt-5 text-[clamp(2.8rem,7vw,4.75rem)] font-extrabold leading-[0.98] tracking-[-0.035em]`

Text: `Global dollars. Local scan.`

### 3. Subheadline

`mt-5 max-w-[520px] text-lg leading-relaxed text-muted`

Text: `One balance in dollars. Scan the code that's already on the counter. They're paid instantly, in their own money.`

### 4. The single-line quote

The page's one piece of proof, and it is exactly one line. A row bounded by a hairline top and bottom (`border-y border-hair`), `mt-10 py-4 w-full max-w-[520px] flex items-center justify-center gap-3 text-[17px]`:

```
$20  →  ₹1,682  ·  UPI  ·  rate locked
```

- `$20` and `₹1,682` in `.tabular font-extrabold`; the arrow, the rail and `rate locked` in `text-muted`, with `rate locked` prefixed by a 6px `bg-terra` dot.
- Driven by a client-side city list — plausible demo rates, not live:
  ```ts
  const CITIES = [
    { city: 'Bangkok',      code: 'THB', symbol: '฿',  rate: 36.15, rail: 'PromptPay', locale: 'en-US', sample: 20 },
    { city: 'Mumbai',       code: 'INR', symbol: '₹',  rate: 84.1,  rail: 'UPI',       locale: 'en-IN', sample: 20 },
    { city: 'São Paulo',    code: 'BRL', symbol: 'R$', rate: 5.42,  rail: 'Pix',       locale: 'pt-BR', sample: 20 },
    { city: 'Kuala Lumpur', code: 'MYR', symbol: 'RM', rate: 4.68,  rail: 'DuitNow',   locale: 'en-US', sample: 20 },
  ] as const;
  ```
  Local figure = `new Intl.NumberFormat(city.locale, { maximumFractionDigits: 0 }).format(sample * rate)`.
- Under the row, four small city chips (`Bangkok · Mumbai · São Paulo · Kuala Lumpur`) at `text-[13px] font-semibold`; the selected one is `text-ink`, the rest `text-muted/70`. Clicking one swaps the line. The number tweens over ~500ms on `--ease-soft` when the city changes; typing is not possible, this is read-only.
- Caption below, `text-[12px] text-muted/80`: `Demo rates. Live quotes in the app.`

### 5. The join surface

The one raised object on the page, `mt-10 w-full max-w-[520px] rounded-[28px] bg-white p-6 text-left shadow-tactile ring-1 ring-hair`. It holds three states.

**Default:**

- If a referral is present, a line above the form: `<span className="font-semibold text-ink">@asha</span> invited you.` at `text-[15px] text-muted mb-4`.
- Form row: `flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2`.
  - `<input type="email" required placeholder="you@somewhere.com" />` — `h-12 flex-1 rounded-full border border-hair bg-white px-5 text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-terra focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terra`, with an `sr-only` `<label>`.
  - Submit pill — `h-12 rounded-full bg-terra px-6 text-[15px] font-semibold text-white shadow-btn transition-transform hover:bg-terra-deep active:scale-[0.97]`. Label `Join the f list`, `Joining…` while in flight.
- Under the form, `mt-4 text-[13px] text-muted`: `fpay is pre-launch. The f list is the early-access queue — leave your email and you're first through the gate.`

**Joined** (replaces the form in place):

- A teal confirmation pill: `rounded-full bg-teal-soft px-6 py-4 text-[16px] font-semibold text-teal-on` — `You're a fren. Check your email to confirm.`
- Then a hairline `<dl className="mt-6 divide-y divide-hair border-t border-hair">` with three rows, labels in `.eyebrow text-muted`, values in `.tabular text-[18px] font-extrabold`:
  - `Your place` → `#42`
  - `Your invite link` → `frenspay.xyz/?ref=<code>` (protocol stripped, truncated) plus a `Copy` button — `rounded-full border border-hair bg-white px-4 py-1.5 text-[14px] font-semibold text-terra`, flipping to `Copied` for 1.5s, silently no-op if the clipboard is blocked.
  - `Frens joined` → `0` — **shown at zero on purpose**; hiding the counter until someone joins removes the mechanic from view exactly when it still needs explaining.
- Closing line `mt-4 text-[14px] text-muted`: `Every fren who joins on your link moves you up.`

**Confirmed** (arrived from the confirm email with `?v=1`): the surface holds only the teal pill `Email confirmed. You're on the f list.` — offering the form again would just invite a pointless second submit. With `?v=0`: keep the form and add `That confirm link has expired. Join again.` beneath it.

### 6. The real QR

`mt-10`, a genuinely scannable 33×33-module code encoding `https://frenspay.xyz/#flist` at error-correction level H, drawn as SVG rects at a 3px module pitch (≈99px), `fill` = `--color-ink`, on a white square with 4 modules of quiet zone. The matrix is generated at build time by a script and committed as a `readonly number[][]`, never computed in the browser and never fetched from a QR API. Caption under it, `mt-3 text-[13px] text-muted`: `or scan this`.

**It must actually scan** — do not stylize the modules into dots, gradients, or a logo cutout, and do not fade any module inside the quiet zone.

## Referral capture — the part that must be exactly right

A dependency-free module, `src/components/ref.ts`:

```ts
const KEY = 'fpay:ref';
const REF_RE = /^@?[a-z0-9_]{1,20}$/;   // mirrors the server's guard

export function captureRef(): void       // read ?ref= from the URL, validate, persist to localStorage, always overwriting
export function readRef(): string | null // URL first, then localStorage
export const isHandle = (r: string | null): r is string => !!r && r.startsWith('@');
```

- **Last touch wins:** `captureRef()` overwrites, and `readRef()` prefers the URL, so a fresh click beats a stale cache.
- **The credit outlives the URL:** capture runs on mount before anything can navigate away from the query string, so it survives the visitor stripping `?ref=`, bookmarking, or returning a week later.
- Every `localStorage` touch is wrapped in try/catch — blocked storage must never break the form.
- Both calls live in a `useEffect`, never during render: reading the URL or storage during render mismatches the statically exported HTML on hydration.
- `readRef()` is called **again inside the submit handler** rather than reading React state — the value credited must be the value at submit time — and a bare `null` is sent as `undefined`, never as `ref: null`.

## Waitlist API

`POST ${process.env.NEXT_PUBLIC_API_URL}/waitlist` (falls back to `http://localhost:3001`; inlined at build time by the static export, so changing it requires a redeploy).

```ts
// request
{ email: string; city?: string; ref?: string }
// response — always 201, duplicates included, so the list can't be enumerated
{ ok: true; code: string | null; position: number; frens: number }
```

`400 { error: 'invalid_email' }` is the only failure. Send the currently selected city's name as `city`. On any network failure show `Couldn't join right now. Try again.` beneath the form and leave the entered email in place. The server drops an unparseable or self-referencing `ref` silently rather than rejecting the signup — a typo must never cost a signup — so the client sends whatever it captured and does not pre-validate beyond `REF_RE`.

## Motion

- **Nothing loops. Ever.** No autoplaying video, no pulsing dot, no marquee, no floating blobs. The single moving thing after load is the quote line tweening when a city is clicked.
- Entrance only, and short: the H1 rises a word at a time out of an `overflow:hidden` mask (each word its own span, cascaded by an `--i` custom property, ~0.5s on `--ease-soft`); everything below it blur-fades up 6px in sequence at 80ms intervals. It should register and be over, not perform.
- **Every hide-and-move rule lives inside `@media (prefers-reduced-motion: no-preference)`**, so the CSS defaults *are* the finished page. A reduced-motion visitor gets a complete still page, never a blank one waiting for JS.
- Interaction: buttons get `active:scale-[0.97]` and a colour transition. No hover-scale on anything larger than a button.

## Responsive

Mobile-first; the whole hero must fit a 390×844 viewport without scrolling to reach the email field. Below `sm`: `px-6`, H1 lands at its `2.8rem` clamp floor, the form stacks input-over-button at full width, the city chips wrap to two rows, the join surface goes `p-5 rounded-[24px]`. `min-h-svh` (not `min-h-screen`) so mobile browser chrome doesn't clip the fold.

## Structure

- `src/app/page.tsx` — the section, roughly 100 lines, sections 01–06 and the footer deleted outright.
- `src/app/layout.tsx` — font, metadata, analytics.
- `src/app/globals.css` — `@theme`, `.eyebrow`, `.tabular`, motion.
- `src/components/` — `Waitlist.tsx` (form + all three states), `ref.ts`, `Quote.tsx` (line + city chips), `QrCode.tsx`, `Logo.tsx`, `Pill.tsx`, `qrMatrix.ts` (generated).
- Delete on the way: `ModuleFigure.tsx`, `QuoteWidget.tsx`, `HeroQuoteCard.tsx`, `CityPills.tsx`, `PixelField.tsx`, `QrHero.tsx`'s `Rail`, `Reveal.tsx`, `useMagnetic.ts`, `rand.ts`, `qrGeometry.ts`.

## What would make this look generated — don't

A second font family, especially a serif or typewriter face. Emoji or a stock icon set. A frosted-glass card floating over a video. Gradient text. A pill labelled "AI-powered". Three feature columns with circle icons. A testimonial. A "Trusted by" logo strip with no logos. A number that isn't true — no "10,000+ users", no country count, no fake queue position.
