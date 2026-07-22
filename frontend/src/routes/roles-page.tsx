import { useState, type FormEvent } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import { PermissionMatrix } from '@/components/roles/permission-matrix';
import {
  useCreateRole,
  useDeleteRole,
  useDuplicateRole,
  usePermissionCatalog,
  useRole,
  useRoles,
  useUpdateRole,
  type RoleSummary,
} from '@/hooks/use-roles';

/**
 * Administration & Security Management Phase 1 — Role & Permission administration
 * (docs/architecture/authentication.md). Mirrors `users-page.tsx`'s own established structure
 * (modal-based create/edit, a DropdownMenu per row for further actions) rather than inventing a
 * new page pattern. `Role.code` is deliberately never shown as the primary identity here —
 * `name` is what an administrator sees and edits; `code` is an internal, generated detail.
 */

function CreateRoleModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createRole = useCreateRole();
  const catalog = usePermissionCatalog();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await createRole.mutateAsync({ name, description: description || null, permissionKeys });
      toast.success('Role created');
      onOpenChange(false);
      setName('');
      setDescription('');
      setPermissionKeys([]);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !createRole.isPending && onOpenChange(next)}>
      <ModalContent title="New Role" widthClassName="max-w-[640px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-name">Role name</Label>
            <Input
              id="role-name"
              required
              maxLength={80}
              placeholder="e.g. Lahore Payroll Officer"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-description">Description (optional)</Label>
            <Input
              id="role-description"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Permissions</Label>
            {catalog.isLoading && <Skeleton className="h-40 w-full" />}
            {catalog.data && (
              <PermissionMatrix catalog={catalog.data} selectedKeys={permissionKeys} onChange={setPermissionKeys} />
            )}
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={createRole.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createRole.isPending}>
              Create role
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

function EditRoleModal({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleSummary;
}) {
  const updateRole = useUpdateRole();
  const catalog = usePermissionCatalog();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate permissionKeys from the role's own detail fetch — RolesPage only holds RoleSummary
  // (no permissionKeys), so this modal loads its own detail once, the same lazy-hydration
  // approach the Employee edit form (employees-page.tsx) already uses for CNIC availability.
  const detail = useRoleDetailOnce(role.id, open);
  if (detail && !hydrated) {
    setPermissionKeys(detail.permissionKeys);
    setHydrated(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await updateRole.mutateAsync({
        id: role.id,
        input: { name, description: description || null, permissionKeys },
      });
      toast.success('Role updated');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !updateRole.isPending && onOpenChange(next)}>
      <ModalContent title="Edit Role" widthClassName="max-w-[640px] max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {role.isSystemRole && (
            <div className="rounded border border-border bg-bg px-3 py-2 text-[11px] text-text-muted">
              System role — its permissions, description, and name remain editable, but it can
              never be deleted.
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-role-name">Role name</Label>
            <Input id="edit-role-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-role-description">Description (optional)</Label>
            <Input
              id="edit-role-description"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Permissions</Label>
            {(!hydrated || catalog.isLoading) && <Skeleton className="h-40 w-full" />}
            {hydrated && catalog.data && (
              <PermissionMatrix catalog={catalog.data} selectedKeys={permissionKeys} onChange={setPermissionKeys} />
            )}
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={updateRole.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateRole.isPending || !hydrated}>
              Save changes
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

// A tiny local hook (not exported) — loads one role's full detail (permissionKeys included) only
// once, the moment the Edit modal opens, rather than RolesPage's own list query needing to carry
// every role's full permission set just for the rare case its editor gets opened.
function useRoleDetailOnce(roleId: string, enabled: boolean) {
  const { data } = useRole(enabled ? roleId : undefined);
  return data;
}

function DuplicateRoleModal({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleSummary;
}) {
  const duplicateRole = useDuplicateRole();
  const [newName, setNewName] = useState(`${role.name} (Copy)`);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await duplicateRole.mutateAsync({ id: role.id, input: { newName } });
      toast.success('Role duplicated');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !duplicateRole.isPending && onOpenChange(next)}>
      <ModalContent title="Duplicate Role" widthClassName="max-w-[480px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <p className="text-xs text-text-muted">
            Creates a new role with the same permissions as <span className="font-medium text-text">{role.name}</span>.
            The original role is left unchanged.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duplicate-role-name">New role name</Label>
            <Input
              id="duplicate-role-name"
              required
              maxLength={80}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={duplicateRole.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={duplicateRole.isPending}>
              Duplicate
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

export function RolesPage({ user }: { user: SessionUser }) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const { data: roles, isLoading } = useRoles({ includeInactive });
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleSummary | undefined>(undefined);
  const [duplicatingRole, setDuplicatingRole] = useState<RoleSummary | undefined>(undefined);

  async function handleToggleActive(role: RoleSummary) {
    try {
      await updateRole.mutateAsync({ id: role.id, input: { isActive: !role.isActive } });
      toast.success(role.isActive ? `${role.name} deactivated` : `${role.name} activated`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  async function handleDelete(role: RoleSummary) {
    try {
      await deleteRole.mutateAsync(role.id);
      toast.success(`${role.name} deleted`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <AppShell user={user} title="Roles & Permissions" subtitle="Administrator-defined roles and their permission grants">
      <Card>
        <CardHeader>
          <CardTitle>All Roles</CardTitle>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <Checkbox checked={includeInactive} onCheckedChange={(checked) => setIncludeInactive(checked === true)} />
              Show inactive
            </label>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New Role
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!isLoading && roles && roles.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Permissions</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">
                      {role.name}
                      {role.isSystemRole && (
                        <Badge tone="purple" className="ml-2">
                          System
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-text-muted">{role.description || '—'}</TableCell>
                    <TableCell>
                      <Badge tone={role.isActive ? 'green' : 'gray'}>{role.isActive ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{role.permissionCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{role.assignedUserCount}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text"
                            aria-label={`Actions for ${role.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditingRole(role)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDuplicatingRole(role)}>Duplicate</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleToggleActive(role)}>
                            {role.isActive ? 'Deactivate' : 'Activate'}
                          </DropdownMenuItem>
                          {!role.isSystemRole && role.assignedUserCount === 0 && (
                            <DropdownMenuItem onSelect={() => handleDelete(role)}>Delete</DropdownMenuItem>
                          )}
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

      <CreateRoleModal open={createOpen} onOpenChange={setCreateOpen} />

      {editingRole && (
        <EditRoleModal
          open={Boolean(editingRole)}
          onOpenChange={(open) => !open && setEditingRole(undefined)}
          role={editingRole}
        />
      )}

      {duplicatingRole && (
        <DuplicateRoleModal
          open={Boolean(duplicatingRole)}
          onOpenChange={(open) => !open && setDuplicatingRole(undefined)}
          role={duplicatingRole}
        />
      )}
    </AppShell>
  );
}
