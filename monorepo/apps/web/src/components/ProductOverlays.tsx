 'use client';
import { SIMULATION_MODE } from '@/services/envConfig';
import dynamic from 'next/dynamic';
const ProductOverlayContent = dynamic(() => import('./ProductOverlayContent'), {ssr:false});
export function ProductOverlays() {
  return SIMULATION_MODE ? null : <ProductOverlayContent />;
}
