import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

export function HeroCopy() {
  return (
    <div className="hero-copy">
      <h1 className="hero-heading">
        {FRENSPAY_COPY.headline.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </h1>
      <p className="hero-supporting">{FRENSPAY_COPY.supporting}</p>
    </div>
  );
}
