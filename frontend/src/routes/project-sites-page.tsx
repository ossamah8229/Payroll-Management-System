import { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  const [branchCode, setBranchCode] = useState(site?.branchCode ?? '');

  const isPending = createSite.isPending || updateSite.isPending;

  function resetAndClose() {
    onOpenChange(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const input = {
      name,
      branchCode: branchCode.trim() || null,
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
      <ModalContent title={isEdit ? 'Edit Project Site' : 'New Project Site'} widthClassName="max-w-[520px]">
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
            <Label htmlFor="site-branch-code">Branch code</Label>
            <Input
              id="site-branch-code"
              value={branchCode}
              onChange={(event) => setBranchCode(event.target.value)}
              maxLength={20}
              placeholder="Optional"
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
          Delete <span className="font-medium text-text">{site.name}</span>? This cannot be undone. Sites
          with employees still assigned cannot be deleted.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={deleteSite.isPending}>
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

export function ProjectSitesPage({ user }: { user: SessionUser }) {
  const { data: sites, isLoading } = useProjectSites();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<ProjectSite | undefined>(undefined);
  const [deletingSite, setDeletingSite] = useState<ProjectSite | undefined>(undefined);

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
                  <TableHead>Branch code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell className="text-text-muted">{site.branchCode ?? '—'}</TableCell>
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
                          <DropdownMenuItem onSelect={() => setEditingSite(site)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDeletingSite(site)}>Delete</DropdownMenuItem>
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
