# Version 1.0 — Data-Volume Sanity Test

Performed 2026-07-20 against the production build (`NODE_ENV=production`, behind the TLS-simulating
proxy), against `payroll_clean_rc1` seeded with a synthetic dataset generated directly via Prisma
(`backend/scripts/rc1-bulk-seed.ts`, not committed — a throwaway generator for this test only).

## Dataset generated

- 1,502 employees total (1,500 synthetic + 2 from the Step 7 lifecycle test), CNICs/employee codes
  unique, distributed across sites/units, ~60% bank-paid / 40% cash.
- 4 Project Sites ("RC1 North/South/East/West Zone"), 12 Project Units (3 per site).
- 3 additional banks.
- 13 internal users total (1 Master Admin + 12 synthetic, roles cycled across the non-Master-Admin
  roles) — within the 5–15 target range.
- A full payroll cycle bootstrap was run against all 1,502 active employees (via
  `archive-and-create-next`, which both archives the prior cycle and bootstraps the new one in one
  transaction).

## Measured operations (production build, warm database, single run — this is a sanity check, not a
## load-tested benchmark; single-sample timings, not averaged/percentiled)

| Operation | Scale | Time | Result |
|---|---|---|---|
| Bulk payroll bootstrap (`archive-and-create-next`: archive outgoing cycle + generate its Backup Package + bootstrap 1,502 entries for the new Draft cycle, one DB transaction) | 1,502 employees | **0.71s** | Pass |
| Payroll entry list load, default page | 1,502 entries in cycle | 0.052s | Pass |
| Payroll entry list load, pageSize=500 | 1,502 entries in cycle | 0.065s | Pass |
| Employee list load, default page | 1,502 employees | 0.198s | Pass |
| Employee list load, pageSize=100 | 1,502 employees | 0.185s | Pass |
| Employee search/filter (`?search=...`) | 1,502 employees | 0.013s | Pass |
| Project Unit release | ~125 employees in the unit | 0.128s | Pass |
| Bank sheet generation (JSON, site-filtered) | ~500 employees (site) | 0.009s | Pass |
| Cash receiving sheet generation (JSON, site-filtered) | ~500 employees (site) | 0.015s | Pass |
| Payslip batch ZIP (real Puppeteer PDF rendering per employee) | 17 employees | 4.83s (≈ 284ms/payslip) | Pass |
| Review Queue load (`?status=PENDING`) | current dataset | 0.008s | Pass |
| Corrections Ledger load | current dataset | 0.020s | Pass |
| Project Sites list | 5 sites | 0.006s | Pass |

## Interpretation

- Every database-query-driven operation (lists, search, filters, release, bootstrap) is comfortably
  sub-second at ~1,500 employees — no timeout or memory symptom observed, consistent with this
  project's own stated 10,000-employee performance/scale design floor
  (`docs/PROJECT_PROGRESS.md` §3 items 16–21).
- **PDF rendering (Puppeteer) is, as expected, the slowest operation by a wide margin** — roughly
  ~284ms/payslip in this run. Extrapolating linearly (a reasonable approximation since each payslip
  render is independent, not batched query work): a full 300-payslip batch (the documented per-request
  cap) would take on the order of **~85 seconds**. This is a background/manual monthly operation
  (generating payslips for one release), not a page-load-blocking one, and 85s for the largest
  possible single batch is acceptable for UAT. If a future large client needs *all* ~1,500 payslips
  in one sitting, that would require 5 separate batch requests (300-cap) rather than one — already
  the documented behavior, not a new finding.
- No release blocker found in this area.

## Caveats

- Single-sample timings on one local machine (embedded PostgreSQL, no network latency, no concurrent
  users) — not a substitute for a real load/concurrency test. This is explicitly a sanity check per
  the RC1 checkpoint's own framing ("This is a sanity test, not a full benchmarking project").
- The payslip-batch sample was 17 employees (the first release-eligible batch encountered), not the
  full 300-cap — the ~85s figure for a full batch is an extrapolation, not a direct measurement.
  Recommend a follow-up direct measurement at the full 300-employee cap before UAT if payslip-batch
  latency is a specific stakeholder concern.
