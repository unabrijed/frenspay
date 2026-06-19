// SheetHost — the store-driven bottom-sheet layer (mirrors app.jsx's sheet stack).
// One overlay renders whichever sheet `store.sheet` names, over a tap-to-dismiss
// scrim, with a rise+fade entrance/exit. Sheets dismiss via scrim or ×, not drag,
// so no gesture library is needed.
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddMoney } from '@/components/sheets/AddMoney';
import { Request, RequestPick, RequestSent, Send, SendAmount, Sent } from '@/components/sheets/friends';
import { Recovery, Verify } from '@/components/sheets/identity';
import { Amount, Declined, Review, Scan, Success } from '@/components/sheets/pay';
import { colors, radii, shadows } from '@/lib/theme';
import { type SheetId, usePayStore } from '@/store/usePayStore';

const TALL = new Set<SheetId>([
  'scan',
  'amount',
  'review',
  'success',
  'declined',
  'send',
  'sendAmount',
  'request',
  'requestPick',
  'requestSent',
  'sent',
  'verify',
  'recovery',
]);

function renderSheet(id: SheetId) {
  switch (id) {
    case 'scan':
      return <Scan />;
    case 'amount':
      return <Amount />;
    case 'review':
      return <Review />;
    case 'success':
      return <Success />;
    case 'declined':
      return <Declined />;
    case 'add':
      return <AddMoney />;
    case 'send':
      return <Send />;
    case 'sendAmount':
      return <SendAmount />;
    case 'request':
      return <Request />;
    case 'requestPick':
      return <RequestPick />;
    case 'requestSent':
      return <RequestSent />;
    case 'sent':
      return <Sent />;
    case 'verify':
      return <Verify />;
    case 'recovery':
      return <Recovery />;
    default:
      return null;
  }
}

export function SheetHost() {
  const sheet = usePayStore((s) => s.sheet);
  const closing = usePayStore((s) => s.closing);
  const close = usePayStore((s) => s.close);
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (closing) {
      Animated.timing(progress, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    } else if (sheet) {
      progress.setValue(0);
      Animated.timing(progress, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, [sheet, closing, progress]);

  if (!sheet) return null;
  const tall = TALL.has(sheet);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  const sheetOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          tall ? { top: insets.top + 10 } : { maxHeight: '92%' },
          { paddingBottom: insets.bottom, opacity: sheetOpacity, transform: [{ translateY }] },
        ]}>
        {renderSheet(sheet)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    ...shadows.sheet,
  },
});
