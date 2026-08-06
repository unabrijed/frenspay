import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

export function PaperDetails() {
  const [fYou, fUs, fSent, fReceived, fFound, fComing, fyi, settled, passItOn] = FRENSPAY_COPY.fragments;

  return (
    <div className="paper-details" aria-hidden="true">
      <span className="print-fragment fragment-you">{fYou}</span>
      <span className="print-fragment fragment-us">{fUs}</span>
      <span className="print-fragment fragment-received">{fReceived}</span>
      <span className="print-fragment fragment-found">{fFound}</span>
      <span className="print-fragment fragment-coming">{fComing}</span>
      <span className="print-fragment fragment-fyi">{fyi}</span>
      <span className="teal-stamp">{fSent}</span>
      <span className="settled-line">{settled}</span>
      <span className="pass-it-on">{passItOn} →</span>
      <span className="ticket-number">FP—0087 / 26</span>
      <span className="registration-cross cross-a">+</span>
      <span className="registration-cross cross-b">+</span>
      <span className="rule-lines" />
    </div>
  );
}
