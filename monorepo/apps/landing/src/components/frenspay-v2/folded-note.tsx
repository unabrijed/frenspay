import type { MouseEventHandler } from 'react';

import { FRENSPAY_COPY } from '@/lib/frenspay-copy';

import { V2InlineFListForm } from './inline-flist-form';
import { V2WordStrip } from './word-strip';

const [fYou, fUs, fSent, fReceived, fFound, fComing, fyi, settled, passItOn] = FRENSPAY_COPY.fragments;

export function V2FoldedNote({ onReturnToForm }: { onReturnToForm: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <div className="fp-note-entrance">
      <div className="fp-note-motion">
        <div className="fp-note-depth">
          <article className="fp-note" aria-label="A folded FrensPay note">
            <div className="fp-note-core">
              <div className="fp-note-underlayer" aria-hidden="true" />
              <div className="fp-note-back" aria-hidden="true">
                <span>FP / PASS—08</span>
              </div>

              <section className="fp-unfold-sheet" id="fp-v2-mystery" aria-labelledby="fp-v2-mystery-heading">
                <span className="fp-paper-grain" aria-hidden="true" />
                <span className="fp-unfold-fold fp-unfold-fold-a" aria-hidden="true" />
                <span className="fp-unfold-fold fp-unfold-fold-b" aria-hidden="true" />
                <span className="fp-unfold-edge-note fp-edge-one" aria-hidden="true">{fReceived} / 004</span>
                <span className="fp-unfold-edge-note fp-edge-two" aria-hidden="true">{fComing}</span>
                <span className="fp-unfold-registration" aria-hidden="true">+</span>
                <div className="fp-mystery-print">
                  <h2 id="fp-v2-mystery-heading">
                    {FRENSPAY_COPY.mystery.map((line) => (
                      <span className="fp-mystery-mask" key={line}>
                        <span className="fp-mystery-line">{line}</span>
                      </span>
                    ))}
                  </h2>
                  <span className="fp-mostly">{FRENSPAY_COPY.interruption}</span>
                </div>
                <footer className="fp-resolution">
                  <p>{FRENSPAY_COPY.final}</p>
                  <div className="fp-resolution-lockup">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo-mark.svg" alt="" width="34" height="44" />
                    <span>frenspay</span>
                  </div>
                  <a href="#fp-v2-flist" onClick={onReturnToForm}>{FRENSPAY_COPY.fList} ↑</a>
                </footer>
              </section>

              <div className="fp-note-face">
                <span className="fp-paper-grain" aria-hidden="true" />
                <span className="fp-crop-mark fp-crop-top" aria-hidden="true" />
                <span className="fp-crop-mark fp-crop-left" aria-hidden="true" />
                <span className="fp-face-code" aria-hidden="true">FP—08 / FOLD—03</span>
                <V2WordStrip />
                <span className="fp-face-fragment fp-face-fragment-a" aria-hidden="true">{fFound}</span>
                <span className="fp-face-fragment fp-face-fragment-b" aria-hidden="true">{passItOn}</span>
                <span className="fp-note-fold" aria-hidden="true" />
                <div className="fp-stamp" aria-hidden="true">{fyi}</div>
                <V2InlineFListForm />
              </div>

              <aside className="fp-receipt-layer" aria-hidden="true">
                <span className="fp-receipt-holes" />
                <span>{fYou}</span>
                <span>{fUs}</span>
                <span>{fSent}</span>
                <span className="fp-receipt-rule" />
                <strong>{settled}</strong>
              </aside>

              <div className="fp-front-flap" aria-hidden="true">
                <span className="fp-flap-line" />
                <p>{FRENSPAY_COPY.headline[1]}</p>
                <span>{fUs} / {fFound} / 003</span>
              </div>

              <div className="fp-seal" aria-hidden="true">
                <span className="fp-seal-ring" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark.svg" alt="" width="46" height="60" />
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
