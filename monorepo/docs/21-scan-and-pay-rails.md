# 21 · Scan-and-pay rails — supported countries & payment-address resolution

Status: SHIPPED (structure + identify). Enablement of non-UPI payouts is a future milestone.

## The product law

**The countries fpay supports paying in are exactly the countries with a scan-and-pay rail in
`packages/shared/src/rails.ts` (`RAILS`).** Nothing else defines supported countries — no separate
country list exists, and none should be added. Today:

| Rail | Country | Currency | Live |
|---|---|---|---|
| UPI | IN | INR | ✅ |
| PromptPay | TH | THB | – |
| Pix | BR | BRL | – |
| DuitNow | MY | MYR | – |

`live` means payout works end-to-end (quotes → escrow → LP settles on that rail). A non-live rail
still *scans and identifies* cleanly — the pay flow names it and says it isn't payable yet. Flipping
a rail live is NOT a flag flip: it's the multi-currency milestone (per-currency quotes + FX +
LP payout rails; today `quotes.amount_inr`, the FX service, and every LP are INR/UPI-only).

## Payment-address resolution — identifying where a payment is processed

Every scan-and-pay rail is an alias directory in front of bank accounts (docs/17). The alias itself
often names the operator that processes the payment; `RailTarget` (rails.ts) is the structure that
captures it: `{ rail, kind, address, operator?, name?, amount?, currency? }`.

**India (UPI)** — `local@suffix`, where the suffix names the PSP app or the bank:
`asha@okaxis` → Google Pay (via Axis) · `9876@ybl` → PhonePe (via Yes Bank) · `shop@paytm` → Paytm ·
`x@hdfcbank` → HDFC Bank directly · `x@upi` → BHIM/NPCI. `UPI_HANDLES` + `vpaOperator()` in rails.ts
resolve this. **The table is a courtesy directory, not a validator**: NPCI mints new handles
constantly, so an unknown suffix identifies nothing and blocks nothing — the backend's `VPA_RE`
(routes/orders.ts) stays the authority on what is payable, and the payee-name confirmation stays
the anti-wrong-send gate.

**Thailand / Brazil / Malaysia** — these rails don't use `upi://`-style links. Their QRs are EMVCo
TLV payloads (leading `000201`), and the merchant-account template *names the network*:

- PromptPay: AID `A000000677010111` — proxy is a phone (sub-tag 01), national ID (02), or e-wallet (03)
- Pix: GUI `br.gov.bcb.pix` — key is an email / +phone / CPF / random EVP key, or a dynamic-QR URL
- DuitNow: PayNet AID `A000000615…`
- Bharat-QR (India): AID `A000000524` with the VPA alongside — funnels into the live UPI path

`packages/shared/src/emvqr.ts` (`parseEmvQr`) does this. Root tags give currency (53, numeric
ISO 4217), amount (54), payee name (59).

## Where it surfaces

- `apps/web/src/lib/qr.ts` — EMV branch: EMV-UPI joins the existing `{kind:'upi'}` orders path;
  non-live rails return `{kind:'unsupported'}` with a message naming the rail and country.
- Quote sheet (`components/sheets/Quote.tsx`) — "Payout method: UPI · via Google Pay".
- Merchant order screen (`app/merchant/orders/[id]/page.tsx`) — "Processed by <operator>" under the VPA.

## Self-check

`yarn workspace @fpay/shared check:rails` — asserts registry invariants, suffix resolution, and
EMV parsing for all four rails (plus rejects). Mobile is not yet wired for any of this (it has no
scanner); it reuses the same shared modules when it catches up.
