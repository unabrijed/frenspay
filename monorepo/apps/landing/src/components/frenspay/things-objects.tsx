// Four string-and-paper objects, hand-authored constants on an 800x600 viewBox.
//
// These are insert shots now, not the centrepiece: the scenes are the
// establishing shot and each object is the close-up of what the two figures in
// them are actually doing. That is what carries the "something happening between
// frens" the landscapes alone cannot — two people 4px tall read as serene, not
// as friends.
//
// No framer-motion. Its only job here was interpolating `d`, and `d` is
// animatable in CSS in every current browser, so all four animate from
// @keyframes in globals.css instead and the dependency list stays at five. Frame
// 0 of each morphing path is repeated as the `d` attribute below so the object
// still renders correctly if the CSS `d` property is unsupported — it just holds
// still. Every other constant lives here alone.

/* frens play. — a cat's cradle: two strings held taut between four pinch
   points, morphing between string figures (sag → X-cross → double wave).
   Frames 1 and 2 live in the .obj-cradle-* keyframes. */
const CRADLE_TOP_0 =
  'M140 180 C220 235 300 262 400 262 C480 262 545 240 590 220 C625 205 645 192 660 180';
const CRADLE_BOTTOM_0 =
  'M140 420 C220 365 300 338 400 338 C480 338 545 360 590 380 C625 395 645 408 660 420';

const PINS = [
  [140, 180],
  [660, 180],
  [140, 420],
  [660, 420],
] as const;

export function PlayCradle() {
  return (
    <svg viewBox="0 0 800 600" fill="none" aria-hidden="true">
      {PINS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9" fill="var(--color-terra-ctr)" />
      ))}
      <path
        className="obj-cradle-top"
        d={CRADLE_TOP_0}
        stroke="var(--color-ink)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        className="obj-cradle-bottom"
        d={CRADLE_BOTTOM_0}
        stroke="var(--color-terra)"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* frens stay. — two cords entering from opposite edges, looped through each
   other and gently tightening.
   The original drew the left cord a third time, fattened and painted in the page
   background colour, to fake passing over the right one. That trick is gone: the
   background is an illustration now, not a flat fill, so a background-coloured
   stroke would paint a visible stripe across it. At this size the crossings read
   as interlocked without it. */
const KNOT_LEFT_0 =
  'M-30 310 C90 310 195 306 276 290 C360 272 398 220 378 178 C358 136 292 134 258 172 C224 210 234 284 296 320 C342 346 392 350 428 334';
const KNOT_RIGHT_0 =
  'M830 310 C710 310 605 306 524 290 C440 272 402 220 422 178 C442 136 508 134 542 172 C576 210 566 284 504 320 C458 346 408 350 372 334';

export function StayKnot() {
  return (
    <svg viewBox="0 0 800 600" fill="none" aria-hidden="true">
      <path
        className="obj-knot-right"
        d={KNOT_RIGHT_0}
        stroke="var(--color-terra)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        className="obj-knot-left"
        d={KNOT_LEFT_0}
        stroke="var(--color-ink)"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* frens relay. — a folded note passed point to point along a dashed arc,
   vanishing at the hand-off and reappearing at the start: the pass repeats.
   Origin is a plain pinch point; the destination carries a ring, so the two ends
   read as two places rather than a symmetric pair. The travel is transforms
   only, so it needs nothing from CSS but the keyframes. */
const RELAY_ARC = 'M80 440 C220 200 580 200 720 440';

export function RelayNote() {
  return (
    <svg viewBox="0 0 800 600" fill="none" aria-hidden="true">
      <circle cx="80" cy="440" r="9" fill="var(--color-terra-ctr)" />
      <circle cx="720" cy="440" r="9" fill="var(--color-terra-ctr)" />
      <circle cx="720" cy="440" r="18" stroke="var(--color-terra-ctr)" strokeWidth="3" />
      <path
        d={RELAY_ARC}
        stroke="var(--color-ink)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="2 16"
      />
      <g className="obj-relay-note">
        <rect x="-32" y="-22" width="64" height="44" rx="4" stroke="var(--color-ink)" strokeWidth="5" />
        <path d="M12 -22 L32 -22 L32 -2 Z" fill="var(--color-terra)" />
        <path d="M12 -22 L32 -2" stroke="var(--color-ink)" strokeWidth="4" strokeLinejoin="round" />
        <path d="M-20 4 L10 4" stroke="var(--color-terra-ctr)" strokeWidth="4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/* frens pay. — a bead leaves each fren along its own lane, they pass at the
   centre, and each settles in the other's ring; then it runs back.
   Two travellers going opposite ways is the whole point: relay is one thing
   crossing a distance, this is an exchange. Rings on both ends because both
   frens are payer and payee.
   This replaced a note tearing along a perforation, which was built out of
   receipt parts — a ruled sheet, a dashed tear line, a boxed postmark — and read
   as one. Nothing here is paper.
   Travel is transforms only, sampled from the two lane cubics at
   t = 0, .25, .5, .75, 1, so it needs nothing from CSS but the keyframes. */
const PAY_LANE_TOP = 'M120 300 C240 140 560 140 680 300';
const PAY_LANE_BOTTOM = 'M120 300 C240 460 560 460 680 300';

export function PaySwap() {
  return (
    <svg viewBox="0 0 800 600" fill="none" aria-hidden="true">
      {[120, 680].map((cx) => (
        <circle key={cx} cx={cx} cy="300" r="30" stroke="var(--color-terra-ctr)" strokeWidth="7" />
      ))}
      {[PAY_LANE_TOP, PAY_LANE_BOTTOM].map((d) => (
        <path
          key={d}
          d={d}
          stroke="var(--color-ink)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="2 16"
        />
      ))}
      {/* The transform attribute is frame 0, so the beads rest in their rings
          rather than in the corner where CSS transforms are unsupported or
          reduced motion has switched the animation off. CSS wins over it when
          both apply. */}
      <circle className="obj-pay-give" r="17" fill="var(--color-ink)" transform="translate(120 300)" />
      <circle className="obj-pay-take" r="17" fill="var(--color-terra)" transform="translate(680 300)" />
    </svg>
  );
}
