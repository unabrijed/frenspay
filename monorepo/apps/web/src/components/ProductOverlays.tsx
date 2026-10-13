 'use client';
import { SIMULATION_MODE } from '@/services/envConfig';
import { SheetHost } from './SheetHost';
import { ToastHost } from './ToastHost';
import { SuspendedGate } from './SuspendedGate';
export function ProductOverlays() {
  return SIMULATION_MODE ? null : <><SheetHost /><ToastHost /><SuspendedGate /></>;
}
