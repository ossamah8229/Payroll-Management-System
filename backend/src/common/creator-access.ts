import type { PrismaTransactionClient } from '../lib/prisma';

/**
 * RBAC Creator Ownership checkpoint (2026-07-25) — the general "creator-access" invariant, not a
 * Project-Site-specific hack: docs/architecture/rbac-creator-access.md.
 *
 * A user authorised to CREATE a resource whose visibility is gated by an explicit
 * `UserXAssignment`-style table must not immediately need a second user (typically Master Admin)
 * to grant them access to the resource they just created — otherwise "permission to create"
 * silently regresses to "permission to create something you then can't use." This applies only to
 * resources with that exact shape (an explicit assignment table separate from a plain `createdBy`
 * column); it does not apply to ordinary financial/workflow records, and it never widens a
 * creator's access to any resource other than the one they just created (see the doc for the
 * full resource-by-resource audit).
 *
 * `UserSiteAssignment` (Project Sites) is the only resource currently in that shape — Project
 * Units, Employees, Payroll Cycles/Entries, Advances, Corrections, Bank Sheets, and Cash
 * Receiving all resolve access indirectly through a parent Site's assignment rather than owning
 * an assignment table of their own, so this helper has one call site today
 * (`project-sites.service.ts`). It lives here, not inlined there, so the next resource that
 * legitimately needs the same invariant reuses this instead of re-deriving it.
 *
 * Master Admin is deliberately excluded — consistent with `UserSiteAssignment`'s own doc comment
 * ("Master Admin has implicit, unrestricted access and has no rows here") and every other
 * assignment-write call site in this codebase (`users.service.ts`'s `createUser`/`updateUser`).
 * Creating a meaningless assignment row for a user whose access is already unconditional would
 * only add a row that every other query has to special-case around.
 *
 * Idempotent by construction (`upsert` on the `[userId, siteId]` unique constraint): safe to call
 * unconditionally on every creation without a pre-check, and safe under retry.
 */
export async function ensureCreatorSiteAssignment(
  tx: PrismaTransactionClient,
  params: { creatorIsMasterAdmin: boolean; userId: string; siteId: string },
): Promise<void> {
  if (params.creatorIsMasterAdmin) return;

  await tx.userSiteAssignment.upsert({
    where: { userId_siteId: { userId: params.userId, siteId: params.siteId } },
    update: {},
    create: { userId: params.userId, siteId: params.siteId },
  });
}
