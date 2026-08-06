import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

export function MysteryCopy() {
  return (
    <div className="mystery-copy">
      <h2 className="mystery-heading">
        {FRENSPAY_COPY.mystery.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </h2>
      <p className="mostly-stamp">{FRENSPAY_COPY.interruption}</p>
      <p className="final-line">{FRENSPAY_COPY.final}</p>
    </div>
  );
}
