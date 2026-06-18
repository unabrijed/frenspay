// friends.tsx — Send (pick a friend) → Send amount → Sent, and Request money.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icons } from '@/components/icons';
import { ResultBlock } from '@/components/ResultBlock';
import { Btn } from '@/components/ui/Button';
import { Keypad } from '@/components/ui/Keypad';
import { Fav, Grab, List, Row, RowMeta, SearchBar, SheetBody, SheetHeader, Spacer } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { inr, usd } from '@/lib/money';
import { colors, type } from '@/lib/theme';
import { FRIENDS } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

export function Send() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
  const setFriend = usePayStore((s) => s.setFriend);
  return (
    <>
      <Grab />
      <SheetHeader title="Send to a friend" onClose={close} />
      <SheetBody>
        <SearchBar placeholder="Search a name or @handle" />
        <List>
          {FRIENDS.map((fr) => (
            <Row
              key={fr.handle}
              onPress={() => {
                setFriend(fr);
                open('sendAmount');
              }}>
              <Fav label={fr.ini} />
              <RowMeta>
                <Txt style={type.rowName}>{fr.name}</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{fr.handle}</Txt>
              </RowMeta>
              <Icons.Chevron size={18} color={colors.muted} />
            </Row>
          ))}
        </List>
      </SheetBody>
    </>
  );
}

export function SendAmount() {
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
  return (
    <>
      <Grab />
      <SheetHeader eyebrow="Sending to" title={friend.handle} onClose={close} />
      <SheetBody>
        <View style={styles.amountbig}>
          <Txt style={[type.bigAmount, { color: colors.ink }]}>${u}</Txt>
          <Txt style={type.conv}>~ {inr(u)}</Txt>
        </View>
        <Keypad onPress={press} />
        <Btn label={`Send $${u}`} disabled={!ok} onPress={() => doSend(u)} />
      </SheetBody>
    </>
  );
}

export function Request() {
  const close = usePayStore((s) => s.close);
  const open = usePayStore((s) => s.open);
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
        <View style={styles.amountTop}>
          <Txt style={[type.bigAmount, { color: colors.ink }]}>${u}</Txt>
          <Txt style={type.conv}>~ {inr(u)}</Txt>
        </View>
        <Keypad onPress={press} />
        <View style={styles.cta}>
          <Btn label="Request from a friend" disabled={u <= 0} onPress={() => open('send')} />
          <Btn label="Share a payment link" variant="secondary" onPress={close} />
        </View>
      </SheetBody>
    </>
  );
}

export function Sent() {
  const close = usePayStore((s) => s.close);
  const lastSend = usePayStore((s) => s.lastSend);
  return (
    <>
      <Grab />
      <SheetHeader title="Sent" onClose={close} />
      <SheetBody>
        <ResultBlock
          kind="ok"
          icon={<Icons.Check size={30} color={colors.accent} />}
          headline={`$${lastSend.u} sent`}
          sub={`To ${lastSend.handle} · ~ ${inr(lastSend.u)}`}
        />
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Done" variant="ink" onPress={close} />
        </View>
      </SheetBody>
    </>
  );
}

const styles = StyleSheet.create({
  amountbig: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  amountTop: { alignItems: 'center', gap: 8, paddingTop: 18, paddingBottom: 10 },
  cta: { gap: 13, alignItems: 'center' },
});
