import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

export function V2HeroCopy() {
  return (
    <div className="fp-hero-copy">
      <h1 className="fp-hero-heading">
        {FRENSPAY_COPY.headline.map((line) => (
          <span className="fp-hero-line-mask" key={line}>
            <span className="fp-hero-line-inner">{line}</span>
          </span>
        ))}
      </h1>
      <p className="fp-hero-supporting">{FRENSPAY_COPY.supporting}</p>
    </div>
  );
}
