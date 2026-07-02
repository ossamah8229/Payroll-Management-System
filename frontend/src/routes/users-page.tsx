import { useState, type FormEvent } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { ROLE_CODES } from '@payroll/shared';
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
import { useProjectSites } from '@/hooks/use-project-sites';
import { useCreateUser, useResetUserPassword, useUpdateUser, useUsers, type ManagedUser } from '@/hooks/use-users';

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

function SiteCheckboxList({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (siteIds: string[]) => void;
}) {
  const sites = useProjectSites();

  function toggle(siteId: string) {
    onChange(selected.includes(siteId) ? selected.filter((id) => id !== siteId) : [...selected, siteId]);
  }

  return (
    <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded border border-border p-2.5">
      {(sites.data ?? []).length === 0 && <p className="text-xs text-text-muted">No project sites yet.</p>}
      {(sites.data ?? []).map((site) => (
        <label key={site.id} className="flex items-center gap-2 text-xs text-text">
          <input type="checkbox" checked={selected.includes(site.id)} onChange={() => toggle(site.id)} />
          {site.name}
        </label>
      ))}
    </div>
  );
}

function CreateUserModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createUser = useCreateUser();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleCode, setRoleCode] = useState<'MASTER_ADMIN' | 'PAYROLL_STAFF'>(ROLE_CODES.PAYROLL_STAFF);
  const [siteIds, setSiteIds] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await createUser.mutateAsync({ name, email, password, roleCode, siteIds });
      toast.success('User created');
      onOpenChange(false);
      setName('');
      setEmail('');
      setPassword('');
      setSiteIds([]);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !createUser.isPending && onOpenChange(next)}>
      <ModalContent title="New User" widthClassName="max-w-[520px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-name">Name</Label>
            <Input id="user-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input id="user-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-password">Temporary password</Label>
            <Input
              id="user-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-role">Role</Label>
            <select
              id="user-role"
              className={selectClassName}
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value as typeof roleCode)}
            >
              <option value={ROLE_CODES.PAYROLL_STAFF}>Payroll Staff</option>
              <option value={ROLE_CODES.MASTER_ADMIN}>Master Admin</option>
            </select>
          </div>
          {roleCode === ROLE_CODES.PAYROLL_STAFF && (
            <div className="flex flex-col gap-1.5">
              <Label>Assigned sites</Label>
              <SiteCheckboxList selected={siteIds} onChange={setSiteIds} />
            </div>
          )}
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={createUser.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createUser.isPending}>
              Create user
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

function EditUserModal({
  open,
  onOpenChange,
  user,
  isSelf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ManagedUser;
  isSelf: boolean;
}) {
  const updateUser = useUpdateUser();
  const [name, setName] = useState(user.name);
  const [isActive, setIsActive] = useState(user.isActive);
  const [siteIds, setSiteIds] = useState(user.siteAssignments.map((a) => a.siteId));
  const isMasterAdmin = user.role.code === ROLE_CODES.MASTER_ADMIN;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await updateUser.mutateAsync({
        id: user.id,
        input: { name, isActive, ...(isMasterAdmin ? {} : { siteIds }) },
      });
      toast.success('User updated');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !updateUser.isPending && onOpenChange(next)}>
      <ModalContent title="Edit User" widthClassName="max-w-[520px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-user-name">Name</Label>
            <Input id="edit-user-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-xs text-text">
            <input
              type="checkbox"
              checked={isActive}
              disabled={isSelf}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active {isSelf && <span className="text-text-faint">(cannot deactivate your own account)</span>}
          </label>
          {!isMasterAdmin && (
            <div className="flex flex-col gap-1.5">
              <Label>Assigned sites</Label>
              <SiteCheckboxList selected={siteIds} onChange={setSiteIds} />
            </div>
          )}
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={updateUser.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateUser.isPending}>
              Save changes
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

function ResetPasswordModal({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ManagedUser;
}) {
  const resetPassword = useResetUserPassword();
  const [newPassword, setNewPassword] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await resetPassword.mutateAsync({ id: user.id, input: { newPassword } });
      toast.success(`Password reset for ${user.name}`);
      onOpenChange(false);
      setNewPassword('');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !resetPassword.isPending && onOpenChange(next)}>
      <ModalContent title="Reset Password" widthClassName="max-w-[420px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <p className="text-xs text-text-muted">
            Set a new temporary password for <span className="font-medium text-text">{user.name}</span>.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={resetPassword.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={resetPassword.isPending}>
              Reset password
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

export function UsersPage({ user }: { user: SessionUser }) {
  const { data: users, isLoading } = useUsers();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | undefined>(undefined);
  const [resettingUser, setResettingUser] = useState<ManagedUser | undefined>(undefined);

  return (
    <AppShell user={user} title="User Management" subtitle="Master Admin and Payroll Staff accounts">
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New User
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {!isLoading && users && users.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sites</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((managedUser) => (
                  <TableRow key={managedUser.id}>
                    <TableCell className="font-medium">{managedUser.name}</TableCell>
                    <TableCell className="text-text-muted">{managedUser.email}</TableCell>
                    <TableCell>
                      <Badge tone={managedUser.role.code === ROLE_CODES.MASTER_ADMIN ? 'purple' : 'blue'}>
                        {managedUser.role.name}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {managedUser.role.code === ROLE_CODES.MASTER_ADMIN
                        ? 'All sites'
                        : managedUser.siteAssignments.map((a) => a.site.name).join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge tone={managedUser.isActive ? 'green' : 'gray'}>
                        {managedUser.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text"
                            aria-label={`Actions for ${managedUser.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditingUser(managedUser)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setResettingUser(managedUser)}>
                            Reset password
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

      <CreateUserModal open={createOpen} onOpenChange={setCreateOpen} />

      {editingUser && (
        <EditUserModal
          open={Boolean(editingUser)}
          onOpenChange={(open) => !open && setEditingUser(undefined)}
          user={editingUser}
          isSelf={editingUser.id === user.id}
        />
      )}

      {resettingUser && (
        <ResetPasswordModal
          open={Boolean(resettingUser)}
          onOpenChange={(open) => !open && setResettingUser(undefined)}
          user={resettingUser}
        />
      )}
    </AppShell>
  );
}
