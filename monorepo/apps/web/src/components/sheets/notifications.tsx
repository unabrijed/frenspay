'use client';

// notifications.tsx — M6 in-app inbox. Lists the user's notifications (newest first) and marks them
// read on open. Everyday-app feel: "Money received — Neha sent you $5".
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

import { Icons } from '@/components/icons';
import { Grab, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/Skeleton';
import { Txt } from '@/components/ui/Txt';
import { View } from '@/components/ui/rn';
import { colors, radii, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const ICON: Record<string, keyof typeof Icons> = {
  received: 'Wallet',
  payment_sent: 'Send',
  refunded: 'Swap',
  request_paid: 'Check',
  kyc_upgraded: 'LockCheck',
};

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function Notifications() {
  const close = usePayStore((s) => s.close);
  const items = usePayStore((s) => s.notifications);
  const loaded = usePayStore((s) => s.firstLoadDone);
  const readNotifications = usePayStore((s) => s.readNotifications);

  // Mark the inbox read when it opens.
  useEffect(() => {
    void readNotifications();
  }, [readNotifications]);

  return (
    <>
      <Grab />
      <SheetHeader title="Activity" onClose={close} />
      <SheetBody>
        {!loaded ? (
          Array.from({ length: 4 }, (_, i) => (
            <View key={i} style={styles.row}>
              <Skeleton w={38} h={38} r={999} />
              <View style={styles.col}>
                <Skeleton w="60%" h={13} />
                <Skeleton w="40%" h={11} />
              </View>
              <Skeleton w={28} h={11} />
            </View>
          ))
        ) : items.length === 0 ? (
          <Txt style={[type.lead, { color: colors.muted, textAlign: 'center', marginTop: 24 }]}>
            You’re all caught up.
          </Txt>
        ) : (
          items.map((n) => {
            const Icon = Icons[ICON[n.kind] ?? 'Bell'];
            return (
              <View key={n.id} style={styles.row}>
                <View style={[styles.dot, n.read ? styles.dotRead : null]}>
                  <Icon size={18} color={n.read ? colors.muted : colors.accent} />
                </View>
                <View style={styles.col}>
                  <Txt style={type.rowName}>{n.title}</Txt>
                  {n.body ? <Txt style={[type.sub, { color: colors.secondary }]}>{n.body}</Txt> : null}
                </View>
                <Txt style={[type.rowTime, { color: colors.muted }]}>{ago(n.createdAt)}</Txt>
              </View>
            );
          })
        )}
      </SheetBody>
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottom: `1px solid ${colors.hair}`,
  },
  col: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  dot: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  dotRead: { backgroundColor: colors.surfaceContainer },
};
