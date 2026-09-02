// registry.tsx — the one list of sheets: id → element, and which ones take the full height. Both
// SheetHost renderers (web divs, native Animated) read this, so adding a sheet is one case here.
import { AddMoney } from './AddMoney';
import { Country } from './Country';
import { Currency } from './Currency';
import { Request, RequestPick, RequestSent, Send, SendAmount, SendFailed, Sent } from './friends';
import { Help } from './Help';
import { Recovery, Verify } from './identity';
import { LocalCurrency } from './LocalCurrency';
import { Notifications } from './notifications';
import { OrderTracking } from './OrderTracking';
import { Amount, Scan } from './pay';
import { PayByPhone } from './PayByPhone';
import { Receive } from './Receive';
import { SendAddressAmount, SendAddressConfirm, SendNetwork } from './sendAddress';
import type { SheetId } from '../store';

export const TALL = new Set<SheetId>([
  'country',
  'scan',
  'amount',
  'send',
  'sendAmount',
  'sendAddressAmount',
  'sendAddressConfirm',
  'request',
  'requestPick',
  'requestSent',
  'sent',
  'verify',
  'recovery',
  'tracking',
  'notifications',
]);

export function renderSheet(id: SheetId) {
  switch (id) {
    case 'scan':
      return <Scan />;
    case 'amount':
      return <Amount />;
    case 'add':
      return <AddMoney />;
    case 'send':
      return <Send />;
    case 'sendAmount':
      return <SendAmount />;
    case 'sendAddressAmount':
      return <SendAddressAmount />;
    case 'sendAddressConfirm':
      return <SendAddressConfirm />;
    case 'sendNetwork':
      return <SendNetwork />;
    case 'request':
      return <Request />;
    case 'requestPick':
      return <RequestPick />;
    case 'requestSent':
      return <RequestSent />;
    case 'sent':
      return <Sent />;
    case 'sendFailed':
      return <SendFailed />;
    case 'verify':
      return <Verify />;
    case 'recovery':
      return <Recovery />;
    case 'payByPhone':
      return <PayByPhone />;
    case 'receive':
      return <Receive />;
    case 'currency':
      return <Currency />;
    case 'localCurrency':
      return <LocalCurrency />;
    case 'country':
      return <Country />;
    case 'tracking':
      return <OrderTracking />;
    case 'help':
      return <Help />;
    case 'notifications':
      return <Notifications />;
    default:
      return null;
  }
}
