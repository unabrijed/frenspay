'use client';

// friends.tsx — Send (pick a friend) → Send amount → Sent, and Request money.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { canonicalHandle, classifyAddress, inr, looksLikePhone, phoneCandidates, truncateAddress } from '@fpay/shared';

import { Btn, colors, Fav, fonts, Grab, Icons, Keypad, List, Mark, Pressable, Row, RowMeta, SearchBar, SheetBody, SheetHeader, Spacer, TextLink, Txt, type, View } from '@fpay/ui';
import { ResultBlock } from '../components/ResultBlock';
import { platform } from '../platform';
import { wallet, type Friend } from '../services/wallet';
import { usePayStore } from '../store';

export function Send() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const setFriend = usePayStore((s) => s.setFriend);
  const startExternalSend = usePayStore((s) => s.startExternalSend);
  return (
    <>
      <Grab />
      <SheetHeader title="Send" onClose={close} />
      <SheetBody>
        <PeopleSearch
          onPick={(fr) => {
            setFriend(fr);
            open('sendAmount');
          }}
          onPickAddress={startExternalSend}
        />
      </SheetBody>
    </>
  );
}

export function SendAmount() {
  const fxRate = usePayStore((s) => s.fxRate);
  const close = usePayStore((s) => s.close);
  const doSend = usePayStore((s) => s.doSend);
  const friend = usePayStore((s) => s.friend);
  const bal = usePayStore((s) => s.balanceUSD);
  const [d, setD] = useState('12');
  const press = (k: string) => {
    if (k === '⌫') setD((s) => s.slice(0, -1));
    else if (k === '00') setD((s) => (s === '0' || s === '' ? s : s + '00'));
    else if (d.length < 5) setD((s) => (s === '0' ? '' : s) + k);
  };
  const u = parseInt(d || '0', 10);
  const ok = u > 0 && u <= bal;
  const ini = (friend.handle.replace(/^@/, '')[0] ?? '?').toUpperCase();
  return (
    <>
      <Grab />
      <SheetHeader title="Send money" onClose={close} />
      <SheetBody>
        <View style={styles.payee}>
          <Fav label={ini} />
          <Txt style={[type.sub, { marginTop: 8 }]}>Sending to</Txt>
          {/* Verified payee name (UPI-style confirm): the server-resolved name, not what was typed. */}
          <Txt style={type.payeeWho}>{friend.name}</Txt>
          <Txt style={[type.sub, { color: colors.muted }]}>{friend.handle}</Txt>
        </View>
        <View style={styles.amountWrap}>
          <View style={styles.amountRow}>
            <Txt style={[type.bigAmount, styles.dollar]}>$</Txt>
            <Txt style={[type.bigAmount, { color: colors.ink }]}>{u}</Txt>
          </View>
          <View style={styles.convPill}>
            <Icons.LockCheck size={14} color={colors.secondary} />
            <Txt style={[type.sub, { color: colors.muted }]}>≈ {inr(u, fxRate)} · rate locked</Txt>
          </View>
        </View>
        <Keypad onPress={press} />
        <Btn label={`Send $${u}`} disabled={!ok} onPress={() => doSend(u)} />
      </SheetBody>
    </>
  );
}

export function Request() {
  const fxRate = usePayStore((s) => s.fxRate);
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const setRequestDraft = usePayStore((s) => s.setRequestDraft);
  const [d, setD] = useState('20');
  const press = (k: string) => {
    if (k === '⌫') setD((s) => s.slice(0, -1));
    else if (k === '00') setD((s) => (s === '0' || s === '' ? s : s + '00'));
    else if (d.length < 5) setD((s) => (s === '0' ? '' : s) + k);
  };
  const u = parseInt(d || '0', 10);
  return (
    <>
      <Grab />
      <SheetHeader title="Request money" onClose={close} />
      <SheetBody>
        <View style={[styles.amountWrap, { paddingTop: 18 }]}>
          <View style={styles.amountRow}>
            <Txt style={[type.bigAmount, styles.dollar]}>$</Txt>
            <Txt style={[type.bigAmount, { color: colors.ink }]}>{u}</Txt>
          </View>
          <View style={styles.convPill}>
            <Icons.LockCheck size={14} color={colors.secondary} />
            <Txt style={[type.sub, { color: colors.muted }]}>≈ {inr(u, fxRate)}</Txt>
          </View>
        </View>
        <Keypad onPress={press} />
        <View style={styles.cta}>
          <Btn
            label="Choose who to ask"
            disabled={u <= 0}
            onPress={() => {
              setRequestDraft(u);
              open('requestPick');
            }}
          />
        </View>
      </SheetBody>
    </>
  );
}

export function RequestPick() {
  const close = usePayStore((s) => s.close);
  const requestMoney = usePayStore((s) => s.requestMoney);
  const amount = usePayStore((s) => s.requestDraftUsd);
  const busy = usePayStore((s) => s.busy);
  return (
    <>
      <Grab />
      <SheetHeader eyebrow={`Requesting $${amount}`} title="From a friend" onClose={close} />
      <SheetBody>
        <PeopleSearch
          onPick={(fr) => {
            if (!busy) void requestMoney(fr.handle, amount);
          }}
        />
      </SheetBody>
    </>
  );
}

export function RequestSent() {
  const fxRate = usePayStore((s) => s.fxRate);
  const close = usePayStore((s) => s.close);
  const lastRequest = usePayStore((s) => s.lastRequest);
  return (
    <>
      <Grab />
      <SheetHeader title="Requested" onClose={close} />
      <SheetBody>
        <ResultBlock
          kind="ok"
          icon={<Mark size={30} state="success" color={colors.accent} />}
          headline={`$${lastRequest.u} requested`}
          sub={`From ${lastRequest.handle} · ~ ${inr(lastRequest.u, fxRate)}`}
        />
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Done" variant="ink" onPress={close} />
        </View>
      </SheetBody>
    </>
  );
}

export function Sent() {
  const fxRate = usePayStore((s) => s.fxRate);
  const close = usePayStore((s) => s.close);
  const lastSend = usePayStore((s) => s.lastSend);
  return (
    <>
      <Grab />
      <SheetHeader title="Sent" onClose={close} />
      <SheetBody>
        <View style={styles.settle}>
          <View style={styles.ringWrap}>
            <View className="pulse-ring" style={styles.ring} />
            <View className="pulse-ring" style={[styles.ring, { animationDelay: '0.6s' }]} />
            {/* The pair, not a tick: the rings are the money settling, and what it
                settles onto is the two of you. They hop once on mount. */}
            <View style={styles.coreCircle}>
              <Mark size={46} state="success" color={colors.accent} />
            </View>
          </View>
          <Txt style={[type.result, { marginTop: 6 }]}>${lastSend.u} sent</Txt>
          <Txt style={[type.lead, { marginTop: 4, textAlign: 'center' }]}>To {lastSend.handle} · sending…</Txt>
        </View>
        <View style={styles.detailCard}>
          <View style={styles.kvRow}>
            <Txt style={[type.tierTag, { color: colors.muted }]}>AMOUNT</Txt>
            <Txt style={type.rowAmount}>${lastSend.u}</Txt>
          </View>
          <View style={styles.hr} />
          <View style={styles.kvRow}>
            <Txt style={[type.tierTag, { color: colors.muted }]}>RATE LOCKED</Txt>
            <View style={styles.lockPill}>
              <Txt style={[type.sub, { color: colors.ink }]}>≈ {inr(lastSend.u, fxRate)}</Txt>
              <Icons.LockCheck size={14} color={colors.accent} />
            </View>
          </View>
        </View>
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Done" onPress={close} />
        </View>
      </SheetBody>
    </>
  );
}

// Terminal failure for a P2P send (or a failed request-pay). Mirrors the merchant-pay failed card so
// every outcome reads as an intentional result. Opened by the store's doSend catch.
export function SendFailed() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const error = usePayStore((s) => s.error);
  return (
    <>
      <Grab />
      <SheetHeader title="Not sent" onClose={close} />
      <SheetBody>
        <ResultBlock
          kind="no"
          icon={<Icons.XBig size={28} color={colors.muted} />}
          headline="Payment not sent"
          sub={error ?? 'Something went wrong. No money left your balance.'}
        />
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Try again" onPress={() => open('sendAmount')} />
          <TextLink label="Done" onPress={close} />
        </View>
      </SheetBody>
    </>
  );
}

/* ---- shared people picker: search + filter + @handle resolve + contacts prefill ---- */

function ContactsPrompt({ onAllow }: { onAllow: () => void }) {
  return (
    <Pressable onPress={onAllow} style={({ pressed }) => [styles.contacts, pressed ? { opacity: 0.85 } : null]}>
      <View style={styles.contactsIcon}>
        <Icons.Device size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt style={type.rowName}>Pay your contacts</Txt>
        <Txt style={[type.rowTime, { marginTop: 2 }]}>Allow access to find friends on fpay</Txt>
      </View>
      <Txt style={{ ...fonts.body500, fontSize: 14, color: colors.accent }}>Allow</Txt>
    </Pressable>
  );
}

function PeopleSearch({
  onPick,
  onPickAddress,
}: {
  onPick: (f: Friend) => void;
  /** When provided, a typed/pasted wallet address becomes a tappable "send to this wallet" row. */
  onPickAddress?: (address: string, network: 'solana' | 'evm') => void;
}) {
  const [query, setQuery] = useState('');
  const [resolved, setResolved] = useState<Friend | null>(null);
  const [checking, setChecking] = useState(false);
  const ownPhone = usePayStore((s) => s.phone);
  const country = usePayStore((s) => s.country);

  // No client-side name index — the directory resolves only by @handle/phone. So the list is just
  // the live-resolved hit (if any); nothing shows until the user types.
  //
  // `canonicalHandle` is the SHARED rule, the same one the scanner and the backend use. This box
  // used to run its own version that STRIPPED illegal characters instead of rejecting them, so
  // "@ne-ha" silently became "@neha" — a different real person — with no confirmation step able to
  // catch it, because the name shown was genuinely that other user's.
  const handle = query.trim().startsWith('@') ? canonicalHandle(query) : null;
  const address = onPickAddress ? classifyAddress(query) : ({ kind: 'invalid' } as const);
  // Pay-by-phone: '+' input → 1 candidate; local format defaults to the sender's country code
  // (UPI model), falling back to own-phone-prefix guesses. Wrong candidate = lookup miss only.
  const phoneQuery = !handle && looksLikePhone(query);
  const candidates = phoneQuery
    ? phoneCandidates(query, { country: country || undefined, ownPhone: ownPhone || undefined })
    : [];
  const candKey = candidates.join(',');

  // Debounced directory resolve: @handle first, else phone candidates (first hit wins).
  useEffect(() => {
    const wantsPhone = candKey.length > 0;
    if (!handle && !wantsPhone) {
      setResolved(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        let f: Friend | null = null;
        if (handle) {
          f = await wallet.resolveHandle(handle);
        } else {
          for (const c of candKey.split(',')) {
            f = (await wallet.resolvePhone?.(c)) ?? null;
            if (f) break;
          }
        }
        if (!cancelled) setResolved(f);
      } catch {
        if (!cancelled) setResolved(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [handle, candKey]);

  const rows: Friend[] = resolved ? [resolved] : [];

  const allowContacts = async () => {
    const c = await platform().pickContact?.();
    // Prefer the number (it resolves through the directory, UPI-style); fall back to name prefill.
    if (c?.tel) setQuery(c.tel);
    else if (c?.name) setQuery(c.name);
  };

  return (
    <>
      {/* Contacts lead when the device has them (docs/04: "Send to Contacts" is THE send entry);
          elsewhere the search box stays the sole — and therefore still leading — element. */}
      {platform().capabilities.contacts ? <ContactsPrompt onAllow={allowContacts} /> : null}
      <SearchBar
        placeholder={onPickAddress ? '@handle, phone, or wallet address' : '@handle or phone'}
        value={query}
        onChangeText={setQuery}
      />
      {address.kind !== 'invalid' ? (
        <List>
          <Row onPress={() => onPickAddress?.(address.address, address.kind)}>
            <View style={styles.contactsIcon}>
              <Icons.Wallet size={18} color={colors.accent} />
            </View>
            <RowMeta>
              <Txt style={type.rowName}>Send to this wallet address</Txt>
              <Txt style={[type.rowTime, { marginTop: 3 }]}>
                {truncateAddress(address.address)}
                {address.kind === 'solana' ? ' · Solana' : ''}
              </Txt>
            </RowMeta>
            <Icons.Chevron size={18} color={colors.muted} />
          </Row>
        </List>
      ) : rows.length > 0 ? (
        <List>
          {rows.map((fr) => (
            <Row key={fr.handle} onPress={() => onPick(fr)}>
              <Fav label={fr.ini} />
              <RowMeta>
                <Txt style={type.rowName}>{fr.name}</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{fr.handle}</Txt>
              </RowMeta>
              <Icons.Chevron size={18} color={colors.muted} />
            </Row>
          ))}
        </List>
      ) : (
        <Txt style={[type.rowTime, { textAlign: 'center', marginTop: 18 }]}>
          {checking
            ? 'Checking…'
            : handle
              ? `${handle} isn’t on fpay yet. Invite them from Receive`
              : phoneQuery
                ? candidates.length
                  ? 'That number isn’t on fpay yet'
                  : 'Use international format, like +91 98765 43210'
                : 'Search by @handle or phone'}
        </Txt>
      )}
    </>
  );
}

const styles = {
  payee: { alignItems: 'center', gap: 2, paddingTop: 6, paddingBottom: 6 },
  amountWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline' },
  dollar: { color: colors.tertiary, fontSize: 34, marginRight: 2 },
  convPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceLow,
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 14,
    paddingTop: 7,
    paddingBottom: 7,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.outlineVariant,
  },
  cta: { gap: 13, alignItems: 'center' },
  settle: { alignItems: 'center', paddingTop: 6, paddingBottom: 4 },
  ringWrap: { position: 'relative', width: 168, height: 168, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 2, borderStyle: 'solid', borderColor: colors.accentSoft },
  coreCircle: { width: 104, height: 104, borderRadius: 999, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 30px rgba(140,113,108,0.15)' },
  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.outlineVariant,
    boxShadow: '0 4px 20px rgba(74,70,67,0.05)',
    padding: 16,
    marginTop: 16,
  },
  kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, paddingBottom: 4 },
  hr: { height: 1, backgroundColor: colors.hair, marginTop: 6, marginBottom: 6 },
  lockPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceLow, borderRadius: 999, paddingLeft: 10, paddingRight: 12, paddingTop: 5, paddingBottom: 5 },
  contacts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hair,
    borderRadius: 16,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 14,
    paddingRight: 16,
    backgroundColor: colors.surface,
    marginBottom: 14,
  },
  contactsIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
} satisfies Record<string, CSSProperties>;
