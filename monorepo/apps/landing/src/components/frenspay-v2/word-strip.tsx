import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

export function V2WordStrip() {
  return (
    <div className="fp-note-phrase" aria-label="frens pay">
      <span className="fp-note-frens" aria-hidden="true">frens</span>
      <span className="fp-word-window" aria-hidden="true">
        <span className="fp-word-strip">
          {FRENSPAY_COPY.words.map((word) => (
            <span className="fp-word-panel" key={word}>{word}</span>
          ))}
        </span>
      </span>
      <span className="fp-note-period" aria-hidden="true">.</span>
    </div>
  );
}
