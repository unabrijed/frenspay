import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const targets = JSON.parse(readFileSync(new URL('./preview-targets.json', import.meta.url), 'utf8'));
const [target, ...flags] = process.argv.slice(2);
if (!Object.hasOwn(targets, target) || flags.some(flag => flag !== '--build-only')) {
  console.error('Usage: node scripts/preview-web.mjs stage|production [--build-only]');
  process.exit(1);
}
const buildOnly = flags.includes('--build-only');
if (!buildOnly) {
  const probe = createServer();
  try {
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(3000, '127.0.0.1', resolve);
    });
    await new Promise(resolve => probe.close(resolve));
  } catch {
    console.error('Port 3000 is busy. Stop the customer dev server before starting a preview.');
    process.exit(1);
  }
}

const config = targets[target];
const prefix = target === 'stage' ? 'NEXT_PUBLIC_STAGE_' : 'NEXT_PUBLIC_';
const env = {
  ...process.env,
  NODE_ENV: 'production',
  FPAY_PREVIEW_TARGET: target,
  NEXT_PUBLIC_APP_ENV: target,
  [`${prefix}API_URL`]: '/__preview_api',
  [`${prefix}DYNAMIC_ENVIRONMENT_ID`]: config.dynamicEnvironmentId,
  [`${prefix}CUSTOMER_PAYMENT_MODE`]: 'simulation',
  [`${prefix}LANDING_URL`]: 'https://frenspay.xyz',
};
console.log(`Building ${target} customer UI with sandbox services: API ${config.apiUrl}, Dynamic ${config.dynamicEnvironmentId}`);
console.log('Both previews use stage data and sandbox login. Production services are not selected.');
console.log('Only the frontend runs locally; no local backend workers or migrations are started.');
const cwd = fileURLToPath(new URL('../apps/web/', import.meta.url));
const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
let child;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child?.kill(signal));
}
async function run(args) {
  const code = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [next, ...args], { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 130 : 1)));
  });
  if (code !== 0) process.exit(code);
}
await run(['build']);
if (!buildOnly) await run(['start', '--hostname', '127.0.0.1', '--port', '3000']);
