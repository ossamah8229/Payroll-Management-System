-- RBAC Creator Ownership checkpoint — records who created a Project Site, for audit provenance
-- only. Nullable: every site created before this column existed has no recoverable creator
-- identity (see docs/architecture/rbac-creator-access.md). Access control is never driven by this
-- column — that remains exclusively UserSiteAssignment, unchanged by this migration.
ALTER TABLE "ProjectSite" ADD COLUMN "createdById" UUID;

ALTER TABLE "ProjectSite" ADD CONSTRAINT "ProjectSite_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
