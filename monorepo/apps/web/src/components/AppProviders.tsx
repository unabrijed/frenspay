'use client';
import { configure } from '@fpay/app';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Splash } from '@/components/ui/Splash';
import { webPlatform } from '@/platform';
configure(webPlatform);
const DynamicRoot = dynamic(() => import('@/services/dynamic/DynamicRoot'), {ssr:false,loading:()=><Splash />});
export function AppProviders({children}:{children:ReactNode}) {
  const pathname = usePathname();
  if (['/wallet-recovery','/legacy-wallet'].includes(pathname)) return <>{children}</>;
  return <DynamicRoot>{children}</DynamicRoot>;
}
