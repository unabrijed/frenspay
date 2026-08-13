// alert/provider.ts — the out-of-band alert seam for LPs.
//
// WHY A SEAM AND NOT A FUNCTION. An LP has to find out an order exists within seconds, while the
// app is closed and the phone is in their pocket. There is nothing in this repo that can do that:
// no push, no SSE, no websocket, and apps/web/src/components/SwKiller.tsx actively unregisters
// service workers, so web push is a prerequisite fight rather than a feature. Telegram works today,
// on every phone, for nothing. Mobile push is wanted later, and it is a different transport with
// the same job — so this mirrors the shape services/payout/provider.ts and services/kyc/provider.ts
// already use: an interface, a config-selected registry, one file per adapter.
//
// THE CONTRACT, in the same spirit as services/notify.ts: an alert MUST NOT be able to fail the
// thing it is telling you about. Adapters never throw. A dead Telegram, a revoked token, a network
// timeout — all of them are silence, never a failed order.

/** What an LP is told. `url` deep-links straight at the thing they need to act on. */
export interface AlertMessage {
  title: string;
  body: string;
  url?: string;
}

export interface AlertProvider {
  /** Matches `merchants.alert_channel`. */
  id: string;
  /** `to` is `merchants.alert_address`, addressed however this transport addresses people.
   *  Resolves either way: true if it went out, false if it didn't. Never rejects. */
  send(to: string, msg: AlertMessage): Promise<boolean>;
}
