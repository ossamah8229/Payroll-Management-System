import type { SessionUser } from '@payroll/shared';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useProjectUnits } from '@/hooks/use-project-units';
import { Label } from '@/components/ui/label';

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The reusable Site -> Unit cascading selector (deferred from Phase 2.5 Checkpoint 0/1 to
 * Checkpoint 2, the first place one is actually needed — the Employee Registry's create/edit
 * form). Selecting a Project Site filters the Unit picker to that site's own `ProjectUnit` rows,
 * labeled with the site's own `unitLabel` (Branch/Department/Section/etc.) rather than the
 * hardcoded word "Unit" — built once here so Phase 3's Payroll Entry Work Lines and any future
 * unit-scoped form can reuse it instead of re-implementing the cascade.
 */
export function SiteUnitSelect({
  siteId,
  unitId,
  onSiteChange,
  onUnitChange,
  disabled,
  siteRequired = true,
  unitRequired = true,
  user,
}: {
  siteId: string;
  unitId: string;
  onSiteChange: (siteId: string) => void;
  onUnitChange: (unitId: string) => void;
  disabled?: boolean;
  siteRequired?: boolean;
  unitRequired?: boolean;
  /** Scopes the Site options to this user's own accessible sites (`useAccessibleProjectSites`) —
   * required, not optional, so a caller can't accidentally fall back to the unrestricted
   * `sites:manage`-aware list for what is always an operational, site-scoped selector. */
  user: SessionUser;
}) {
  const sites = useAccessibleProjectSites(user);
  const units = useProjectUnits(siteId || undefined);
  const selectedSite = sites.data?.find((site) => site.id === siteId);
  const unitLabel = selectedSite?.unitLabel ?? 'Unit';

  function handleSiteChange(nextSiteId: string) {
    onSiteChange(nextSiteId);
    onUnitChange(''); // a unit from the previous site never belongs to the new one
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="site-unit-select-site">Project site</Label>
        <select
          id="site-unit-select-site"
          required={siteRequired}
          disabled={disabled}
          className={selectClassName}
          value={siteId}
          onChange={(e) => handleSiteChange(e.target.value)}
        >
          <option value="" disabled>
            Select a site
          </option>
          {(sites.data ?? []).map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="site-unit-select-unit">{unitLabel}</Label>
        <select
          id="site-unit-select-unit"
          required={unitRequired}
          disabled={disabled || !siteId}
          className={selectClassName}
          value={unitId}
          onChange={(e) => onUnitChange(e.target.value)}
        >
          <option value="" disabled>
            {siteId ? `Select a ${unitLabel.toLowerCase()}` : 'Select a site first'}
          </option>
          {(units.data ?? []).map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
