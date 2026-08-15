// @fpay/ui — the product's design system: an RN-flavoured shim over the DOM, the primitives built
// on it, and the web adapter over @fpay/shared's design tokens.
//
// Split out of apps/web when the LP console became its own app. Nothing here knows about payers,
// merchants, money or routing — it is presentation only, which is what makes it safe to share.
//
// Consumers can import the barrel or a single module (`@fpay/ui/primitives`). apps/web imports the
// deep paths through its own one-line re-export shims, so its ~40 existing import sites never had
// to change.
export * from './rn';
export * from './theme';
export * from './icons';
export * from './primitives';
export * from './Button';
export * from './Keypad';
export * from './Screen';
export * from './BackButton';
