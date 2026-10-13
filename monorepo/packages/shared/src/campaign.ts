/** Real wallet funds and simulation credits are deliberately separate values. */
export interface CampaignAccount {
  id: string; email: string; walletAddress: string; name: string; country: string;
  phoneVerified: boolean; xLinked: boolean; multiplier: number; peakUsdc: string;
  realUsdc: string | null; balanceCheckedAt: string | null; rewardCredits: string;
  practiceCredits: string; points: string; fundingAvailable: boolean; receiptsAvailable: boolean;
  phoneAvailable: boolean; badges: string[]; suspended: boolean;
}
export interface CampaignQuote {
  id: string; recipientName: string; payeeVpa: string; amountInr: string;
  credits: string; inrPerUsd: string; estimatedRate: boolean; expiresAt: string;
}
export interface CampaignSpend {
  id: string; recipientName: string; payeeVpa: string; amountInr: string; credits: string;
  points: string; createdAt: string; receiptStatus: 'simulated' | 'pending' | 'submitted' | 'confirmed' | 'review';
  receiptHash: string | null; commitment: string;
}
export interface CampaignCapabilities {
  authProvider?: 'privy' | 'dynamic';
  mode: 'live' | 'simulation'; campaignId: 'monad-upi-2026'; spendingEnabled: boolean;
  fundingEnabled: boolean; receiptChainId: 10143 | null; fundingChainId: 143;
}
export interface CampaignAnalytics {
  summary: Record<string, string>;
  payees: { payee_vpa: string; recipient_name: string; participants: string; simulations: string; amount_inr: string }[];
  categories: { category: string; simulations: string }[];
  cities: { city: string; simulations: string }[];
  receipts: { receipt_status: string; count: string }[];
  accounts: { id: string; email: string; is_test: boolean; suspended: boolean; points: string }[];
  errors: { unavailable: number; rejected: number };
}
