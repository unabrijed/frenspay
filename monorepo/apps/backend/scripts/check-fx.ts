// check-fx.ts — live-FX harness, per-currency since the Indonesia corridor. Pure by default (no DB,
// no network — safe in check:all); set FX_CHECK_LIVE=1 for a best-effort live fetch on top.
// The cross-currency asserts are the point: the pre-corridor bug class was a wrong-currency value
// that LOOKED plausible (an INR-magnitude number quoting IDR ~200× off), so every band must reject
// the other corridor's magnitude, and a currency without a band must never price at all.
// Run: yarn workspace @fpay/backend tsx scripts/check-fx.ts
import { config } from '../src/envConfig';
import {
  _resetFxCacheForTest,
  FX_BANDS,
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

  // Every banded currency has a fallback inside its own band, served before any fetch.
  for (const ccy of Object.keys(FX_BANDS)) {
    const fb = config.fxFallbackRates[ccy];
    const band = FX_BANDS[ccy];
    check(`${ccy}: fallback exists and sits inside its band`, typeof fb === 'number' && fb >= band.min && fb <= band.max, String(fb));
    check(`${ccy}: fallback returned before any fetch`, getMidRate(ccy) === fb);
    check(`${ccy}: getMidRate is finite (no NaN into money math)`, Number.isFinite(getMidRate(ccy)));
    check(`${ccy}: asOf is null before any fetch`, getMidRateAsOf(ccy) === null);
  }

  // Range validation per currency — a sane value passes ITS band and fails every other band.
  check('INR: sane value accepted', parseRate({ rates: { INR: 95.25 } }, 'INR') === 95.25);
  check('SGD: sane value accepted', parseRate({ rates: { SGD: 1.35 } }, 'SGD') === 1.35);
  check('SGD: INR-magnitude value rejected', parseRate({ rates: { SGD: 95.25 } }, 'SGD') === null);
  check('SGD: IDR-magnitude value rejected', parseRate({ rates: { SGD: 17_862 } }, 'SGD') === null);
  check('SGD: outside its own band rejected', parseRate({ rates: { SGD: 0.1 } }, 'SGD') === null);
  check('IDR: sane value accepted', parseRate({ rates: { IDR: 17862.19 } }, 'IDR') === 17862.19);
  check('IDR: dust value rejected', parseRate({ rates: { IDR: 1.5 } }, 'IDR') === null);
  check('IDR: INR-magnitude value rejected', parseRate({ rates: { IDR: 95.25 } }, 'IDR') === null);
  check('INR: IDR-magnitude value rejected', parseRate({ rates: { INR: 17862 } }, 'INR') === null);
  check('parseRate reads the REQUESTED currency, never a sibling', parseRate({ rates: { INR: 95.25 } }, 'IDR') === null);
  check('unknown currency never prices (the PHP guard)', parseRate({ rates: { PHP: 60.83 } }, 'PHP') === null);
  check('non-number rejected', parseRate({ rates: { INR: 'x' } }, 'INR') === null);
  check('missing rate rejected', parseRate({}, 'INR') === null);
  check('null body rejected', parseRate(null, 'INR') === null);
  check('getMidRate throws on a currency without a band/fallback', (() => {
    try {
      getMidRate('PHP');
      return false;
    } catch {
      return true;
    }
  })());

  // A failing source keeps the previous good value (the fallbacks here) — never poisons the cache.
  await refreshMidRate(undefined, 'https://invalid.invalid.invalid/none');
  check('bad source keeps every fallback (no poison)',
    Object.keys(FX_BANDS).every((c) => getMidRate(c) === config.fxFallbackRates[c]));

  // A response carrying one good and one garbage currency updates ONLY the good one.
  const half = { rates: { INR: 95.25, IDR: 2 } };
  for (const ccy of Object.keys(FX_BANDS)) {
    const r = parseRate(half, ccy);
    if (ccy === 'INR') check('partial payload: INR parses', r === 95.25);
    else check(`partial payload: ${ccy} garbage rejected independently`, r === null);
  }

  // Best-effort live fetch — opt-in so check:all stays offline-fast (root package.json contract).
  if (process.env.FX_CHECK_LIVE === '1') {
    await refreshMidRate();
    if (getMidRateAsOf('INR')) {
      for (const ccy of Object.keys(FX_BANDS)) {
        const band = FX_BANDS[ccy];
        const r = getMidRate(ccy);
        check(`${ccy}: live rate in band`, r >= band.min && r <= band.max, `${r} as of ${getMidRateAsOf(ccy)}`);
      }
    } else {
      console.log('⚠ live fetch unavailable (offline?) — fallbacks retained; not counted as a failure');
    }
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
