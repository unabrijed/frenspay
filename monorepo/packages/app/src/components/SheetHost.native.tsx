// SheetHost.native.tsx — the store-driven bottom-sheet layer, RN side. Same shape as the web one
// (one overlay, tap-to-dismiss scrim, rise+fade), done with Animated instead of CSS transitions.
// Sheets dismiss via scrim or ×, not drag, so no gesture library is needed.
import { colors, radii, rnStyle, shadows } from '@fpay/ui';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { renderSheet, TALL } from '../sheets/registry';
import { usePayStore } from '../store';

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
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    ...rnStyle(shadows.sheet),
  },
});
