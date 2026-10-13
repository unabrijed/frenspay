'use client';
import { SheetHost } from './SheetHost';
import { ToastHost } from './ToastHost';
import { SuspendedGate } from './SuspendedGate';

export default function ProductOverlayContent() {
  return <><SheetHost /><ToastHost /><SuspendedGate /></>;
}
