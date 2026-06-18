// TxRow — transaction list row (Home + Activity). Ported from screens-core.jsx.
import { Icons } from '@/components/icons';
import { Row, RowAmount, RowIcon, RowMeta } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { inrRaw, usd } from '@/lib/money';
import { colors, type } from '@/lib/theme';
import type { Txn } from '@/services/wallet';

export function TxRow({ tx, onPress }: { tx: Txn; onPress?: () => void }) {
  const merchant = tx.type === 'pay';
  return (
    <Row onPress={onPress}>
      <RowIcon accent={merchant}>
        {merchant ? (
          <Icons.Qr size={18} color={colors.accent} />
        ) : tx.type === 'add' ? (
          <Icons.Plus size={17} color={colors.muted} />
        ) : (
          <Icons.Send size={17} color={colors.muted} />
        )}
      </RowIcon>
      <RowMeta>
        <Txt style={type.rowName} numberOfLines={1}>
          {tx.title}
        </Txt>
        <Txt style={[type.rowTime, { marginTop: 3 }]}>{tx.time}</Txt>
      </RowMeta>
      <RowAmount>
        <Txt style={[type.rowAmount, tx.type === 'add' && { color: colors.accent }]}>
          {tx.type === 'add' ? '+' : '−'}
          {usd(Math.abs(tx.usd))}
        </Txt>
        {merchant ? <Txt style={[type.rowTime, { marginTop: 3 }]}>{inrRaw(tx.rupees ?? 0)}</Txt> : null}
      </RowAmount>
    </Row>
  );
}
