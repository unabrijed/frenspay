// Everything the page says, in one place.
//
// The four slide lines used to be built inline in things-hero, with one ternary
// special-casing `pay` for the phrase and a second special-casing it again for
// the whisper. There was no single place to read them, which is how they drifted
// into four identical `frens <verb>.` constructions with the travel squeezed out.

// pay's whisper is a deliberate two-beat joke — the line lands, then undercuts
// itself. Kept as named constants so it does not flatten into an anonymous
// string the next time someone edits this file.
const MYSTERY = 'What happens between frens stays between frens.';
const INTERRUPTION = 'mostly.';

export const FRENSPAY_COPY = {
  supporting: 'for people who know people, wherever they are.',

  // Every phrase carries a place or a journey as well as a fren, rather than
  // adding words to do it: "go places" and "make it home" are both literal
  // travel and warm idiom, and "cross oceans" is what the money does and what
  // the frens already did.
  slides: {
    play: { phrase: 'frens go places.', whisper: 'where it starts.' },
    stay: { phrase: 'frens make it home.', whisper: 'wherever you land.' },
    pay: { phrase: 'frens pay. frens get paid.', whisper: `${MYSTERY} ${INTERRUPTION}` },
    relay: { phrase: 'frens cross oceans.', whisper: 'across any distance.' },
  },

  // The door — and the only one. A code and an email together, or nothing: the f-list is no longer
  // the queue you fall back to without a code, it is what the code opens. So there is one form, one
  // button, and no mode to switch between. "let me in" rather than "join" or "submit": the whole
  // product is somebody vouching for you, and the button should sound like a person asking, not a
  // form being processed.
  fList: 'let me in',
  inviteLabel: 'invite code',
  emailLabel: 'email address',

  // Success. They arrived on somebody's code and leave holding three of their own — which is the
  // whole shape of the thing, so the screen says it plainly rather than thanking them for waiting.
  success: 'fyi, you’re in.',
  invitesLead: 'three codes. yours to give.',
  invitesNote: 'nobody gets in without one. we’ve emailed these to you as well.',
  copyAll: 'copy all three',
  copied: 'copied',
} as const;
