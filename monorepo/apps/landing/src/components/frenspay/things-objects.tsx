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

/* frens pay. — a paper note tearing along its perforation into two halves, one
   for each fren. Both halves share the same jagged edge polyline so the pieces
   visibly belong to one sheet. */
const NOTE_TEAR = 'L398 470 L392 428 L407 386 L390 342 L406 300 L388 258 L408 214 L390 172 Z';
const NOTE_LEFT = `M400 130 L178 130 Q150 130 150 158 L150 442 Q150 470 178 470 ${NOTE_TEAR}`;
const NOTE_RIGHT = `M400 130 L622 130 Q650 130 650 158 L650 442 Q650 470 622 470 ${NOTE_TEAR}`;

// Airmail chevrons: one dash constant walked along each edge, alternating
// accent, so both halves carry the same border without four path constants.
const chevrons = (from: number, to: number, y: number, accent: boolean) => {
  const step = 26;
  const marks = [];
  for (let x = from; x + step <= to; x += step) {
    const odd = Math.round((x - from) / step) % 2 === (accent ? 1 : 0);
    if (!odd) continue;
    marks.push(`M${x} ${y + 6} L${x + 11} ${y - 6} L${x + 22} ${y + 6}`);
  }
  return marks.join(' ');
};

const AIRMAIL = [
  { accent: false, stroke: 'var(--color-terra)' },
  { accent: true, stroke: 'var(--color-terra-ctr)' },
] as const;

export function PayNote() {
  return (
    <svg viewBox="0 0 800 600" fill="none" aria-hidden="true">
      <g className="obj-note-left">
        <path d={NOTE_LEFT} stroke="var(--color-ink)" strokeWidth="7" strokeLinejoin="round" />
        {AIRMAIL.map(({ accent, stroke }) => (
          <path
            key={stroke}
            d={`${chevrons(170, 384, 152, accent)} ${chevrons(170, 384, 448, accent)}`}
            stroke={stroke}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {/* Postmark: a cancelled corner, no letters, no glyphs. */}
        <rect x="186" y="188" width="52" height="52" rx="9" stroke="var(--color-terra-ctr)" strokeWidth="4" />
        <path
          d="M196 206 L228 206 M196 222 L220 222"
          stroke="var(--color-terra-ctr)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M195 290 L340 290 M195 340 L320 340"
          stroke="var(--color-terra)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
      <g className="obj-note-right">
        <path d={NOTE_RIGHT} stroke="var(--color-ink)" strokeWidth="7" strokeLinejoin="round" />
        {AIRMAIL.map(({ accent, stroke }) => (
          <path
            key={stroke}
            d={`${chevrons(416, 630, 152, accent)} ${chevrons(416, 630, 448, accent)}`}
            stroke={stroke}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <path
          d="M460 290 L610 290 M460 340 L590 340"
          stroke="var(--color-terra)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
      <path
        className="obj-note-perforation"
        d="M399 124 L399 476"
        stroke="var(--color-terra-ctr)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="1 11"
      />
    </svg>
  );
}
