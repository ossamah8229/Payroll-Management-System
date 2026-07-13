/**
 * The single source of truth for the batch Payslip generation limit (Phase 4 Checkpoint 6.3.2) —
 * the backend enforces this as the hard, authoritative cap on `POST .../payslips/batch`; the
 * frontend imports the same constant so its own pre-submission messaging ("N of 300 selected")
 * never drifts from what the server will actually accept. Deliberately a fixed, named constant,
 * not configurable at runtime — this is a bounded-batch-size *architecture* decision (Checkpoint
 * 6.3's own approved review), not a tunable.
 */
export const MAX_BATCH_PAYSLIPS_PER_REQUEST = 300;
