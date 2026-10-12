/** Only the disposable pay-store view is migrated. Wallet/auth/payment recovery keys are separate. */
export function migrateProductCache(persisted: unknown, version: number): Record<string, unknown> {
  const state =
    persisted && typeof persisted === 'object' && !Array.isArray(persisted)
      ? ({ ...persisted } as Record<string, unknown>)
      : {};
  delete state.kyc;
  if (version < 2) delete state.displayCurrency;
  for (const key of [
    'onboarded',
    'handle',
    'kycTier',
    'identityCheckAvailable',
    'balanceUSD',
    'transactions',
    'fxRate',
    'fxRates',
  ])
    delete state[key];
  return state;
}
