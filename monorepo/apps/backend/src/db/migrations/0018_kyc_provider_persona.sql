-- KYC vendor moved from Didit to Persona (services/kyc/persona.ts). The reconciler asks the CURRENT
-- provider about every open session, so a Didit row left pending would make every 15s pass 404 at
-- Persona and abort. Clear the open Didit rows back to 'none' — the user simply starts a fresh
-- verification; approved/declined rows are history and untouched.
update users
   set kyc_status = 'none', kyc_session_id = null
 where kyc_provider = 'didit'
   and kyc_status in ('pending', 'in_review');
