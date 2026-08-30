// push.ts — push notifications for the phone app, via Expo's push service: one POST, no SDK, no
// credentials on our side (Expo holds the FCM key for the project). Best-effort and fire-and-forget:
// a push must never fail, slow or order a money-movement path, which is why notify() does not await it.
//
// ponytail: tickets are read only to drop dead tokens (DeviceNotRegistered); receipts — the second
// round-trip that reports delivery failures — are not fetched. Add them when a "did it arrive?"
// question actually comes up.
import { deletePushTokens, listPushTokens } from '../db/queries';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo's per-request maximum

type Ticket = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };

export async function sendPush(userId: string, title: string, body: string | undefined, data: Record<string, unknown>): Promise<void> {
  const tokens = await listPushTokens(userId);
  if (tokens.length === 0) return;
  const dead: string[] = [];
  for (let i = 0; i < tokens.length; i += BATCH) {
    const chunk = tokens.slice(i, i + BATCH);
    const res = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(chunk.map((to) => ({ to, title, body, data, sound: 'default' }))),
    });
    if (!res.ok) continue; // a 4xx/5xx from Expo is theirs to fix; nothing to learn per token
    const { data: tickets } = (await res.json()) as { data?: Ticket[] };
    tickets?.forEach((t, j) => {
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(chunk[j]);
    });
  }
  await deletePushTokens(dead);
}
