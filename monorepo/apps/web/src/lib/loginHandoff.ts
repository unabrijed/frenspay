import { isValidEmail, normalizeEmail } from '@fpay/shared';

const KEY = 'fpay:email-login';
export type LoginHandoff = { email: string; sentAt?: number; createdAt: number };
let memory: LoginHandoff | null = null;

/** Only a hint. The server always derives identity from the verified Dynamic session. */
export function readLoginHandoff(): LoginHandoff | null {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const email = normalizeEmail(hash.get('email') ?? '');
  if (hash.get('login') === '1' && isValidEmail(email)) {
    memory = { email, createdAt: Date.now() };
    saveLoginHandoff(memory);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  try {
    memory ??= JSON.parse(sessionStorage.getItem(KEY) || 'null') as LoginHandoff | null;
  } catch { /* storage unavailable */ }
  if (memory && (typeof memory.email !== 'string' || !isValidEmail(memory.email)
    || !Number.isFinite(memory.createdAt) || Date.now() - memory.createdAt > 30 * 60_000)) {
    saveLoginHandoff(null);
  }
  return memory;
}

export function saveLoginHandoff(value: LoginHandoff | null) {
  memory = value;
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch { /* keep the in-memory flow when storage is unavailable */ }
}
