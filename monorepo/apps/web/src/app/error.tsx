'use client';

import { RecoveryState } from '@/components/RecoveryState';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main style={{ flex: 1, overflowY: 'auto', display: 'grid', alignItems: 'center', padding: 24 }}>
    <RecoveryState title="This screen hit a snag" description="We couldn’t finish opening this screen. Try again to pick up where you left off. If you were making a payment, check your activity before submitting it again."
      actionLabel="Try again" onAction={reset}>
      <a href="/">Back to home</a>
    </RecoveryState>
  </main>;
}
