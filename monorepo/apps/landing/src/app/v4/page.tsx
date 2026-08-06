import type { Metadata } from 'next';

import { ThingsHero } from '@/components/frenspay/things-hero';

// Design experiment: kept out of the index while / stays the shipped landing.
export const metadata: Metadata = {
  title: 'things between frens',
  description: 'frens play. frens stay. frens stray. frens pay.',
  robots: { index: false, follow: false },
};

export default function V4Page() {
  return <ThingsHero />;
}
