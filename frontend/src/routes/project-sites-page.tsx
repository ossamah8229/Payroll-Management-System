import { useRef, useState } from 'react';
import { Download, MoreHorizontal, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { pluralize, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError } from '@/lib/api-client';
import {
  downloadProjectSiteImportTemplate,
  useCreateProjectSite,
  useDeleteProjectSite,
  useImportProjectSites,
  useProjectSites,
  useUpdateProjectSite,
  type ProjectSite,
  type ProjectSiteImportResult,
} from '@/hooks/use-project-sites';
import {
  useCreateProjectUnit,
  useDeleteProjectUnit,
  useProjectUnits,
  useUpdateProjectUnit,
  type ProjectUnit,
} from '@/hooks/use-project-units';

/** The one place a blank create form's defaults are decided — `unitLabel` defaults to `'Branch'`
 * (matching `ProjectSite.unitLabel`'s own DB default, `database/sites-and-units.md §8`), not an
 * arbitrary empty string, since that's a documented, intentional default rather than a retained
 * previous value. */
const BLANK_SITE_FORM = { name: '', unitLabel: 'Branch', address: '' };

/**
 * Post-Checkpoint-1A UAT Stabilization — root cause of the reported "Add Project Site modal
 * retains prior site values" defect: this component (in its *create* usage,
 * `<SiteFormModal open={createOpen} .../>` below, no `site` prop) used to be mounted exactly once,
 * unconditionally, for the whole life of the page — only its `open` prop toggled. Since
 * `useState(site?.name ?? '')` only ever evaluates its initializer on first mount, the form's own
 * fields silently kept whatever they last held (typed text, or a just-submitted value) across every
 * later close/reopen, with nothing to ever reset them. The *edit* usage never had this problem: it's
 * already conditionally rendered (`{editingSite && <SiteFormModal site={editingSite} .../>}`,
 * further down), so selecting a different site — or Create right after Edit — always mounts a fresh
 * instance seeded from that specific site. The fix makes *create* follow the exact same
 * mount-fresh-every-time discipline already proven for edit (and already used by every other modal
 * in this file — `ManageUnitsModal`, `DeleteSiteModal`), rather than inventing a new mechanism:
 * `ProjectSitesPage` now renders this component with `{createOpen && <SiteFormModal .../>}` too, so
 * opening "New Site" always mounts a brand-new, blank instance. `resetForm` below additionally
 * handles the one case a remount alone can't cover — "Add another", which must blank the *same*
 * still-open instance without unmounting it.
 */
// Exported (in addition to being used internally below) purely for direct, focused testability
// (`project-sites-page.test.tsx`) — the create/edit form-reset lifecycle this component owns is
// self-contained and independent of the page's own list/dropdown wiring, so testing it directly
// avoids coupling that coverage to an unrelated interaction (Radix's DropdownMenu open/close).
export function SiteFormModal({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site?: ProjectSite;
}) {
  const createSite = useCreateProjectSite();
  const updateSite = useUpdateProjectSite();
  const isEdit = Boolean(site);

  const [name, setName] = useState(site?.name ?? BLANK_SITE_FORM.name);
  const [unitLabel, setUnitLabel] = useState(site?.unitLabel ?? BLANK_SITE_FORM.unitLabel);
  const [address, setAddress] = useState(site?.address ?? BLANK_SITE_FORM.address);
  // "Add another" (Post-Checkpoint-1A UAT Stabilization) — create-only; edit never offers it, since
  // editing is always about exactly one already-selected site. Persists checked across a run of
  // several creates in a row, deliberately, so the operator isn't re-checking it every time.
  const [addAnother, setAddAnother] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isPending = createSite.isPending || updateSite.isPending;

  function resetForm() {
    setName(BLANK_SITE_FORM.name);
    setUnitLabel(BLANK_SITE_FORM.unitLabel);
    setAddress(BLANK_SITE_FORM.address);
  }

  function resetAndClose() {
    onOpenChange(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const input = {
      name,
      unitLabel: unitLabel.trim() || 'Branch',
      address: address.trim() || null,
    };

    try {
      if (isEdit && site) {
        await updateSite.mutateAsync({ id: site.id, input });
        toast.success('Site updated');
        resetAndClose();
      } else {
        await createSite.mutateAsync(input);
        if (addAnother) {
          // Stays open on the same instance — the one case a fresh mount can't reset by itself.
          toast.success('Site created — form cleared for the next one');
          resetForm();
          nameInputRef.current?.focus();
        } else {
          toast.success('Site created');
          resetAndClose();
        }
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
      }}
    >
      <ModalContent
        title={isEdit ? 'Edit Project Site' : 'New Project Site'}
        widthClassName="max-w-[520px]"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site-name">Site name</Label>
            <Input
              id="site-name"
              ref={nameInputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={160}
              placeholder="e.g. Downtown Regional Office"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site-unit-label">Unit label</Label>
            <Input
              id="site-unit-label"
              value={unitLabel}
              onChange={(event) => setUnitLabel(event.target.value)}
              maxLength={40}
              placeholder="e.g. Branch, Department, Section"
            />
            <p className="text-[11px] text-text-muted">
              The term this site uses for its own sub-divisions — drives labels everywhere a unit is
              shown for this site.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="site-address">Address</Label>
            <Input
              id="site-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={300}
              placeholder="Street, area, city — optional"
            />
          </div>

          {!isEdit && (
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <Checkbox checked={addAnother} onCheckedChange={(checked) => setAddAnother(checked === true)} />
              Add another after this one
            </label>
          )}

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={resetAndClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || name.trim().length === 0}>
              {isEdit ? 'Save changes' : addAnother ? 'Create & add another' : 'Create site'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

function DeleteSiteModal({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: ProjectSite;
}) {
  const deleteSite = useDeleteProjectSite();

  async function handleDelete() {
    try {
      await deleteSite.mutateAsync(site.id);
      toast.success('Site deleted');
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Something went wrong deleting this site',
      );
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !deleteSite.isPending && onOpenChange(next)}>
      <ModalContent title="Delete Project Site" widthClassName="max-w-[420px]">
        <p className="text-xs text-text-muted">
          Delete <span className="font-medium text-text">{site.name}</span>? This cannot be undone.
          Sites with employees or {pluralize(site.unitLabel).toLowerCase()} still assigned cannot be
          deleted.
        </p>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={deleteSite.isPending}
          >
            Cancel
          </Button>
          <Button
            className="bg-danger hover:brightness-110"
            onClick={handleDelete}
            disabled={deleteSite.isPending}
          >
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * A single Dialog with an internal view state (list/form/delete), rather than opening a second,
 * independent `Modal` (Radix `Dialog.Root`) nested inside this one. Two independently-mounted
 * Radix Dialogs stacked this way was tried first and found to have a real bug, not just a
 * cosmetic one: Radix's aria-hiding of background content leaves the outer dialog's overlay
 * permanently `aria-hidden`/click-intercepting once the inner one closes, silently breaking every
 * click inside the outer modal from then on (confirmed via Playwright — the overlay stays stuck
 * mid-interaction indefinitely, not just during the close animation). Keeping everything in one
 * Dialog sidesteps that class of bug entirely.
 */
type UnitsView =
  { mode: 'list' } | { mode: 'form'; unit?: ProjectUnit } | { mode: 'delete'; unit: ProjectUnit };

function ManageUnitsModal({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: ProjectSite;
}) {
  const { data: units, isLoading } = useProjectUnits(site.id);
  const createUnit = useCreateProjectUnit(site.id);
  const updateUnit = useUpdateProjectUnit(site.id);
  const deleteUnit = useDeleteProjectUnit(site.id);

  const [view, setView] = useState<UnitsView>({ mode: 'list' });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const unitLabelPlural = pluralize(site.unitLabel);
  const isMutating = createUnit.isPending || updateUnit.isPending || deleteUnit.isPending;

  function openCreateForm() {
    setName('');
    setCode('');
    setView({ mode: 'form' });
  }

  function openEditForm(unit: ProjectUnit) {
    setName(unit.name);
    setCode(unit.code ?? '');
    setView({ mode: 'form', unit });
  }

  async function handleFormSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (view.mode !== 'form') return;

    const input = { name, code: code.trim() || null };

    try {
      if (view.unit) {
        await updateUnit.mutateAsync({ id: view.unit.id, input });
        toast.success(`${site.unitLabel} updated`);
      } else {
        await createUnit.mutateAsync(input);
        toast.success(`${site.unitLabel} created`);
      }
      setView({ mode: 'list' });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  async function handleDeleteConfirm() {
    if (view.mode !== 'delete') return;

    try {
      await deleteUnit.mutateAsync(view.unit.id);
      toast.success(`${site.unitLabel} deleted`);
      setView({ mode: 'list' });
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : `Something went wrong deleting this ${site.unitLabel.toLowerCase()}`,
      );
    }
  }

  const title =
    view.mode === 'list'
      ? `${unitLabelPlural} — ${site.name}`
      : view.mode === 'form'
        ? view.unit
          ? `Edit ${site.unitLabel}`
          : `New ${site.unitLabel}`
        : `Delete ${site.unitLabel}`;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (isMutating) return;
        if (next) setView({ mode: 'list' }); // always reopen to the list view, never mid-form
        onOpenChange(next);
      }}
    >
      <ModalContent title={title} widthClassName="max-w-[560px] max-h-[80vh]">
        {view.mode === 'list' && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-muted">
                Every {site.unitLabel.toLowerCase()} employees at this site can be deputed to.
              </p>
              <Button size="sm" onClick={openCreateForm}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                New {site.unitLabel}
              </Button>
            </div>

            {isLoading && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {!isLoading && units && units.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-10 text-center">
                <p className="text-xs font-medium text-text">
                  No {unitLabelPlural.toLowerCase()} yet
                </p>
                <p className="text-xs text-text-muted">
                  Create the first {site.unitLabel.toLowerCase()} for this site.
                </p>
              </div>
            )}

            {!isLoading && units && units.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell className="font-medium">{unit.name}</TableCell>
                      <TableCell className="text-text-muted">{unit.code ?? '—'}</TableCell>
                      <TableCell>
                        <Badge tone={unit.isActive ? 'green' : 'gray'}>
                          {unit.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text"
                              aria-label={`Actions for ${unit.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" aria-hidden />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEditForm(unit)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setView({ mode: 'delete', unit })}>
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <ModalFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </ModalFooter>
          </div>
        )}

        {view.mode === 'form' && (
          <form onSubmit={handleFormSubmit} className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-name">{site.unitLabel} name</Label>
              <Input
                id="unit-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={160}
                placeholder={`e.g. North ${site.unitLabel}`}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-code">{site.unitLabel} code</Label>
              <Input
                id="unit-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={20}
                placeholder="Optional"
              />
            </div>

            <ModalFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setView({ mode: 'list' })}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isMutating || name.trim().length === 0}>
                {view.unit ? 'Save changes' : `Create ${site.unitLabel.toLowerCase()}`}
              </Button>
            </ModalFooter>
          </form>
        )}

        {view.mode === 'delete' && (
          <div className="flex flex-col gap-3.5">
            <p className="text-xs text-text-muted">
              Delete <span className="font-medium text-text">{view.unit.name}</span>? This cannot be
              undone. {site.unitLabel}s with employees still assigned cannot be deleted.
            </p>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setView({ mode: 'list' })}
                disabled={isMutating}
              >
                Cancel
              </Button>
              <Button
                className="bg-danger hover:brightness-110"
                onClick={handleDeleteConfirm}
                disabled={isMutating}
              >
                Delete
              </Button>
            </ModalFooter>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}

/** Import Template Contract checkpoint (Project Site extension) — same shape/behavior as
 * `employees-page.tsx`'s own `ImportResultModal`, minus "updated" (Project Site import only ever
 * creates, per Part 10's default requirement — see `project-sites-import-export.service.ts`). */
function ImportResultModal({
  open,
  onOpenChange,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ProjectSiteImportResult;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent title="Import Results" widthClassName="max-w-[520px] max-h-[75vh]">
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex gap-4">
            <Badge tone="green">{result.created} created</Badge>
            {result.skipped.length > 0 && <Badge tone="red">{result.skipped.length} skipped</Badge>}
          </div>
          {result.skipped.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-text">Skipped rows</p>
              {result.skipped.map((skip) => (
                <div key={skip.row} className="rounded border border-border bg-bg px-2.5 py-1.5">
                  Row {skip.row}: {skip.reason}
                </div>
              ))}
            </div>
          )}
        </div>
        <ModalFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export function ProjectSitesPage({ user }: { user: SessionUser }) {
  const { data: sites, isLoading, error } = useProjectSites();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<ProjectSite | undefined>(undefined);
  const [deletingSite, setDeletingSite] = useState<ProjectSite | undefined>(undefined);
  const [managingUnitsSite, setManagingUnitsSite] = useState<ProjectSite | undefined>(undefined);
  // Bulk import (Import Template Contract checkpoint, Project Site extension) — no additional
  // `hasPermission` gating here beyond what already applies to "New Site" above: this entire page
  // is only reachable via App.tsx's `RequirePermission user={user} permission={SITES_MANAGE}`
  // wrapper, so every visitor already holds the same permission the backend independently
  // enforces on both `/sites/import-template` and `/sites/import` (Part 3 — server-side is what
  // actually matters; this page's own established convention is route-level gating, not
  // per-button checks).
  const [importResult, setImportResult] = useState<ProjectSiteImportResult | undefined>(undefined);
  const importSites = useImportProjectSites();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const result = await importSites.mutateAsync(file);
      setImportResult(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Import failed');
    }
  }

  return (
    <AppShell user={user} title="Project Sites" subtitle="Client sites employees are deputed to">
      <Card>
        <CardHeader>
          <CardTitle>All Sites</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => downloadProjectSiteImportTemplate()}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Download Import Template
            </Button>
            <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={importSites.isPending}>
              <Upload className="h-3.5 w-3.5" aria-hidden />
              {importSites.isPending ? 'Importing…' : 'Import'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New Site
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!isLoading && error && (
            // UAT Defect 1 correction — an authorization or server error must never render as
            // indistinguishable from a genuine empty list (this project's established convention,
            // see e.g. advances-page.tsx), which is exactly what let the original site-visibility
            // defect look like "no sites exist yet" instead of a real permission problem.
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">Could not load Sites</p>
              <p className="text-xs text-text-muted">
                {error instanceof ApiError ? error.message : 'Something went wrong'}
              </p>
            </div>
          )}

          {!isLoading && !error && sites && sites.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No project sites yet</p>
              <p className="text-xs text-text-muted">Create the first one to get started.</p>
            </div>
          )}

          {!isLoading && !error && sites && sites.length > 0 && (
            // Layout Integrity (permanent rule, corrected 2026-07-13): Address previously used
            // `truncate` with a `title` tooltip fallback — exactly the "visible only by tooltip"
            // pattern the rule forbids. A horizontal-scroll wrapper plus `whitespace-nowrap`
            // (this project's own established convention — see Bank Sheet/Cash Receiving/
            // Advances) replaces it: the full address is always directly readable in the table.
            <div className="overflow-x-auto">
              <Table className="min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Name</TableHead>
                    <TableHead className="whitespace-nowrap">Unit label</TableHead>
                    <TableHead className="whitespace-nowrap">Address</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sites.map((site) => (
                    <TableRow key={site.id}>
                      <TableCell className="whitespace-nowrap font-medium">{site.name}</TableCell>
                      <TableCell className="whitespace-nowrap text-text-muted">{site.unitLabel}</TableCell>
                      <TableCell className="whitespace-nowrap text-text-muted">{site.address ?? '—'}</TableCell>
                      <TableCell>
                        <Badge tone={site.isActive ? 'green' : 'gray'}>
                          {site.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text"
                              aria-label={`Actions for ${site.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" aria-hidden />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditingSite(site)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setManagingUnitsSite(site)}>
                              Manage {pluralize(site.unitLabel)}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDeletingSite(site)}>
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conditionally rendered (never a single persistent instance whose `open` prop merely
          toggles) — the fix for the reported stale-values defect: this guarantees a brand-new,
          blank-initialized instance every time "New Site" is opened, exactly like `editingSite`'s
          own instance below already does per-site. See `SiteFormModal`'s own doc comment. */}
      {createOpen && <SiteFormModal open={createOpen} onOpenChange={setCreateOpen} />}

      {editingSite && (
        <SiteFormModal
          open={Boolean(editingSite)}
          onOpenChange={(open) => !open && setEditingSite(undefined)}
          site={editingSite}
        />
      )}

      {managingUnitsSite && (
        <ManageUnitsModal
          open={Boolean(managingUnitsSite)}
          onOpenChange={(open) => !open && setManagingUnitsSite(undefined)}
          site={managingUnitsSite}
        />
      )}

      {deletingSite && (
        <DeleteSiteModal
          open={Boolean(deletingSite)}
          onOpenChange={(open) => !open && setDeletingSite(undefined)}
          site={deletingSite}
        />
      )}

      {importResult && (
        <ImportResultModal
          open={Boolean(importResult)}
          onOpenChange={(open) => !open && setImportResult(undefined)}
          result={importResult}
        />
      )}
    </AppShell>
  );
}
