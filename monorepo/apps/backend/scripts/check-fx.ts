// check-fx.ts — M7 live FX harness. Pure (no DB): asserts the fallback before any fetch, the range
// validation (a bad/garbage rate can't poison a quote), a bad source keeps the fallback, and a
// best-effort live fetch returns a sane INR rate (warns — not fails — if the network is down).
// Run: yarn workspace @pay/backend tsx scripts/check-fx.ts
import { config } from '../src/config';
import {
  _resetFxCacheForTest,
  getMidRate,
  getMidRateAsOf,
  parseRate,
  refreshMidRate,
} from '../src/services/fxRate';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  _resetFxCacheForTest();
  check('fallback returned before any fetch', getMidRate() === config.fxFallbackRate, `₹${getMidRate()}`);
  check('asOf is null before any fetch', getMidRateAsOf() === null);

  // Range validation — a bad source value must be rejected so it can't price a quote.
  check('parseRate accepts a sane value', parseRate({ rates: { INR: 84.2 } }) === 84.2);
  check('parseRate rejects out-of-range high', parseRate({ rates: { INR: 999 } }) === null);
  check('parseRate rejects out-of-range low', parseRate({ rates: { INR: 5 } }) === null);
  check('parseRate rejects a non-number', parseRate({ rates: { INR: 'x' } }) === null);
  check('parseRate rejects a missing rate', parseRate({}) === null);
  check('parseRate rejects a null body', parseRate(null) === null);

  // A failing source keeps the previous good value (the fallback here) — never poisons the cache.
  await refreshMidRate(undefined, 'https://invalid.invalid.invalid/none');
  check('bad source keeps the fallback (no poison)', getMidRate() === config.fxFallbackRate);

  // Best-effort live fetch.
  await refreshMidRate();
  if (getMidRateAsOf()) {
    const r = getMidRate();
    check('live fetch returns a sane INR rate', r >= 50 && r <= 150, `₹${r} as of ${getMidRateAsOf()}`);
  } else {
    console.log('⚠ live fetch unavailable (offline?) — fallback retained; not counted as a failure');
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
