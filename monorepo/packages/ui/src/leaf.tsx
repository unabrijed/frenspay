'use client';

// leaf.tsx — the three primitives that are genuinely a different ELEMENT per platform: a text
// field, the mark's SVG, a remote image. Everything else in primitives.tsx is View/Txt/Pressable
// and renders on both renderers as-is. leaf.native.tsx is the RN twin; keep the prop shapes equal.
import type { CSSProperties } from 'react';

import { type InputProps, type KeyboardType, MARK_LINK, type MarkProps, flagUrl } from './leaf.types';
import { type St, sx } from './rn';
import { colors } from './theme';

export type { InputProps, KeyboardType, LogoState, MarkProps } from './leaf.types';
export { MARK_LINK, flagUrl } from './leaf.types';

const INPUT_MODE: Record<KeyboardType, 'text' | 'numeric' | 'decimal' | 'email' | 'tel'> = {
  default: 'text',
  numeric: 'numeric',
  decimal: 'decimal',
  email: 'email',
  tel: 'tel',
};

export function Input({ value, onChangeText, placeholder, autoFocus, keyboardType = 'default', maxLength, autoComplete, onSubmit, style }: InputProps) {
  return (
    <input
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      onKeyDown={onSubmit ? (e) => e.key === 'Enter' && onSubmit() : undefined}
      placeholder={placeholder}
      autoFocus={autoFocus}
      type={keyboardType === 'email' ? 'email' : keyboardType === 'tel' ? 'tel' : 'text'}
      inputMode={INPUT_MODE[keyboardType]}
      maxLength={maxLength}
      autoComplete={autoComplete}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      style={sx({ border: 'none', outline: 'none', background: 'transparent', padding: 0, color: colors.ink }, style as St[])}
    />
  );
}

// The mark: two frens, the dots are heads and the curve is a body under each.
// Geometry mirrors brand/logo-icon.svg (the square cut — the wide lockup dies
// below 32px in a square tile). Inlined rather than imported from the landing's
// generated logo-geometry.ts because these are separate apps with no shared UI
// package; if the artwork changes, `yarn brand` regenerates the icons and this
// needs the same edit by hand.
//
// This replaced a literal <Txt>T</Txt> — a leftover from the Tabroad name that
// was still shipping on the onboarding welcome screen and the boot splash.
//
// Motion lives in globals.css (a @keyframes block needs a stylesheet and this file
// styles inline), keyed off the classes and data-attributes below.
//
// Every gesture is a BODY gesture — the two lean toward each other at rest, and hop
// together on success. Deliberately no wink and no blink: at this size two dots over
// a curve are already one bad reading away from a smiley, and an eyelid is what
// settles that reading the wrong way. The mark is two frens sitting either side, so
// it moves the way two people do, not the way a face does. Same reason avatars stay
// initials — a circular avatar slot is exactly where the two collapse into one face.
export function Mark({ size, state = 'idle', enter, color = colors.canvas, bead = colors.accent }: MarkProps) {
  return (
    <svg
      className="fp-logo"
      data-state={state}
      data-enter={enter ? '' : undefined}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      aria-hidden="true"
    >
      {/* pathLength normalises the draw-on to 0..1, so the entrance keyframes never
          have to know the curve's real length. */}
      <path
        className="fp-logo-link"
        d={MARK_LINK}
        pathLength={1}
        stroke={color}
        strokeWidth="48"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="fp-logo-dot fp-logo-dot-l" cx="66" cy="74" r="31" fill={color} />
      <circle className="fp-logo-dot fp-logo-dot-r" cx="190" cy="74" r="31" fill={color} />
      {/* Painted in the SURROUND, not the mark, so it reads as a gap travelling
          along the curve rather than a dot stuck on it. */}
      <circle
        className="fp-logo-bead"
        r={48 * 0.4}
        fill={bead}
        style={{ offsetPath: `path("${MARK_LINK}")` } as CSSProperties}
      />
    </svg>
  );
}

/** Circular country flag (circle-flags SVGs off jsDelivr — remote like Material Symbols, never
 *  self-hosted). Decorative: the country name/code is always adjacent text, and a load failure
 *  (offline, unknown ISO) hides the img so rows degrade to text-only. */
export function Flag({ iso, size = 40 }: { iso: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny remote SVGs; next/image adds nothing
    <img
      src={flagUrl(iso)}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      style={{ borderRadius: '50%', flexShrink: 0 }}
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}
