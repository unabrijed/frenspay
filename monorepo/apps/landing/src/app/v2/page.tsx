import type { Metadata } from 'next';

import { FrensPayV2Landing } from '@/components/frenspay-v2/frenspay-landing';

export const metadata: Metadata = {
  title: 'FrensPay — between frens',
  description: 'something for people who know people.',
};

export default function V2Page() {
  return <FrensPayV2Landing />;
}
