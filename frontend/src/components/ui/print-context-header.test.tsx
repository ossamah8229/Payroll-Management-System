// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Phase 7C — `<PrintContextHeader showLogo>` opt-in. `useCompanySettings` is mocked (this
 * codebase's own established pattern) so this exercises only the component's own gating: the
 * logo must never render unless both `showLogo` is passed *and* `hasLogo` is true.
 */

const mockCompanySettingsData = vi.hoisted(() => ({ value: { hasLogo: false, companyName: 'Acme Co' } }));

vi.mock('@/hooks/use-company-settings', () => ({
  COMPANY_LOGO_PRINT_URL: 'http://backend.test/api/v1/settings/company/logo/print',
  useCompanySettings: () => ({ data: mockCompanySettingsData.value }),
}));

const { PrintContextHeader } = await import('./print-context-header');

describe('PrintContextHeader — showLogo opt-in (Phase 7C)', () => {
  afterEach(() => {
    cleanup();
    mockCompanySettingsData.value = { hasLogo: false, companyName: 'Acme Co' };
  });

  it('never renders a logo when showLogo is omitted, even if a logo is set', () => {
    mockCompanySettingsData.value = { hasLogo: true, companyName: 'Acme Co' };
    render(<PrintContextHeader title="Bank Sheet" />);
    expect(document.querySelector('img')).toBeNull();
  });

  it('never renders a logo when showLogo is true but no logo is set', () => {
    render(<PrintContextHeader title="Bank Sheet" showLogo />);
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders the print logo when showLogo is true and a logo is set', () => {
    mockCompanySettingsData.value = { hasLogo: true, companyName: 'Acme Co' };
    render(<PrintContextHeader title="Bank Sheet" showLogo />);
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.src).toBe('http://backend.test/api/v1/settings/company/logo/print');
  });

  it('still renders the company name and title regardless of showLogo', () => {
    render(<PrintContextHeader title="Cash Receiving" context="July 2026" showLogo />);
    expect(screen.queryByText('Acme Co')).not.toBeNull();
    expect(screen.queryByText('Cash Receiving')).not.toBeNull();
    expect(screen.queryByText('July 2026')).not.toBeNull();
  });
});
