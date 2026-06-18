// Entry gate: first run → onboarding; otherwise straight to Home.
import { Redirect } from 'expo-router';

import { usePayStore } from '@/store/usePayStore';

export default function Index() {
  const onboarded = usePayStore((s) => s.onboarded);
  return <Redirect href={onboarded ? '/home' : '/onboarding/welcome'} />;
}
