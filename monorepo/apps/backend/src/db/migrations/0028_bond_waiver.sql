-- 0028_bond_waiver
-- Runs once, inside a transaction. Forward-only: to undo, write another migration.
--
-- WHY. Approval never lifted the stake floor. An approved partner with no bond could not go online,
-- was not routable, and could not lock an order (MIN_BOND: four SQL gates plus the routing math), so
-- the first partners were approved and still idle. For onboarding and testing, a root admin may now
-- let ONE partner work before staking, for a fixed time, on the record.
--
-- WHAT. One nullable timestamp. While it is in the future the partner counts as holding exactly the
-- floor: they may go online, are routable, and may carry MIN_BOND in flight, flat, never leveraged
-- by tier. Every bond gate reads it as `or bond_waived_until > now()` (listRoutableMerchants,
-- setMerchantOnlineSelf, reinstateBondSuspendedMerchant, lockOrder) and the JS math through
-- merchantStats.bondCap. It never touches bond_usdc or the bond ledger. The first upheld dispute
-- clears it in the same statement that draws the bond (drawDownBond); granting it and the bond
-- auto-reinstate both require the owner to be an active user. Root admin only, audited
-- (admin_actions: stake_waive / stake_waiver_end). The partner is never shown it: GET /me reports
-- the floor as 0 and the console walks them to "You're ready".

alter table merchants add column if not exists bond_waived_until timestamptz;
