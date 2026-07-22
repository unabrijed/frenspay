# 15 — KYC testing runbook (sim + Didit)

How to exercise identity verification locally. There are **two providers** behind one API
(`POST /kyc/verify`), selected by `KYC_PROVIDER` (env `STAGE_KYC_PROVIDER` in dev/stage):

| Provider | When | Behaviour |
| --- | --- | --- |
| `sim`   | default in local/development | Instant tier‑2 promote, no documents. `verifyDone()` gets `{ ok, kycTier: 2 }` and continues the pay flow immediately. |
| `didit` | default in stage/prod | Real hosted document + liveness flow. `verifyDone()` gets `{ url, sessionId }`, redirects the browser to Didit; the tier is raised later by the reconciler poller / webhook. |

NODE_ENV picks the default; override per tier with `<PREFIX>_KYC_PROVIDER` (e.g.
`STAGE_KYC_PROVIDER=sim` to force sim on stage, `LOCAL_KYC_PROVIDER=didit` for the real flow locally).

KYC gates **merchant pay** (needs tier ≥ 2). A tier‑1 user who scans a merchant/UPI QR is routed to
the Verify sheet first (`payMerchant` → `open('verify')`).

---

## A. Sim flow (zero setup — local default, or `STAGE_KYC_PROVIDER=sim` on stage)

1. `yarn backend` and `yarn web`.
2. Sign up through onboarding → land on Home.
3. Settings → **Verify identity** (or scan a merchant QR, which routes to Verify).
4. Tap **Verify identity** → instantly promoted to **tier 2**; the pay flow resumes.
5. Re‑test: Settings → **Reset for testing** (dev‑only) → `POST /sim/kyc/1` sets the backend tier
   back to 1, clears local state, logs out → sign in again to repeat.

## B. Real Didit flow (end‑to‑end)

**Credentials** — Didit Business Console → *API & Webhooks* for the API key; the workflow id comes
from the Verifications workflow you build in the no‑code editor.

1. In `apps/backend/.env` (didit is already the default under `NODE_ENV=stage` — no
   `STAGE_KYC_PROVIDER` line needed):
   ```
   STAGE_DIDIT_API_KEY=<your key>
   STAGE_DIDIT_WORKFLOW_ID=<your workflow id>
   # STAGE_DIDIT_WEBHOOK_SECRET=<optional locally — poller reconciles without it>
   ```
   Missing key/workflow with `didit` selected → the server **refuses to boot**
   (`assertKycConfig`), by design.
2. `yarn backend` (boots the 15s reconciler poller because the provider is `didit`) and `yarn web`.
3. Onboard → Settings → **Verify identity**.
4. You're redirected to Didit's hosted flow (document + liveness, ~2 min). Complete it.
5. Didit redirects back to `…/home?verificationSessionId=…`. The Home effect calls `pollKyc()`,
   which polls `/me` every 3s (≤ ~60s). Meanwhile the backend reconciler (every 15s) fetches the
   **authoritative decision** (`GET /v3/session/{id}/decision/`) and, on `approved`, upgrades the
   tier + sends a notification. The tier flips to 2 and any interrupted merchant‑pay resumes.
6. Re‑test: Settings → **Reset for testing**, or sign in with a fresh email.

### Instant approval (optional)
The webhook (`POST /webhooks/kyc`) is only a "check this session now" ping — the poller is the
reliable path. To make approval feel instant, expose the backend (e.g. a tunnel) so Didit can reach
`https://<host>/webhooks/kyc`, and set `STAGE_DIDIT_WEBHOOK_SECRET`. Signature verification is
best‑effort; the decision poll is authoritative regardless, so a signature‑format drift only
disables the fast‑path, never correctness.

### Decision states (poller)
`approved` → tier 2. `declined` → terminal, surfaced to the user. `expired` / `abandoned` →
cleared to `none` so the reconciler stops polling a dead session and the user can start over.
`in_review` / `pending` → keep polling.

---

## Key files

- Provider select + boot guard: `apps/backend/src/services/kyc/index.ts`, `config.ts` (70–77),
  `server.ts` (`assertKycConfig`).
- Didit vendor calls: `apps/backend/src/services/kyc/didit.ts`. Reconciler: `.../poller.ts` (15s).
- Endpoints: `apps/backend/src/routes/index.ts` — `POST /kyc/verify`, `POST /webhooks/kyc`,
  dev‑only `POST /sim/kyc/:tier`.
- Frontend: `apps/web/src/store/usePayStore.ts` — `verifyDone()`, `pollKyc()`, `resetForTesting()`;
  entry sheet `components/sheets/identity.tsx`; `app/settings/page.tsx` (dev "Reset for testing").
