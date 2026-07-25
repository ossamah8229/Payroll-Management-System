import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { MoreHorizontal, Plus } from 'lucide-react';
import { CASH_BANK_CODE, PERMISSIONS, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api-client';
import { LogoPlaceholder } from '@/components/logo-placeholder';
import { useCompanySettings, useUpdateCompanySettings } from '@/hooks/use-company-settings';
import { useChangePassword, useUpdateProfile } from '@/hooks/use-session';
import { useAllBanks, useCreateBank, useDeleteBank, useUpdateBank, type Bank } from '@/hooks/use-banks';

function TabIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-[13px] font-semibold text-text">{title}</h2>
      <p className="text-xs text-text-muted">{description}</p>
    </div>
  );
}

const ACCENT_PRESETS = [
  { label: 'Navy (default)', value: '#1B4F72' },
  { label: 'Forest', value: '#1A6B3A' },
  { label: 'Maroon', value: '#8B1A1A' },
  { label: 'Plum', value: '#4A2080' },
  { label: 'Slate', value: '#374151' },
];

type Tab = 'company' | 'profile' | 'theme' | 'banks';

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-1 pb-2.5 text-xs font-medium transition-colors',
        active ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

function CompanyDetailsTab({ user }: { user: SessionUser }) {
  const { data: settings, isLoading } = useCompanySettings();
  const updateSettings = useUpdateCompanySettings();
  const canManage = user.permissions.includes('settings:manage');

  const [form, setForm] = useState({ companyName: '', registeredAddress: '', phone: '', email: '' });
  const [hydrated, setHydrated] = useState(false);

  if (settings && !hydrated) {
    setForm({
      companyName: settings.companyName,
      registeredAddress: settings.registeredAddress ?? '',
      phone: settings.phone ?? '',
      email: settings.email ?? '',
    });
    setHydrated(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await updateSettings.mutateAsync({
        companyName: form.companyName,
        registeredAddress: form.registeredAddress || null,
        phone: form.phone || null,
        email: form.email || null,
      });
      toast.success('Company details updated');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  if (isLoading) return <p className="text-xs text-text-muted">Loading…</p>;

  if (!canManage) {
    return (
      <div className="flex max-w-[560px] flex-col gap-6">
        <TabIntro
          title="Company Details"
          description="Used on payslips, bank sheets, and other printed documents."
        />
        <div className="rounded border border-border bg-bg px-3.5 py-3 text-xs text-text-muted">
          Only Master User can edit company details. Showing the current values.
        </div>
        <dl className="flex flex-col gap-2.5 text-xs">
          <div className="flex justify-between border-b border-border pb-2.5">
            <dt className="text-text-muted">Company name</dt>
            <dd className="font-medium text-text">{settings?.companyName}</dd>
          </div>
          <div className="flex justify-between border-b border-border pb-2.5">
            <dt className="text-text-muted">Address</dt>
            <dd className="text-text">{settings?.registeredAddress ?? '—'}</dd>
          </div>
          <div className="flex justify-between border-b border-border pb-2.5">
            <dt className="text-text-muted">Phone</dt>
            <dd className="text-text">{settings?.phone ?? '—'}</dd>
          </div>
          <div className="flex justify-between pb-2.5">
            <dt className="text-text-muted">Email</dt>
            <dd className="text-text">{settings?.email ?? '—'}</dd>
          </div>
        </dl>
        <div className="flex items-center gap-4 border-t border-border pt-6">
          <LogoPlaceholder size="lg" />
          <div>
            <p className="text-xs font-medium text-text">Company logo</p>
            <p className="text-[11px] text-text-muted">No logo uploaded yet.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-7">
      <TabIntro
        title="Company Details"
        description="Used on payslips, bank sheets, and other printed documents."
      />
      <form onSubmit={handleSubmit} className="flex max-w-[420px] flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-name">Company name</Label>
          <Input
            id="company-name"
            required
            maxLength={200}
            value={form.companyName}
            onChange={(e) => setForm((prev) => ({ ...prev, companyName: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-address">Registered address</Label>
          <Input
            id="company-address"
            maxLength={300}
            value={form.registeredAddress}
            onChange={(e) => setForm((prev) => ({ ...prev, registeredAddress: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-phone">Phone</Label>
          <Input
            id="company-phone"
            maxLength={30}
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-email">Email</Label>
          <Input
            id="company-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
          />
        </div>
        <Button type="submit" className="self-start" disabled={updateSettings.isPending}>
          Save changes
        </Button>
      </form>

      <section className="flex flex-col gap-3.5 border-t border-border pt-7">
        <TabIntro
          title="Company Logo"
          description="Shown on the login screen and printed documents once available."
        />
        <div className="flex items-center gap-4">
          <LogoPlaceholder size="lg" />
          <div className="flex flex-col gap-1.5">
            <Button type="button" variant="secondary" size="sm" disabled>
              Upload Logo
            </Button>
            <p className="text-[11px] text-text-faint">Maximum file size: 2 MB (PNG, JPG, or SVG)</p>
          </div>
        </div>
        <p className="text-[11px] text-text-faint">
          Logo upload becomes available once Storage Provider is implemented.
        </p>
      </section>
    </div>
  );
}

function MyProfileTab({ user }: { user: SessionUser }) {
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();

  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  async function handleNameSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await updateProfile.mutateAsync({ name });
      toast.success('Profile updated');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-7">
      <TabIntro title="My Profile" description="Your name, account details, and login password." />

      <form onSubmit={handleNameSubmit} className="flex max-w-[380px] flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input id="profile-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-email">Email (not editable)</Label>
          <Input id="profile-email" value={user.email} disabled />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-role">Role</Label>
          <Input id="profile-role" value={user.roleName} disabled />
        </div>
        <Button type="submit" className="self-start" disabled={updateProfile.isPending}>
          Save name
        </Button>
      </form>

      <form onSubmit={handlePasswordSubmit} className="flex max-w-[380px] flex-col gap-4 border-t border-border pt-7">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Change password</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="self-start" disabled={changePassword.isPending}>
          Update password
        </Button>
      </form>
    </div>
  );
}

function BankFormModal({
  open,
  onOpenChange,
  bank,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank?: Bank;
}) {
  const createBank = useCreateBank();
  const updateBank = useUpdateBank();
  const isEdit = Boolean(bank);
  const codeLocked = isEdit && Boolean(bank?.isReferenced);
  const isPending = createBank.isPending || updateBank.isPending;

  const [code, setCode] = useState(bank?.code ?? '');
  const [name, setName] = useState(bank?.name ?? '');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    try {
      if (isEdit && bank) {
        await updateBank.mutateAsync({
          id: bank.id,
          input: { name, ...(codeLocked ? {} : { code }) },
        });
        toast.success('Bank updated');
      } else {
        await createBank.mutateAsync({ code, name });
        toast.success('Bank created');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <ModalContent title={isEdit ? 'Edit Bank' : 'New Bank'} widthClassName="max-w-[460px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bank-code">Bank code</Label>
            <Input
              id="bank-code"
              required
              maxLength={10}
              value={code}
              disabled={codeLocked}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. ACB"
            />
            {codeLocked && (
              <p className="text-[11px] text-text-muted">
                Locked — this bank is already referenced by an employee or payroll record. Create a
                new bank instead if the code genuinely needs to change, then deactivate this one.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bank-name">Display name</Label>
            <Input
              id="bank-name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Commercial Bank"
            />
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? 'Save changes' : 'Create bank'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

function DeleteBankModal({
  open,
  onOpenChange,
  bank,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank: Bank;
}) {
  const deleteBank = useDeleteBank();

  async function handleDelete() {
    try {
      await deleteBank.mutateAsync(bank.id);
      toast.success('Bank deleted');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong deleting this bank');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !deleteBank.isPending && onOpenChange(next)}>
      <ModalContent title="Delete Bank" widthClassName="max-w-[420px]">
        <p className="text-xs text-text-muted">
          Delete <span className="font-medium text-text">{bank.name}</span>? This cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={deleteBank.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-danger hover:brightness-110"
            onClick={handleDelete}
            disabled={deleteBank.isPending}
          >
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * Settings → Banks (Phase 4 Checkpoint 1) — Master User only; the tab itself is hidden from anyone
 * without `banks:manage` (see `SettingsPage` below), and the backend independently re-enforces the
 * same permission on every write. Lists every bank via `useAllBanks()` (active or not, including
 * the reserved Cash record) — Employee Registry / Payroll Entry keep using `useBanks()`'s
 * active-only list unchanged. No `overflow-x-auto` wrapper is needed at today's 3-column width, but
 * the table still follows the Layout Integrity rule: nothing here truncates — Code and Name both
 * render at full length, wrapping rather than clipping if a name is ever unusually long.
 */
function BanksTab() {
  const { data: banks, isLoading } = useAllBanks();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | undefined>(undefined);
  const [deletingBank, setDeletingBank] = useState<Bank | undefined>(undefined);
  const updateBank = useUpdateBank();

  const filteredBanks = (banks ?? []).filter((bank) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return bank.name.toLowerCase().includes(term) || bank.code.toLowerCase().includes(term);
  });

  async function handleToggleActive(bank: Bank) {
    try {
      await updateBank.mutateAsync({ id: bank.id, input: { isActive: !bank.isActive } });
      toast.success(bank.isActive ? 'Bank deactivated' : 'Bank activated');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <TabIntro
          title="Banks"
          description="Banks employees can receive salary at. Only active banks appear in Employee Registry."
        />
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New Bank
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 max-w-[280px]">
        <Label htmlFor="bank-search">Search</Label>
        <Input
          id="bank-search"
          placeholder="Name or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!isLoading && filteredBanks.length === 0 && (
        <div className="flex flex-col items-center gap-1 py-10 text-center">
          <p className="text-xs font-medium text-text">No banks found</p>
          <p className="text-xs text-text-muted">Try a different search, or add the first bank.</p>
        </div>
      )}

      {!isLoading && filteredBanks.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Display name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBanks.map((bank) => {
              const isCash = bank.code === CASH_BANK_CODE;
              return (
                <TableRow key={bank.id}>
                  <TableCell className="font-medium">{bank.code}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {bank.name}
                      {isCash && <Badge tone="purple">Protected</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge tone={bank.isActive ? 'green' : 'gray'}>
                      {bank.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text"
                          aria-label={`Actions for ${bank.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isCash ? (
                          <DropdownMenuItem disabled className="opacity-100">
                            Protected system record — cannot be edited, deactivated, or deleted
                          </DropdownMenuItem>
                        ) : (
                          <>
                            <DropdownMenuItem onSelect={() => setEditingBank(bank)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => handleToggleActive(bank)}>
                              {bank.isActive ? 'Deactivate' : 'Activate'}
                            </DropdownMenuItem>
                            {bank.isReferenced ? (
                              <DropdownMenuItem
                                disabled
                                className="opacity-100"
                                title="Referenced banks cannot be deleted"
                              >
                                Delete (referenced)
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => setDeletingBank(bank)}>Delete</DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <BankFormModal open={createOpen} onOpenChange={setCreateOpen} />

      {editingBank && (
        <BankFormModal
          open={Boolean(editingBank)}
          onOpenChange={(open) => !open && setEditingBank(undefined)}
          bank={editingBank}
        />
      )}

      {deletingBank && (
        <DeleteBankModal
          open={Boolean(deletingBank)}
          onOpenChange={(open) => !open && setDeletingBank(undefined)}
          bank={deletingBank}
        />
      )}
    </div>
  );
}

function ThemeTab({ user }: { user: SessionUser }) {
  const updateProfile = useUpdateProfile();
  const [selected, setSelected] = useState(user.themeAccentColor);

  async function applyColor(color: string) {
    setSelected(color);
    try {
      await updateProfile.mutateAsync({ themeAccentColor: color });
      toast.success('Theme updated');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      <TabIntro
        title="Theme"
        description="Choose an accent color for your own view — this doesn't affect other users."
      />
      <div className="flex flex-wrap gap-3">
        {ACCENT_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => applyColor(preset.value)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-lg border p-2 text-[10px] text-text-muted transition-colors',
              selected.toLowerCase() === preset.value.toLowerCase()
                ? 'border-accent-mid ring-2 ring-accent-light'
                : 'border-border hover:border-border-strong',
            )}
          >
            <span className="block h-8 w-8 rounded-full" style={{ backgroundColor: preset.value }} />
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <Label htmlFor="custom-color">Custom</Label>
        <input
          id="custom-color"
          type="color"
          value={selected}
          onChange={(e) => applyColor(e.target.value)}
          className="h-8 w-8 cursor-pointer appearance-none overflow-hidden rounded-full border border-border bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0"
        />
        <span className="text-xs text-text-muted">{selected}</span>
      </div>
    </div>
  );
}

export function SettingsPage({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>('company');
  const canManageBanks = user.permissions.includes(PERMISSIONS.BANKS_MANAGE);

  return (
    <AppShell user={user} title="Settings" subtitle="Company details, your profile, and theme">
      <div className="mx-auto max-w-[880px]">
        <Card>
          <CardHeader className="border-b-0 px-7 pb-0 pt-6">
            <div className="flex gap-6">
              <TabButton active={tab === 'company'} onClick={() => setTab('company')}>
                Company Details
              </TabButton>
              <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
                My Profile
              </TabButton>
              <TabButton active={tab === 'theme'} onClick={() => setTab('theme')}>
                Theme
              </TabButton>
              {canManageBanks && (
                <TabButton active={tab === 'banks'} onClick={() => setTab('banks')}>
                  Banks
                </TabButton>
              )}
            </div>
          </CardHeader>
          <CardContent className="border-t border-border p-7">
            {tab === 'company' && <CompanyDetailsTab user={user} />}
            {tab === 'profile' && <MyProfileTab user={user} />}
            {tab === 'theme' && <ThemeTab user={user} />}
            {tab === 'banks' && canManageBanks && <BanksTab />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
