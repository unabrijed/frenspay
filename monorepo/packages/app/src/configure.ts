// configure.ts — boot. Each app calls this once, at the top of its root layout module, with its
// Platform. Order matters and is the whole reason this exists: the store module evaluates before
// any platform is known, so it is created with hydration SKIPPED and hydrated from here.
import { type Platform, setPlatform } from './platform';
import { DevKeypairSigner, setActiveSigner } from './services/signer';
import { usePayStore } from './store';

export function configure(p: Platform): void {
  setPlatform(p);
  // Dev signing path (no Privy): a seeded keypair from apps/backend/.devnet/keys.json. The Privy
  // bridge replaces it via setActiveSigner() once the user logs in.
  if (p.env.devSecretKey) {
    try {
      setActiveSigner(new DevKeypairSigner(JSON.parse(p.env.devSecretKey) as number[], p.env.solanaRpcUrl));
    } catch {
      /* malformed DEV_SECRET_KEY — leave unset; transfer() surfaces a clear error */
    }
  }
  // Without Privy there is no session to resolve: auth is "ready" the moment the platform is.
  if (!p.env.useDynamic) usePayStore.setState({ authReady: true });
  void usePayStore.persist.rehydrate();
}
