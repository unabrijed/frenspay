// Route/Suspense fallback — shows the boot splash during navigation and on-demand route loads
// instead of a blank frame.
import { Splash } from '@/components/ui/Splash';

export default function Loading() {
  return <Splash />;
}
