'use client';

// identity.tsx — Verify (just-in-time KYC tiers) and Recovery (deferred backup).
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Btn, colors, fonts, Grab, Icons, List, radii, Row, RowIcon, RowMeta, SheetBody, SheetHeader, Spacer, TextLink, Txt, type, View } from '@fpay/ui';
import { usePayStore } from '../store';

// The wait on the vendor's decision, made visible. Rings breathing out of a dot — the `Sent` hero's
// settling motion (sheets/friends.tsx) at card scale, and the same shape as OrderTracking's active
// step, whose ring is this one holding still. Never the only signal: the caller always pairs it with
// a sentence and a role="status", because motion is the flourish and never the message.
function PulseDot() {
  return (
    <View style={styles.pulseWrap}>
      <View className="pulse-ring" style={styles.pulseRing} />
      <View className="pulse-ring" style={[styles.pulseRing, { animationDelay: '0.6s' }]} />
      <View style={styles.pulseCore} />
    </View>
  );
}

// What each waiting status is told to the user, in their words rather than the vendor's enum.
const WAIT_COPY = {
  pending: { tag: 'Checking', title: 'Checking your result…', sub: 'Usually under a minute.' },
  in_review: { tag: 'In review', title: 'A person is looking at it', sub: 'We’ll let you know — nothing for you to do.' },
} as const;

export function Verify() {
  const close = usePayStore((s) => s.close);
  const verifyDone = usePayStore((s) => s.verifyDone);
  const refresh = usePayStore((s) => s.refresh);
  const payCtx = usePayStore((s) => s.pendingPay);
  const tier = usePayStore((s) => s.kycTier);
  const kycStatus = usePayStore((s) => s.kycStatus);
  const available = usePayStore((s) => s.identityCheckAvailable);
  const error = usePayStore((s) => s.error);
  // Local, not the store's `busy`: that flag has 35 writers (load() among them), so a cold refresh
  // landing while this sheet is open would otherwise disable the only button on it.
  const [starting, setStarting] = useState(false);
  const waiting = kycStatus === 'pending' || kycStatus === 'in_review' ? WAIT_COPY[kycStatus] : null;
  const declined = kycStatus === 'declined';
  // The vendor is switched off for this deployment. Not a blip — it lasts until it is switched back
  // on — so the sheet must not offer a Start button whose only outcome is 503 with copy that says
  // "try again shortly". Say what is true and leave nothing to press.
  const paused = tier < 2 && !available;

  // `error` is a shared slot — a stale scan/quote failure would otherwise render red inside the tier
  // card. Same fresh-sheet reset as sheets/pay.tsx.
  useEffect(() => {
    usePayStore.setState({ error: null });
  }, []);

  // The pulse has to correspond to a real check. useLiveSync only ticks every 12s and stops on a
  // hidden tab; while this sheet is open and waiting we poll like OrderTracking does.
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [waiting, refresh]);

  const start = async () => {
    setStarting(true);
    try {
      await verifyDone();
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <Grab />
      <SheetHeader title={payCtx ? 'Verify to scan and pay' : 'Verification'} onClose={close} />
      <SheetBody>
        {payCtx ? (
          <Txt style={[type.lead, { marginBottom: 14 }]}>
            A one-time check before you scan and pay. Your balance stays safe and untouched.
          </Txt>
        ) : null}

        <View style={[styles.tier, styles.tierOn]}>
          <View style={styles.th}>
            <View style={styles.badgeOk}>
              <Icons.LockCheck size={14} color={colors.white} strokeWidth={2.2} />
            </View>
            <Txt style={type.tierTitle}>Tier 1</Txt>
            <Txt style={[type.tierTag, { marginLeft: 'auto', color: colors.accent }]}>Active</Txt>
          </View>
          <Txt style={styles.desc}>
            Send and receive with friends. Up to <Txt style={styles.monoInk}>$100</Txt> per transfer.
          </Txt>
        </View>

        <View style={[styles.tier, { marginTop: 12 }, tier >= 2 ? styles.tierOn : null]}>
          <View style={styles.th}>
            {tier >= 2 ? (
              <View style={styles.badgeOk}>
                <Icons.LockCheck size={14} color={colors.white} strokeWidth={2.2} />
              </View>
            ) : (
              <View style={styles.badgeOff} />
            )}
            <Txt style={type.tierTitle}>Tier 2</Txt>
            <Txt style={[type.tierTag, { marginLeft: 'auto', color: tier >= 2 ? colors.accent : colors.muted }]}>
              {tier >= 2 ? 'Active' : (waiting?.tag ?? (declined ? 'Not verified' : 'Verify to unlock'))}
            </Txt>
          </View>
          <Txt style={styles.desc}>Scan and pay across India. Passport + visa, about 2 minutes.</Txt>
          {tier < 2 ? (
            <>
              {/* One note slot, in priority order: a live failure, then a vendor decline, then the
                  wait. Rendering two of them at once said the same thing twice in two voices. */}
              {paused ? (
                <Txt style={[type.lead, { marginTop: 12 }]}>
                  Identity checks are paused right now, so there’s nothing to do here. We’ll let you know
                  as soon as they’re back on — everything else in the app keeps working.
                </Txt>
              ) : error ? (
                <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{error}</Txt>
              ) : declined ? (
                <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>
                  Verification didn’t pass. You can try again with your documents to hand.
                </Txt>
              ) : waiting ? (
                <View style={styles.wait} role="status" aria-label={waiting.title}>
                  <PulseDot />
                  <View style={{ flex: 1 }}>
                    <Txt style={type.lead}>{waiting.title}</Txt>
                    <Txt style={[type.inst, { marginTop: 2 }]}>{waiting.sub}</Txt>
                  </View>
                </View>
              ) : null}
              {/* The button survives the wait: a session the user abandoned (closed the vendor tab,
                  hit back) leaves the row 'pending' until it expires hours later, and hiding the
                  button behind that made the wait a dead end. Starting over is safe — POST
                  /kyc/verify overwrites the session (db/queries.ts setKycSession). It steps back to
                  `secondary` while waiting so it reads as the way out, not the thing to do next. */}
              {paused ? null : (
                <Btn
                  label={starting ? 'Starting…' : waiting ? 'Start over' : declined ? 'Try again' : 'Verify identity'}
                  onPress={() => void start()}
                  variant={waiting && !starting ? 'secondary' : 'primary'}
                  pending={starting}
                  disabled={starting}
                  style={{ marginTop: 14 }}
                />
              )}
            </>
          ) : null}
        </View>

        {payCtx ? <Spacer /> : null}
        {payCtx ? (
          <View style={{ alignItems: 'center' }}>
            <TextLink label="Not now" onPress={close} />
          </View>
        ) : null}
      </SheetBody>
    </>
  );
}

export function Recovery() {
  const recoveryDone = usePayStore((s) => s.recoveryDone);
  const email = usePayStore((s) => s.recoveryEmail);
  const passkey = usePayStore((s) => s.recoveryPasskey);
  const addPasskey = usePayStore((s) => s.addPasskey);
  const error = usePayStore((s) => s.authError);
  return (
    <>
      <Grab />
      <SheetHeader title="Add a backup" onClose={recoveryDone} />
      <SheetBody>
        <Txt style={type.lead}>So you never lose access if you lose this phone.</Txt>
        <View style={{ marginTop: 16 }}>
          <List>
            {/* Email is the login + recovery factor for email users — informational. */}
            <Row>
              <RowIcon>
                <Icons.Mail size={18} color={colors.muted} strokeWidth={1.6} />
              </RowIcon>
              <RowMeta>
                <Txt style={type.rowName}>Recover by email</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{email || 'Sign in with email'}</Txt>
              </RowMeta>
              {email ? <Icons.Check size={18} color={colors.accent} /> : null}
            </Row>
            <Row onPress={passkey ? undefined : () => void addPasskey()}>
              <RowIcon>
                <Icons.Device size={18} color={colors.muted} strokeWidth={1.6} />
              </RowIcon>
              <RowMeta>
                <Txt style={type.rowName}>Add a second device</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{passkey ? 'Passkey added' : 'Secure with a passkey'}</Txt>
              </RowMeta>
              {passkey ? (
                <Icons.Check size={18} color={colors.accent} />
              ) : (
                <Icons.Chevron size={18} color={colors.muted} />
              )}
            </Row>
          </List>
        </View>
        {error ? <Txt style={[type.rowTime, { color: colors.danger, marginTop: 12 }]}>{error}</Txt> : null}
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Done" onPress={recoveryDone} />
          <TextLink label="Set up later" onPress={recoveryDone} />
        </View>
      </SheetBody>
    </>
  );
}

const styles = {
  wait: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  // The rings grow past the wrap (scale 1.4) rather than being clipped by it, so the box only has to
  // hold the dot. Sized off the tier card's own text, not the `Sent` hero's 168px.
  pulseWrap: { position: 'relative', width: 26, height: 26, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pulseRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 2, borderStyle: 'solid', borderColor: colors.accentLine },
  pulseCore: { width: 10, height: 10, borderRadius: 999, backgroundColor: colors.accent },
  tier: { borderWidth: 1, borderStyle: 'solid', borderColor: colors.hair, borderRadius: radii.card, padding: 16, backgroundColor: colors.surface },
  tierOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  th: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  desc: { ...type.tierDesc, marginTop: 8 },
  monoInk: { ...fonts.mono400, color: colors.ink },
  badgeOk: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeOff: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderStyle: 'solid', borderColor: colors.muted },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
