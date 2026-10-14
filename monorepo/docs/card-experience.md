# Card experience preparation

The Home card entry opens an interactive web preview in both the simulation campaign and retained customer Home. It is independent of the real wallet and campaign credits. All cards are labelled samples; nothing is issued, tokenized, signed, funded or paid. State lives only in the mounted component and resets on unmount. Native mobile does not yet include this experience.

Implemented: vertical touch scrolling with scroll snapping, explicit selection, sample-card creation (up to five), freeze/unfreeze, payment review/cancel/rehearsal, reduced-motion support, keyboard controls, modal focus containment and return focus. No PAN, CVV or other card credentials are collected. The preview does not attempt NFC or wallet provisioning.

## UX priorities

1. Validate the vertical deck on physical phones: one-handed selection, clear selected state, comfortable scrolling between the deck and page, and readable cards at large text sizes. Test whether users prefer vertical cards to a horizontal carousel before making cards the main navigation.
2. Keep the everyday flow short: choose card → review payment → confirmation. Show pending, declined, reversed and offline outcomes with recovery actions once a real provider supplies their meaning. Never infer settlement from a tap animation.
3. Distinguish adding an existing funding card from requesting an issued spending card. The current Add action adds a sample only; real flows need separate entry points and provider-hosted collection/provisioning.
4. Add card controls and history backed by confirmed provider state: freeze, limits, default card, replacement and dispute/support entry. Do not optimistically claim a real card is frozen before acknowledgement.

## Integration work after partner selection

This is UX preparation, not a production card integration. Choose an issuer/processor and supported markets first. Obtain their SDK/API contracts, sandbox access, supported wallet provisioning paths and a confirmed product scope. Legal and partner eligibility remain external launch decisions.

Build an authenticated backend card adapter for listing, issuing/provisioning, freezing and retrieving card activity. Keep credentials server-side. Use provider-hosted sensitive-data views and collection; store only provider identifiers and permitted display metadata. Add ownership checks, idempotency, webhook authentication/deduplication and reconciliation against provider state. Model pending and failed operations explicitly.

Expose server-derived availability separately for issuance, adding funding cards, wallet provisioning and contactless payments. Missing configuration must mean unavailable. Do not turn this preview into a live mode with a frontend flag or connect its simulated success handler to payment endpoints.

Implement Apple/Google wallet provisioning and any supported native contactless path only against the selected partner's supported SDK and platform entitlements. The web preview cannot communicate with a payment terminal. Native delivery and device testing are separate work.

Before release, exercise provider sandbox declines, timeouts, repeated requests, webhook reordering, interrupted provisioning, freeze failures, lost devices and reconciliation. Validate accessibility and the final disclosure/copy against the agreed product. Keep simulation records separate from real card transactions.

## Validation

`yarn workspace @fpay/web typecheck`

`yarn workspace @fpay/web check:campaign:browser`

The browser fixture uses the real components and checks adding/selecting/freezing, cancel and rehearsal, narrow-to-desktop overflow, Escape/focus restoration, and no API writes or wallet calls during card exploration. It also retains the existing campaign flow regression checks. Physical-device smoothness, native wallet provisioning and real card processing are not covered by this fixture.
