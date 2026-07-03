import { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { pluralize, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  useCreateProjectSite,
  useDeleteProjectSite,
  useProjectSites,
  useUpdateProjectSite,
  type ProjectSite,
} from '@/hooks/use-project-sites';
import {
  useCreateProjectUnit,
  useDeleteProjectUnit,
  useProjectUnits,
  useUpdateProjectUnit,
  type ProjectUnit,
} from '@/hooks/use-project-units';

function SiteFormModal({
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

  const [name, setName] = useState(site?.name ?? '');
  const [unitLabel, setUnitLabel] = useState(site?.unitLabel ?? 'Branch');
  const [address, setAddress] = useState(site?.address ?? '');

  const isPending = createSite.isPending || updateSite.isPending;

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
      } else {
        await createSite.mutateAsync(input);
        toast.success('Site created');
      }
      resetAndClose();
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
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={160}
              placeholder="e.g. ABL City Region Lahore"
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

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={resetAndClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || name.trim().length === 0}>
              {isEdit ? 'Save changes' : 'Create site'}
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
      <ModalContent title={title} widthClassName="max-w-[560px] max-h-[80vh] overflow-y-auto">
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
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
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
                placeholder={`e.g. Model Town ${site.unitLabel}`}
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

export function ProjectSitesPage({ user }: { user: SessionUser }) {
  const { data: sites, isLoading } = useProjectSites();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<ProjectSite | undefined>(undefined);
  const [deletingSite, setDeletingSite] = useState<ProjectSite | undefined>(undefined);
  const [managingUnitsSite, setManagingUnitsSite] = useState<ProjectSite | undefined>(undefined);

  return (
    <AppShell user={user} title="Project Sites" subtitle="Client sites employees are deputed to">
      <Card>
        <CardHeader>
          <CardTitle>All Sites</CardTitle>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New Site
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {!isLoading && sites && sites.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No project sites yet</p>
              <p className="text-xs text-text-muted">Create the first one to get started.</p>
            </div>
          )}

          {!isLoading && sites && sites.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit label</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell className="text-text-muted">{site.unitLabel}</TableCell>
                    <TableCell
                      className="max-w-[260px] truncate text-text-muted"
                      title={site.address ?? undefined}
                    >
                      {site.address ?? '—'}
                    </TableCell>
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
          )}
        </CardContent>
      </Card>

      <SiteFormModal open={createOpen} onOpenChange={setCreateOpen} />

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
    </AppShell>
  );
}
