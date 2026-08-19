'use client';

// /business — the business check: what the LP submits, and where it got to.
//
// The person behind this account is already verified (tier-2 KYC, required to apply). This screen
// is about the BUSINESS, and above all about which account the fiat will actually leave from — the
// documented failure mode for this whole model is third-party money moving through a personal
// account and that account being frozen.
//
// Both halves live on one screen on purpose. A form with the decision history underneath it is how
// someone understands "we asked you for something" without being told twice.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';

import { KYB_FIELDS, kybAwaitingMerchant, validateKyb } from '@fpay/shared';

import { BackButton } from '@fpay/ui/BackButton';
import { Btn } from '@fpay/ui/Button';
import { Hairline, List, Row, RowMeta, SearchBar, Spacer } from '@fpay/ui/primitives';
import { View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { friendlyError } from '@/lib/errors';
import { colors, GUTTER, radii, type } from '@fpay/ui/theme';
import { submitMerchantKyb } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

/** What the merchant is told their status means. Deliberately in their language, not the enum's. */
const STATUS_COPY: Record<string, { title: string; body: string }> = {
  pending: { title: 'Tell us about your business', body: 'We need this before you can take orders.' },
  submitted: { title: 'With us now', body: 'Someone will look at this shortly. Nothing for you to do.' },
  under_review: { title: 'Being reviewed', body: 'A person is going through it now.' },
  more_info: { title: 'We need one more thing', body: 'Update what we’ve asked for below and send it again.' },
  approved: { title: 'Approved', body: 'Your business is verified. You can go online whenever you like.' },
  rejected: { title: 'Not approved', body: 'We couldn’t verify this business.' },
};

const relTime = (iso: string) => new Date(iso).toLocaleString();

export default function MerchantVerify() {
  const router = useRouter();
  const merchant = useLpStore((s) => s.merchant);
  const load = useLpStore((s) => s.load);

  const spec = useMemo(() => (merchant ? (KYB_FIELDS[merchant.country] ?? []) : []), [merchant?.country]);
  // Seeded from what they already sent, so a more-info request reopens the form filled in rather
  // than asking someone to retype seven fields to fix one.
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(merchant?.kybFields ?? {}) }));
  const [invalid, setInvalid] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!merchant) {
    return (
      <Screen edges={['top']} style={styles.safe}>
        <View style={styles.head}>
          <BackButton onPress={() => router.push('/')} />
        </View>
        <View style={styles.scroll}>
          <Txt style={type.lead}>You don’t have a partner account.</Txt>
        </View>
      </Screen>
    );
  }

  const editable = kybAwaitingMerchant(merchant.kybStatus);
  const copy = STATUS_COPY[merchant.kybStatus] ?? STATUS_COPY.pending;

  const submit = async () => {
    // Client-side validation is a COURTESY — it saves a round trip on a typo. The server runs the
    // same rules again and is the only one that decides.
    const bad = validateKyb(merchant.country, values);
    setInvalid(bad);
    if (bad.length) {
      setErr('Some details need fixing.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await submitMerchantKyb(values);
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/')} />
      </View>
      <View style={styles.scroll}>
        <Txt style={type.handle}>{copy.title}</Txt>
        <Txt style={[type.lead, { marginTop: 8 }]}>{copy.body}</Txt>

        {/* The reviewer's actual words. This is the whole improvement over a status word: a
            rejection nobody explains is one an LP can never act on. */}
        {merchant.kybNote ? (
          <View style={styles.note}>
            <Txt style={type.kvKey}>What we need</Txt>
            <Txt style={[type.lead, { marginTop: 4 }]}>{merchant.kybNote}</Txt>
          </View>
        ) : null}

        {editable ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>Your business</Txt>
            {spec.map((f) => (
              <View key={f.key} style={{ marginBottom: 14 }}>
                <Txt style={type.kvKey}>
                  {f.label}
                  {f.optional ? ' (optional)' : ''}
                </Txt>
                <View style={{ marginTop: 6 }}>
                  <SearchBar
                    placeholder={f.label}
                    value={values[f.key] ?? ''}
                    onChangeText={(v: string) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                  />
                </View>
                {f.hint ? <Txt style={[type.inst, { marginTop: 4 }]}>{f.hint}</Txt> : null}
                {invalid.includes(f.key) ? (
                  <Txt style={[type.inst, { marginTop: 4, color: colors.danger }]}>
                    {values[f.key]?.trim() ? 'That doesn’t look right.' : 'We need this one.'}
                  </Txt>
                ) : null}
              </View>
            ))}
          </>
        ) : (
          // Read-only: what they sent, so "with us now" isn't a black box.
          <>
            <Txt style={[type.kvKey, styles.section]}>What you sent</Txt>
            <List>
              {spec
                .filter((f) => merchant.kybFields?.[f.key])
                .map((f) => (
                  <Row key={f.key}>
                    <RowMeta>
                      <Txt style={type.rowName}>{f.label}</Txt>
                    </RowMeta>
                    <Txt style={type.rowAmount}>{merchant.kybFields![f.key]}</Txt>
                  </Row>
                ))}
            </List>
          </>
        )}

        {/* The timeline. Dates matter more than words here: "submitted" with no date is the thing
            that makes people email support. */}
        {merchant.kybEvents?.length ? (
          <>
            <Txt style={[type.kvKey, styles.section]}>History</Txt>
            <List>
              {merchant.kybEvents.map((e, i) => (
                <Row key={`${e.createdAt}-${i}`}>
                  <RowMeta>
                    <Txt style={type.rowName}>{STATUS_COPY[e.toStatus]?.title ?? e.toStatus}</Txt>
                    {e.note ? <Txt style={[type.rowTime, { marginTop: 2 }]}>{e.note}</Txt> : null}
                  </RowMeta>
                  <Txt style={type.rowTime}>{relTime(e.createdAt)}</Txt>
                </Row>
              ))}
            </List>
          </>
        ) : null}

        {err ? <Txt style={[type.lead, { color: colors.danger, marginTop: 12 }]}>{err}</Txt> : null}

        <Spacer />
        {editable ? (
          <Btn
            label={busy ? 'Sending…' : merchant.kybStatus === 'more_info' ? 'Send again' : 'Submit'}
            variant="ink"
            disabled={busy}
            onPress={() => void submit()}
          />
        ) : null}
        <Hairline />
      </View>
    </Screen>
  );
}

const styles = {
  safe: { backgroundColor: colors.canvas },
  head: { paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 6, paddingBottom: 2 },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingBottom: 28,
  },
  note: { marginTop: 16, padding: 14, borderRadius: radii.card, backgroundColor: colors.surfaceLow },
  section: { marginTop: 22, marginBottom: 8 },
} satisfies Record<string, CSSProperties>;
