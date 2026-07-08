/**
 * The IP/user-agent context every audited mutation's `AuditLog` entry carries
 * (docs/architecture/database/audit-log.md §16). One definition, used by every module — first
 * written for Employee Registry, reused as-is by Payroll Entry (Phase 3) and any later module.
 */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}
