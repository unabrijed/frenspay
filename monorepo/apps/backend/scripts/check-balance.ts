// check-balance.ts — the /balance read path, against a COUNTING fake RPC on localhost. No network,
// no DB (the check:all contract). The count is the whole point: the production bug was five
// concurrent balance reads each doing their own getMint, because decimals() cached the resolved
// VALUE instead of the in-flight promise. That burst tipped the public RPC into throttling, and a
// throttled RPC answers with a null account — which spl-token reports as TokenAccountNotFoundError
// carrying an EMPTY message, so /balance returned a 500 that said literally nothing.
//
// The asserts below pin the three properties that fix costs: one mint fetch per process however
// many callers race, a failed fetch that does NOT poison the cache, and a hard RPC failure that
// THROWS rather than reporting a fabricated zero. That last one is a money bug, not a UX one:
// "0" and "I couldn't reach the chain" must never be the same answer.
// Run: yarn workspace @fpay/backend check:balance
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const DECIMALS = 6;

/** 82-byte SPL mint: decimals sits at offset 44, initialized at 45. */
function mintData(): string {
  const b = Buffer.alloc(82);
  b.writeUInt32LE(0, 0); // no mint authority
  b.writeBigUInt64LE(1_000n, 36); // supply
  b.writeUInt8(DECIMALS, 44);
  b.writeUInt8(1, 45); // isInitialized
  return b.toString('base64');
}

/** 165-byte SPL token account: amount at 64 (LE u64), state at 108 (1 = initialized). */
function tokenAccountData(amount: bigint): string {
  const b = Buffer.alloc(165);
  b.writeBigUInt64LE(amount, 64);
  b.writeUInt8(1, 108);
  return b.toString('base64');
}

// --- the fake RPC ------------------------------------------------------------------------------
// `mode` is flipped between phases to simulate an RPC that fails and then recovers.
type Mode = 'mint-fails' | 'healthy' | 'ata-missing' | 'ata-fails';
let mode: Mode = 'mint-fails';
const hits: Record<string, number> = {};

function start(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rpc = JSON.parse(body || '{}') as { id?: number; method?: string; params?: unknown[] };
      const pubkey = String(rpc.params?.[0] ?? '');
      hits[pubkey] = (hits[pubkey] ?? 0) + 1;

      const send = (result: unknown) =>
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? 1, result }),
        );
      const account = (data: string) =>
        send({
          context: { slot: 1 },
          value: { data: [data, 'base64'], executable: false, lamports: 1, owner: TOKEN_PROGRAM, rentEpoch: 0 },
        });
      const nullAccount = () => send({ context: { slot: 1 }, value: null });

      const isMint = pubkey === MINT;
      if (mode === 'mint-fails' && isMint) return nullAccount();
      if (mode === 'ata-missing' && !isMint) return nullAccount();
      if (mode === 'ata-fails' && !isMint) {
        // A hard transport failure, distinct from "account not found".
        return res.writeHead(503).end('rpc down');
      }
      return isMint ? account(mintData()) : account(tokenAccountData(2_500_000n)); // 2.5 USDC
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    ),
  );
}

// A real on-curve address; the mint is Circle's mainnet USDC so the fake serves the same pubkey
// the code under test asks for. Neither is ever contacted — only this localhost server is.
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OWNER = 'So11111111111111111111111111111111111111112';

async function main() {
  const { server, url } = await start();

  // Set BEFORE importing envConfig: dotenv does not override an already-set process.env value, so
  // this beats apps/backend/.env. Dynamic import because static imports hoist above assignments.
  process.env.NODE_ENV = 'stage';
  process.env.STAGE_SOLANA_RPC_URL = url;
  process.env.STAGE_USDC_MINT = MINT;
  const { decimals, getUsdcBalance } = await import('../src/services/solana');

  // 1. A failing mint read rejects — and must not be remembered as a permanent failure.
  let rejected = false;
  await decimals().catch(() => (rejected = true));
  check('mint unreadable → decimals() rejects', rejected);

  // 2. The recovery + the dedupe, in one shot. If the cache had kept the rejection above, every
  //    call here fails; if it cached a value instead of a promise, the mint is fetched five times.
  mode = 'healthy';
  const before = hits[MINT] ?? 0;
  const results = await Promise.all(Array.from({ length: 5 }, () => getUsdcBalance(OWNER)));
  check('rejection is not cached — a later read recovers', results.every((r) => r === '2.500000'), results[0]);
  check(
    'five concurrent reads fetch the mint ONCE (the regression)',
    (hits[MINT] ?? 0) - before === 1,
    `${(hits[MINT] ?? 0) - before} fetch(es)`,
  );

  // 3. An absent token account is a REAL zero — the one case allowed to answer "0".
  mode = 'ata-missing';
  check('unfunded ATA → 0.000000', (await getUsdcBalance(OWNER)) === '0.000000');

  // 4. An RPC failure is NOT a zero. It must throw so the route can 503 (routes/money.ts).
  mode = 'ata-fails';
  let threw = false;
  await getUsdcBalance(OWNER).catch(() => (threw = true));
  check('RPC failure throws rather than reporting an empty wallet', threw);

  // 5. An invalid owner never reaches the network at all.
  check('garbage address → 0.000000 without an RPC call', (await getUsdcBalance('not-a-pubkey')) === '0.000000');

  server.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
