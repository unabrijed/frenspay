import { readRef } from '@/components/ref';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class WaitlistApiError extends Error {
  constructor(readonly status: number) {
    super(`Waitlist request failed with ${status}`);
    this.name = 'WaitlistApiError';
  }
}

export async function joinWaitlist(email: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API}/waitlist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, ref: readRef() ?? undefined }),
    signal,
  });

  if (!response.ok) throw new WaitlistApiError(response.status);
}
