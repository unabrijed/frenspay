// Deliberately separate from wallet balances, payment APIs and persisted account data.
// These are design samples, never provider-issued cards or payment credentials.
export type PreviewCard = { id: number; name: string; tone: 'petrol' | 'rust' | 'sage'; frozen: boolean };
export const initialPreviewCards: PreviewCard[] = [
  { id: 1, name: 'Everyday', tone: 'petrol', frozen: false },
  { id: 2, name: 'Travel', tone: 'rust', frozen: false },
];
export function canRehearsePayment(card: PreviewCard | undefined): boolean {
  return !!card && !card.frozen;
}
