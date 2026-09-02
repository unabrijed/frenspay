'use client';

// /details — the partner check: what the LP submits, and where it got to. Step 2 of onboarding, and
// later the place an approved partner edits.
//
// A partner does not need a business. This screen is about the PERSON — who they are, how they pay,
// and whether the account they pay from is only for this work: the documented failure mode for this
// whole model is third-party money moving through a personal account and that account being frozen.
//
// Both halves live on one screen on purpose. A form with the decision history underneath it is how
// someone understands "we asked you for something" without being told twice. Once approved, the same
// screen is where a partner EDITS: everything saves in place except the account fields (the spec's
// `recheck` flags), which send them back to the queue, offline, until a human looks again.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { KYB_FIELDS, kybAwaitingMerchant, validateKyb } from '@fpay/shared';

import { BackButton } from '@fpay/ui/BackButton';
import { Btn } from '@fpay/ui/Button';
import { Hairline, List, Row, RowMeta, SearchBar, Spacer } from '@fpay/ui/primitives';
import { Pressable, ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { StepHeader } from '@/components/StepHeader';
import { friendlyError } from '@/lib/errors';
import { KYB_COPY, KYB_EVENT_COPY } from '@/lib/kybCopy';
import { colors, GUTTER, radii, type } from '@fpay/ui/theme';
import { submitMerchantKyb } from '@/services/merchant';
import { useLpStore } from '@/store/useLpStore';

const relTime = (iso: string) => new Date(iso).toLocaleString();

export default function MerchantVerify() {
  const router = useRouter();
  const merchant = useLpStore((s) => s.merchant);
  const load = useLpStore((s) => s.load);
  const notify = useLpStore((s) => s.notify);

  const spec = useMemo(() => (merchant ? (KYB_FIELDS[merchant.country] ?? []) : []), [merchant?.country]);
  // Seeded from what they already sent, so a more-info request reopens the form filled in rather
  // than asking someone to retype seven fields to fix one.
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(merchant?.kybFields ?? {}) }));
  const [invalid, setInvalid] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // An approved partner editing. Off again after a save, and never on for anyone else.
  const [editing, setEditing] = useState(false);

  // Re-seed when the profile lands and when editing begins. The store starts with no profile, so a
  // hard refresh of this page used to seed `{}` and never recover — with the account field now
  // optional, submitting that blank form would have silently cleared it. Hidden fields ride along in
  // `values` too, unrendered, so a stored PAN is re-sent (the server also carries it forward).
  useEffect(() => {
    setValues({ ...(merchant?.kybFields ?? {}) });
    setInvalid([]);
    setErr(null);
  }, [merchant?.id, editing]);

  // One setter for every input. A field's message goes the moment it is filled or a choice tapped —
  // clear-on-change, not re-validate-on-change, which would keep "That doesn’t look right" lit while a
  // value is half-typed. The next submit re-checks everything.
  const set = (k: string, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setInvalid((prev) => prev.filter((x) => x !== k));
    setErr(null);
  };

  if (!merchant) {
    return (
      <Screen edges={['top']} style={styles.safe}>
        <View style={styles.head}>
          <BackButton onPress={() => router.push('/')} />
        </View>
        <ScrollView style={styles.scroll}>
          <Txt style={type.lead}>You don’t have a partner account.</Txt>
        </ScrollView>
      </Screen>
    );
  }

  const approved = merchant.kybStatus === 'approved';
  const canEdit = approved && merchant.suspendReason !== 'exited';
  // On the onboarding chain until approved; from Account afterwards. Decides the header and the way back.
  const onboarding = !approved;
  const back = onboarding ? '/' : '/account';
  const editable = kybAwaitingMerchant(merchant.kybStatus) || (canEdit && editing);
  // The header says what this screen is right now. "Approved / go online" over an edit form would lie.
  const copy =
    canEdit && editing
      ? { title: 'Edit your details', body: 'Changing which account you pay from pauses orders until we re-check. Everything else updates right away.' }
      : (KYB_COPY[merchant.kybStatus] ?? KYB_COPY.pending);

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
      const { recheck } = await submitMerchantKyb(values);
      await load();
      if (canEdit && editing) {
        setEditing(false);
        notify(recheck ? 'Saved. We’ll re-check the changed details before you take orders again.' : 'Saved.', 'success');
      } else if (merchant.kybStatus === 'pending') {
        router.push('/stake'); // step 3 of the chain; a more-info resubmission stays to show "With us now"
      }
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push(back)} />
      </View>
      <ScrollView style={styles.scroll}>
        {onboarding ? <StepHeader step={2} /> : null}
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
            <Txt style={[type.kvKey, styles.section]}>About you</Txt>
            {/* Hidden fields (PAN, NIK) are not asked; they stay in `values` and in the recap below. */}
            {spec.filter((f) => !f.hidden).map((f) => (
              <View key={f.key} style={{ marginBottom: 14 }}>
                <Txt style={type.kvKey}>
                  {f.label}
                  {f.optional ? ' (optional)' : ''}
                </Txt>
                {f.options ? (
                  // A fixed choice is a tap, not a text box — the stored answer is the label itself.
                  <View style={styles.pills}>
                    {f.options.map((o) => {
                      const on = values[f.key] === o;
                      return (
                        <Pressable
                          key={o}
                          onPress={() => set(f.key, o)}
                          style={({ pressed }) => [styles.pill, on && styles.pillOn, pressed && { opacity: 0.7 }]}
                        >
                          <Txt style={[type.inst, { color: on ? colors.white : colors.ink }]}>{o}</Txt>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <View style={{ marginTop: 6 }}>
                    <SearchBar placeholder={f.label} value={values[f.key] ?? ''} onChangeText={(v: string) => set(f.key, v)} />
                  </View>
                )}
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
          // Read-only: what they sent, so "with us now" isn't a black box. Hidden fields with a stored
          // value still show here — it is their own answer, and admin sees the same list.
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
            {canEdit ? (
              <Pressable onPress={() => setEditing(true)}>
                <Txt style={[type.rowTime, { marginTop: 10, color: colors.accent }]}>Edit details</Txt>
              </Pressable>
            ) : null}
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
                    <Txt style={type.rowName}>{KYB_EVENT_COPY[e.event] ?? KYB_COPY[e.toStatus]?.title ?? e.toStatus}</Txt>
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
          <>
            <Btn
              label={busy ? 'Sending…' : editing ? 'Save changes' : merchant.kybStatus === 'more_info' ? 'Send again' : 'Submit'}
              variant="ink"
              disabled={busy}
              onPress={() => void submit()}
            />
            {editing ? (
              <Pressable onPress={() => setEditing(false)} disabled={busy}>
                <Txt style={[type.rowTime, { marginTop: 12, textAlign: 'center', color: colors.accent }]}>Cancel</Txt>
              </Pressable>
            ) : null}
          </>
        ) : null}
        <Hairline />
      </ScrollView>
    </Screen>
  );
}

const styles = {
  safe: { backgroundColor: colors.canvas },
  head: { paddingLeft: GUTTER, paddingRight: GUTTER, paddingTop: 6, paddingBottom: 2 },
  scroll: {
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingBottom: 28,
  },
  note: { marginTop: 16, padding: 14, borderRadius: radii.card, backgroundColor: colors.surfaceLow },
  pills: { marginTop: 6, display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8, borderRadius: 999, backgroundColor: colors.surfaceLow },
  pillOn: { backgroundColor: colors.ink },
  section: { marginTop: 22, marginBottom: 8 },
} satisfies Record<string, CSSProperties>;
