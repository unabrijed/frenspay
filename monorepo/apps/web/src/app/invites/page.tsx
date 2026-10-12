'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FlistInvite } from '@fpay/shared';
import { useFlist } from '@/components/CustomerAccess';
import { LANDING_URL } from '@/services/envConfig';
import s from '@/components/customer-access.module.css';

export default function Invites() {
  const access = useFlist();
  const [error, setError] = useState('');
  const refresh = access?.refresh;
  useEffect(() => {
    if (refresh) void refresh().catch(() => setError('Couldn’t refresh your invites. Try again.'));
  }, [refresh]);
  return <main className={s.shell}>
    <Link href="/" className={s.link}>← Back to the app</Link>
    <section className={s.card} style={{ marginTop: 32 }}>
      <h1>Invite a fren</h1>
      <p>A place for your people. Your invite links will always be here.</p>
      {access?.data.invites.map((invite) => <InviteCard key={invite.code} invite={invite} />)}
      {access && access.data.invites.length === 0 && <p>No invites available right now.</p>}
      {!access && <p>Sign in with your email to see your invites.</p>}
      {error && <><p role="alert" className={s.error}>{error}</p>
        <button className={s.link} onClick={() => void refresh?.().then(() => setError('')).catch(() => setError('Couldn’t refresh your invites. Try again.'))}>Try again</button></>}
    </section>
  </main>;
}

function InviteCard({ invite }: { invite: FlistInvite }) {
  const [notice, setNotice] = useState('');
  const [showLink, setShowLink] = useState(false);
  const url = new URL(LANDING_URL);
  url.searchParams.set('invite', invite.code);
  const link = url.toString();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Link copied'); setShowLink(false);
    } catch { setNotice('Copy the link below.'); setShowLink(true); }
  };
  const share = async () => {
    if (!navigator.share) return copy();
    try { await navigator.share({ title: 'Invite a fren', text: 'You’re invited to frenspay.', url: link }); }
    catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) setNotice('Couldn’t share. Copy the link instead.'); }
  };
  return <article className={s.invite}>
    <code>{invite.code}</code>
    <span>{invite.used ? 'Used' : 'Ready to share'}</span>
    {!invite.used && <>
      <div className={s.actions}>
        <button className={s.link} onClick={() => void copy()}>Copy link</button>
        <button className={s.link} onClick={() => void share()}>Share</button>
      </div>
      {showLink && <input aria-label={`Invite link for ${invite.code}`} readOnly value={link} onFocus={(e) => e.target.select()} />}
    </>}
    {notice && <p role="status">{notice}</p>}
  </article>;
}
