'use client';

import { useId, useRef, useState } from 'react';
import { canRehearsePayment, initialPreviewCards, type PreviewCard } from '@fpay/app/lib/cardPreview';
import s from './cards.module.css';

export function CardWallet() {
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [cards, setCards] = useState<PreviewCard[]>(initialPreviewCards);
  const [selected, setSelected] = useState(1);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [tone, setTone] = useState<PreviewCard['tone']>('sage');
  const [payment, setPayment] = useState<'idle' | 'review' | 'done'>('idle');
  const [notice, setNotice] = useState('');
  const card = cards.find(item => item.id === selected)!;
  function choose(id: number) { setSelected(id); setPayment('idle'); setNotice(''); }
  function add() {
    const id = Math.max(...cards.map(item => item.id)) + 1;
    setCards([...cards, {id, name: name.trim() || 'Personal', tone, frozen: false}]);
    choose(id); setAdding(false); setName(''); setNotice('Sample card added. Swipe up to find it.');
    requestAnimationFrame(() => document.getElementById(`${title}-${id}`)?.scrollIntoView({block: 'nearest'}));
  }
  return <section className={s.entry} aria-label="Cards preview">
    <div><span className={s.eyebrow}>UP NEXT · CARDS</span><h2>Your everyday wallet.</h2><p>Swipe through cards. Try the experience.</p></div>
    <button ref={opener} className={s.primary} onClick={() => dialog.current?.showModal()}>Explore card preview <span aria-hidden="true">↗</span></button>
    <dialog ref={dialog} className={s.dialog} aria-labelledby={title} onClose={() => { setAdding(false); setPayment('idle'); opener.current?.focus(); }}>
      <header className={s.header}><div><span className={s.eyebrow}>INTERACTIVE PREVIEW</span><h2 id={title}>Your cards</h2></div><button className={s.close} aria-label="Close cards preview" onClick={() => dialog.current?.close()}>×</button></header>
      <div className={s.body}>
        <p className={s.disclaimer}>Sample cards only. No card is issued and no money moves. Real cards and contactless payments are not available yet.</p>
        <div className={s.heading}><p>Swipe up to browse · Tap to select</p><button className={s.textButton} disabled={cards.length >= 5} onClick={() => {setAdding(!adding); setPayment('idle');}}>＋ Add card</button></div>
        {adding && <form className={s.panel} onSubmit={event => {event.preventDefault();add();}}>
          <h3>Add a sample card</h3><label>Card nickname<input autoFocus maxLength={24} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Weekend" /></label>
          <label>Colour<select value={tone} onChange={event => setTone(event.target.value as PreviewCard['tone'])}><option value="sage">Sage</option><option value="petrol">Deep teal</option><option value="rust">Terracotta</option></select></label>
          <p>No card number or security code needed.</p><div className={s.actions}><button className={s.primary} type="submit">Add sample card</button><button className={s.secondary} type="button" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>}
        <div className={s.deck} role="group" aria-label="Sample cards, scroll vertically">
          {cards.map(item => <button id={`${title}-${item.id}`} key={item.id} className={s.card} data-tone={item.tone} aria-pressed={selected === item.id} aria-label={`${item.name} sample card${item.frozen ? ', frozen' : ''}`} onClick={() => choose(item.id)}>
            <span className={s.cardTop}><b>frenspay</b><span>{item.frozen ? 'Frozen' : 'Sample card'}</span></span>
            <span className={s.chip} aria-hidden="true">▤ <span>)))</span></span>
            <span className={s.cardName}>{item.name}</span><span className={s.cardBottom}><span>•••• DEMO</span><span>{selected === item.id ? '✓ Selected' : 'Select card'}</span></span>
          </button>)}
        </div>
        <section className={s.controls} aria-label={`${card.name} controls`}>
          <div className={s.heading}><h3>{card.name}</h3><span>{card.frozen ? 'Frozen in preview' : 'Ready to preview'}</span></div>
          <div className={s.actions}><button className={s.primary} disabled={!canRehearsePayment(card)} onClick={() => setPayment('review')}>Try tap to pay</button><button className={s.secondary} onClick={() => {setCards(cards.map(item => item.id === selected ? {...item, frozen: !item.frozen} : item));setPayment('idle');setNotice(card.frozen ? 'Sample card unfrozen.' : 'Sample card frozen. Unfreeze to try a payment.');}}>{card.frozen ? 'Unfreeze' : 'Freeze'} card</button></div>
          <p>Apple Wallet / Google Wallet · Coming later</p>
        </section>
        {payment === 'review' && <section className={s.panel} aria-label="Preview payment review"><span className={s.eyebrow}>PAYMENT REHEARSAL</span><h3>Corner Café · ₹150</h3><p>Using {card.name}. This demonstrates the payment flow; it does not use NFC or contact a terminal.</p><div className={s.actions}><button className={s.primary} onClick={() => {if (canRehearsePayment(card)) setPayment('done');}}>Simulate tap</button><button className={s.secondary} onClick={() => setPayment('idle')}>Cancel payment</button></div></section>}
        {payment === 'done' && <section className={s.panel} role="status"><span className={s.eyebrow}>PREVIEW COMPLETE</span><h3>That’s the flow.</h3><p>₹150 at Corner Café with {card.name}. No money moved and the merchant was not paid.</p><button className={s.secondary} onClick={() => setPayment('idle')}>Done</button></section>}
        <p role="status" className={s.notice}>{notice}</p>
        <p className={s.footnote}>Your sample cards reset when you leave this session.</p>
      </div>
    </dialog>
  </section>;
}
