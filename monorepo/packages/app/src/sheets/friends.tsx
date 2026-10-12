'use client';

// friends.tsx — Send (pick a friend) → Send amount → Sent, and Request money.
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { canonicalHandle, classifyAddress, inr, looksLikePhone, phoneCandidates, truncateAddress } from '@fpay/shared';

import {
  Btn,
  colors,
  Fav,
  fonts,
  Grab,
  Icons,
  Keypad,
  List,
  Mark,
  Pressable,
  Row,
  RowMeta,
  SearchBar,
  SheetBody,
  SheetHeader,
  Spacer,
  TextLink,
  Txt,
  type,
  View,
} from '@fpay/ui';
import { ResultBlock } from '../components/ResultBlock';
import { platform } from '../platform';
import { friendsApi } from '../services/api';
import { friendlyError } from '../lib/errors';
import type { SavedFriend, SuggestedPerson } from '@fpay/shared';
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
        <Txt style={type.rowName}>Choose a contact</Txt>
        <Txt style={[type.rowTime, { marginTop: 2 }]}>Pick someone to find their Frenspay account</Txt>
      </View>
      <Txt style={{ ...fonts.body500, fontSize: 14, color: colors.accent }}>Allow</Txt>
    </Pressable>
  );
}

export function PeopleSearch({
  onPick,
  onPickAddress,
  groupId,
  manage = true,
  onPickGroup,
}: {
  onPick: (f: Friend) => void;
  onPickAddress?: (address: string, network: 'solana' | 'evm') => void;
  groupId?: string;
  manage?: boolean;
  onPickGroup?: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [resolved, setResolved] = useState<{ key: string; friend: Friend | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [saved, setSaved] = useState<SavedFriend[]>([]);
  const [suggested, setSuggested] = useState<SuggestedPerson[]>([]);
  const [suggestedGroups, setSuggestedGroups] = useState<{ id: string; name: string }[]>([]);
  const [notice, setNotice] = useState('');
  const [inviteText, setInviteText] = useState('');
  const [reload, setReload] = useState(0);
  const ownPhone = usePayStore((s) => s.phone);
  const country = usePayStore((s) => s.country);
  const me = usePayStore((s) => s.handle);
  const open = usePayStore((s) => s.open);
  const address = onPickAddress ? classifyAddress(query) : ({ kind: 'invalid' } as const);
  const phoneQuery = looksLikePhone(query);
  const candidates = phoneQuery
    ? phoneCandidates(query, { country: country || undefined, ownPhone: ownPhone || undefined })
    : [];
  const candKey = candidates.join(',');
  const handle = !phoneQuery && address.kind === 'invalid' && query.trim() ? canonicalHandle(query) : null;
  const lookupKey = `${handle ?? ''}|${candKey}`;
  useEffect(() => {
    let alive = true;
    void Promise.allSettled([friendsApi.list(), friendsApi.suggestions(groupId)]).then(([a, b]) => {
      if (!alive) return;
      if (a.status === 'fulfilled') setSaved(a.value.friends);
      if (b.status === 'fulfilled') {
        setSuggested(b.value.people);
        setSuggestedGroups(b.value.groups);
      }
    });
    return () => {
      alive = false;
    };
  }, [groupId, reload]);
  useEffect(
    () =>
      platform().onForeground((active) => {
        if (active) setReload((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    setLookupFailed(false);
    setNotice('');
    setInviteText('');
    if (!handle && !candKey) {
      setChecking(false);
      return;
    }
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        let friend: Friend | null = null;
        if (handle) friend = await wallet.resolveHandle(handle);
        else
          for (const phone of candKey.split(',')) {
            friend = (await wallet.resolvePhone?.(phone)) ?? null;
            if (friend) break;
          }
        if (!cancelled) setResolved({ key: lookupKey, friend });
      } catch {
        if (!cancelled) setLookupFailed(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, candKey, lookupKey, reload]);
  const allowContacts = async () => {
    const c = await platform().pickContact?.();
    if (c?.tel) setQuery(c.tel);
    else if (c?.name) setQuery(c.name);
  };
  const lookupDone = resolved?.key === lookupKey;
  const match = lookupDone ? resolved.friend : null;
  const term = query.trim().toLowerCase();
  const local = term
    ? saved.filter((p) => p.name.toLowerCase().includes(term) || p.handle.toLowerCase().includes(term))
    : suggested;
  const rows: Friend[] = (match ? [match, ...local.filter((p) => p.handle !== match.handle)] : local)
    .filter((p) => p.handle !== me)
    .map((p) => ({ ...p, ini: ('ini' in p ? p.ini : undefined) ?? p.name[0]?.toUpperCase() ?? '?' }));
  const invite = async () => {
    try {
      const phone = candidates.length === 1 ? candidates[0] : null;
      if (!phone) {
        setNotice('Enter the full number with its country code to invite by SMS.');
        return;
      }
      const { code } = await friendsApi.invite();
      if (!code) {
        setNotice('You have no unused invitations right now.');
        return;
      }
      const url = new URL(platform().env.landingUrl || platform().origin());
      url.searchParams.set('invite', code);
      const text = `Join me on Frenspay to send money and split bills. My username is ${me}. ${url}`;
      setInviteText(text);
      if (platform().openSms) await platform().openSms!(phone, text);
      else setNotice('Copy the invitation below and send it from your messaging app.');
    } catch (e) {
      setNotice(friendlyError(e, 'Couldn’t open SMS. You can copy the invitation instead.'));
    }
  };
  return (
    <>
      {platform().capabilities.contacts ? <ContactsPrompt onAllow={allowContacts} /> : null}
      <SearchBar
        placeholder={onPickAddress ? 'Username, phone, or wallet address' : 'Username or phone number'}
        value={query}
        onChangeText={setQuery}
      />
      {manage ? <TextLink label="Manage friends" onPress={() => open('friends')} /> : null}
      {!term && onPickGroup && suggestedGroups.length > 0 ? (
        <View style={{ gap: 6, marginTop: 10 }}>
          <Txt style={type.eyebrow}>Your groups</Txt>
          {suggestedGroups.map((g) => (
            <TextLink key={g.id} label={g.name} onPress={() => onPickGroup(g.id)} />
          ))}
        </View>
      ) : null}
      {address.kind !== 'invalid' ? (
        <List>
          <Row onPress={() => onPickAddress?.(address.address, address.kind)}>
            <RowMeta>
              <Txt style={type.rowName}>Send to this wallet</Txt>
              <Txt style={type.rowTime}>{truncateAddress(address.address)}</Txt>
            </RowMeta>
            <Icons.Chevron size={18} color={colors.muted} />
          </Row>
        </List>
      ) : null}
      {rows.length > 0 ? (
        <List>
          {rows.map((fr) => (
            <Row key={fr.handle} onPress={() => onPick(fr)}>
              <Fav label={fr.ini} />
              <RowMeta>
                <Txt style={type.rowName}>{fr.name}</Txt>
                <Txt style={type.rowTime}>{fr.handle}</Txt>
                {!term ? (
                  <Txt style={type.rowTime}>
                    {suggested.find((p) => p.handle === fr.handle)?.reason === 'routine'
                      ? 'Often split together around this time'
                      : suggested.find((p) => p.handle === fr.handle)?.reason === 'trip'
                        ? 'In this trip'
                        : saved.some((p) => p.handle === fr.handle && p.favorite)
                          ? 'Favorite'
                          : ''}
                  </Txt>
                ) : null}
              </RowMeta>
              <Icons.Chevron size={18} color={colors.muted} />
            </Row>
          ))}
        </List>
      ) : null}
      {checking ? <Txt style={type.sub}>Checking…</Txt> : null}
      {lookupFailed ? (
        <>
          <Txt style={type.sub}>Couldn’t look that up. Please try again.</Txt>
          <TextLink label="Retry lookup" onPress={() => setReload((n) => n + 1)} />
        </>
      ) : null}
      {phoneQuery && !checking && lookupDone && !match && !lookupFailed ? (
        <View style={{ gap: 10, marginTop: 12 }}>
          <Txt style={type.sub}>
            No Frenspay account found for this number. Invite them to join, then look them up again.
          </Txt>
          <Btn label="Invite by SMS" variant="secondary" onPress={() => void invite()} />
          <TextLink label="Check again" onPress={() => setReload((n) => n + 1)} />
        </View>
      ) : null}
      {phoneQuery && !candKey ? <Txt style={type.sub}>Include the country code, for example +65.</Txt> : null}
      {handle && lookupDone && !match && !checking && !lookupFailed ? (
        <Txt style={type.sub}>No account found. Check the username, or enter a phone number to invite them.</Txt>
      ) : null}
      {!query && !rows.length ? <Txt style={type.sub}>Find a friend by username or phone number.</Txt> : null}
      {notice ? <Txt style={[type.sub, { color: colors.muted }]}>{notice}</Txt> : null}
      {inviteText ? (
        <TextLink
          label="Copy invitation"
          onPress={() =>
            void platform()
              .copy(inviteText)
              .then(() => setNotice('Invitation copied.'))
              .catch(() => setNotice('Couldn’t copy the invitation.'))
          }
        />
      ) : null}
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
  ringWrap: {
    position: 'relative',
    width: 168,
    height: 168,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 999,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: colors.accentSoft,
  },
  coreCircle: {
    width: 104,
    height: 104,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 30px rgba(140,113,108,0.15)',
  },
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
  kvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    paddingBottom: 4,
  },
  hr: { height: 1, backgroundColor: colors.hair, marginTop: 6, marginBottom: 6 },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceLow,
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 12,
    paddingTop: 5,
    paddingBottom: 5,
  },
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
