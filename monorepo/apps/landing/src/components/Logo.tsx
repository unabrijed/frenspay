/* The lockup: traced mark (public/logo-mark.svg, generated from brand/logo-mark.svg) plus the
   wordmark set live in Hanken Grotesk — "Frens" at 800, "Pay" at 400, the weight split the
   brand art uses. Live text rather than an image so it stays crisp, selectable, and recolourable.
   `fpay` stays the short name and is untouched in body copy. */

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`tracking-[-0.02em] ${className}`}>
      <span className="font-extrabold">Frens</span>
      <span className="font-normal">Pay</span>
    </span>
  );
}

export function Logo({
  className = '',
  markClass = 'h-7',
  wordClass = 'text-[22px]',
}: {
  className?: string;
  markClass?: string;
  wordClass?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* Decorative: the wordmark beside it already carries the name for screen readers. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" alt="" width={62} height={80} className={`w-auto ${markClass}`} />
      <Wordmark className={wordClass} />
    </span>
  );
}
