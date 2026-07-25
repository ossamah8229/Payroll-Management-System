-- Presentation & Workflow Stabilization Checkpoint (2026-07-25) — Advance lifecycle fix, part 2.
-- Widens the two constraints that previously only recognized 'ACTIVE'/'PAID_OFF' to also cover the
-- new 'RESERVED' status (added in 20260725090000_advance_reserved_status, now safe to reference in
-- a later transaction):
--
-- 1. The "at most one live Advance per employee per type" partial unique index must also block a
--    second Advance of the same type while the first is RESERVED (balance already zero, but not
--    yet released/confirmed) — the whole point of RESERVED is that it is not yet final.
-- 2. The "no PAID_OFF Advance still has a live scheduled period" check constraint applies equally
--    to RESERVED, which the application layer already clears `currentScheduledPeriodId` for at the
--    same moment it sets the status (`materializeOneAdvanceDeduction`, advances.service.ts).

DROP INDEX "Advance_employeeId_type_active_key";
CREATE UNIQUE INDEX "Advance_employeeId_type_active_key" ON "Advance"("employeeId", "type") WHERE "status" IN ('ACTIVE', 'RESERVED');

ALTER TABLE "Advance" DROP CONSTRAINT "Advance_paidoff_no_current_period_check";
ALTER TABLE "Advance" ADD CONSTRAINT "Advance_paidoff_no_current_period_check" CHECK ("status" NOT IN ('PAID_OFF', 'RESERVED') OR "currentScheduledPeriodId" IS NULL);
