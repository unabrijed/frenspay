/** Singapore early access: credits are backend numbers, never a token or a cash balance. */
export interface PrelaunchAccount {
  id: string;
  email: string;
  walletAddress: string;
  name: string;
  country: string;
  phoneVerified: boolean;
  xLinked: boolean;
  multiplier: number;
  peakUsdc: string;
  realUsdc: string | null;
  balanceCheckedAt: string | null;
  rewardCredits: string;
  practiceCredits: string;
  points: string;
  fundingAvailable: boolean;
  receiptsAvailable: boolean;
  phoneAvailable: boolean;
}
export interface PrelaunchQuote {
  id: string;
  recipientName: string;
  amountSgd: string;
  credits: string;
  sgdPerUsd: string;
  estimatedRate: boolean;
  expiresAt: string;
}
export interface PrelaunchSpend {
  id: string;
  recipientName: string;
  amountSgd: string;
  credits: string;
  practiceCredits: string;
  points: string;
  createdAt: string;
  receiptStatus: 'pending' | 'submitted' | 'confirmed' | 'review';
  receiptHash: string | null;
  commitment: string;
}
export interface PrelaunchTransaction {
  chainId: 143;
  to: `0x${string}`;
  data: `0x${string}`;
  value: '0x0';
}
