// leaf.types.ts — the prop shapes leaf.tsx and leaf.native.tsx both implement. Lives in a file
// with no `.native` twin so the native leaf can import it without resolving to itself.
import type { St } from './rn';

export type KeyboardType = 'default' | 'numeric' | 'decimal' | 'email' | 'tel';
export interface InputProps {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  autoFocus?: boolean;
  keyboardType?: KeyboardType;
  maxLength?: number;
  /** 'one-time-code' wires the OTP autofill on both platforms. */
  autoComplete?: 'one-time-code' | 'email' | 'tel' | 'off';
  onSubmit?: () => void;
  style?: St | St[];
}

export type LogoState = 'idle' | 'joining' | 'success';

// One copy of the curve. The bead rides it via offset-path, and two copies of the
// same `d` is the one way this file could silently drift from itself.
export const MARK_LINK = 'M60 136 C82 132 98 184 128 192 C158 184 174 132 196 136';

export interface MarkProps {
  size: number;
  state?: LogoState;
  enter?: boolean;
  /** Defaults to the terracotta-tile placement (cream mark, terracotta bead). Separate props
   *  because the bead is a GAP in the curve: painted in whatever the mark sits ON. */
  color?: string;
  bead?: string;
}

export const flagUrl = (iso: string) => `https://cdn.jsdelivr.net/gh/HatScripts/circle-flags@2.7.0/flags/${iso.toLowerCase()}.svg`;
