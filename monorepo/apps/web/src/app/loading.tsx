// Navigation keeps the existing app shell; only the incoming page needs a small placeholder.
import { LoadingStatus } from '@/components/ui/LoadingStatus';

export default function Loading() {
  return <div style={{padding:'32px 24px'}}><LoadingStatus label="Opening page…" /></div>;
}
