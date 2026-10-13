import { create } from 'zustand';
import type { CampaignAccount, CampaignSpend } from '@fpay/shared';

/** Server values only. Never hydrate credits/points from the legacy payment cache. */
export const useCampaignStore = create<{
  owner: string | null; account: CampaignAccount | null; history: CampaignSpend[];
  reset: (owner: string | null) => void;
  update: (owner: string, account: CampaignAccount, history?: CampaignSpend[]) => void;
}>((set) => ({
  owner: null, account: null, history: [],
  reset: owner => set({ owner, account: null, history: [] }),
  update: (owner, account, history) => set(state => state.owner !== owner ? state :
    { account, ...(history ? { history } : {}) }),
}));
