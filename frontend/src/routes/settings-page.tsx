import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api-client';
import { useCompanySettings, useUpdateCompanySettings } from '@/hooks/use-company-settings';
import { useChangePassword, useUpdateProfile } from '@/hooks/use-session';

const ACCENT_PRESETS = [
  { label: 'Navy (default)', value: '#1B4F72' },
  { label: 'Forest', value: '#1A6B3A' },
  { label: 'Maroon', value: '#8B1A1A' },
  { label: 'Plum', value: '#4A2080' },
  { label: 'Slate', value: '#374151' },
];

type Tab = 'company' | 'profile' | 'theme';

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
      <div className="flex flex-col gap-3 text-xs">
        <div className="rounded border border-border bg-bg px-3.5 py-3 text-text-muted">
          Only Master Admin can edit company details. Showing the current values.
        </div>
        <dl className="flex flex-col gap-2">
          <div className="flex justify-between border-b border-border pb-2">
            <dt className="text-text-muted">Company name</dt>
            <dd className="font-medium text-text">{settings?.companyName}</dd>
          </div>
          <div className="flex justify-between border-b border-border pb-2">
            <dt className="text-text-muted">Address</dt>
            <dd className="text-text">{settings?.registeredAddress ?? '—'}</dd>
          </div>
          <div className="flex justify-between border-b border-border pb-2">
            <dt className="text-text-muted">Phone</dt>
            <dd className="text-text">{settings?.phone ?? '—'}</dd>
          </div>
          <div className="flex justify-between pb-2">
            <dt className="text-text-muted">Email</dt>
            <dd className="text-text">{settings?.email ?? '—'}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-[420px] flex-col gap-3.5">
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
      <p className="text-[11px] text-text-faint">
        Logo upload is not available yet — it depends on the file-storage abstraction, which is not
        built as of Phase 2.
      </p>
      <Button type="submit" className="self-start" disabled={updateSettings.isPending}>
        Save changes
      </Button>
    </form>
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
    <div className="flex flex-col gap-8">
      <form onSubmit={handleNameSubmit} className="flex max-w-[380px] flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input id="profile-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-email" className="normal-case">
            Email (not editable)
          </Label>
          <Input id="profile-email" value={user.email} disabled />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-role" className="normal-case">
            Role
          </Label>
          <Input id="profile-role" value={user.roleName} disabled />
        </div>
        <Button type="submit" className="self-start" disabled={updateProfile.isPending}>
          Save name
        </Button>
      </form>

      <form onSubmit={handlePasswordSubmit} className="flex max-w-[380px] flex-col gap-3.5 border-t border-border pt-6">
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
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-muted">
        Choose an accent color for your own view — this doesn't affect other users.
      </p>
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
        <Label htmlFor="custom-color" className="normal-case">
          Custom
        </Label>
        <input
          id="custom-color"
          type="color"
          value={selected}
          onChange={(e) => applyColor(e.target.value)}
          className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
        />
        <span className="text-xs text-text-muted">{selected}</span>
      </div>
    </div>
  );
}

export function SettingsPage({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>('company');

  return (
    <AppShell user={user} title="Settings" subtitle="Company details, your profile, and theme">
      <Card>
        <CardHeader className="border-b-0 pb-0">
          <div className="flex gap-5">
            <TabButton active={tab === 'company'} onClick={() => setTab('company')}>
              Company Details
            </TabButton>
            <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
              My Profile
            </TabButton>
            <TabButton active={tab === 'theme'} onClick={() => setTab('theme')}>
              Theme
            </TabButton>
          </div>
        </CardHeader>
        <CardContent className="border-t border-border">
          {tab === 'company' && <CompanyDetailsTab user={user} />}
          {tab === 'profile' && <MyProfileTab user={user} />}
          {tab === 'theme' && <ThemeTab user={user} />}
        </CardContent>
      </Card>
    </AppShell>
  );
}
