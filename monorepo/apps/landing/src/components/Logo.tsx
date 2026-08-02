/* fpay is the name the product uses. FrensPay is the full one, and the page
   reveals it exactly once, in the footer signature.

   The mark carries no wordmark of its own, so the lockup does not fake one:
   it is the mark plus the short name, set live in Hanken Grotesk rather than
   drawn, which keeps it crisp, selectable and recolourable. */

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
      {/* Decorative: the name beside it is what a screen reader should read. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" alt="" width={62} height={80} className={`w-auto ${markClass}`} />
      <span className={`font-extrabold tracking-[-0.03em] ${wordClass}`}>fpay</span>
    </span>
  );
}

/* The full name, and the one place it appears. "Frens" at 800 against "Pay" at
   400 is the weight split the brand art uses. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`tracking-[-0.02em] ${className}`}>
      <span className="font-extrabold">Frens</span>
      <span className="font-normal">Pay</span>
    </span>
  );
}
