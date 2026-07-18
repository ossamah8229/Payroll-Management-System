import { ROLE_CODES } from '@payroll/shared';
import { test, expect, loginAsMasterAdmin, login } from '../fixtures/auth';
import { apiPost, isAuthenticated } from '../helpers/api';

/**
 * Real-stack coverage for AUD-009 (Post-Phase-5 Stabilization Checkpoint 3) — password change
 * invalidates every existing session for that user, including the one that made the change,
 * immediately and without a server restart. Uses a dedicated user created just for this spec
 * (never the seeded Master Admin account) so changing its password can't affect any other spec's
 * own login.
 */
test.describe('Session revocation on password change', () => {
  test('two independent browser sessions both lose authorization the moment the password changes', async ({
    browser,
    page: adminPage,
  }) => {
    await loginAsMasterAdmin(adminPage);

    const email = `e2e-session-revocation-${Date.now()}@example.test`;
    const originalPassword = 'OriginalPassword1!';
    const newPassword = 'BrandNewPassword1!';

    await apiPost(adminPage.context(), '/api/v1/users', {
      name: 'E2E Session Revocation Target',
      email,
      password: originalPassword,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
    });

    // Two independent "browser sessions" — separate contexts, separate cookie jars, exactly like
    // two different physical browsers/devices.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await login(pageA, email, originalPassword);
    await login(pageB, email, originalPassword);
    expect(await isAuthenticated(contextA)).toBe(true);
    expect(await isAuthenticated(contextB)).toBe(true);

    // Change the password from session A, through the real Settings UI.
    await pageA.goto('/settings');
    await pageA.getByRole('button', { name: 'My Profile' }).click();
    await pageA.locator('#current-password').fill(originalPassword);
    await pageA.locator('#new-password').fill(newPassword);
    await pageA.getByRole('button', { name: 'Update password' }).click();
    await expect(pageA.getByText('Password changed')).toBeVisible();

    // Both the changing session and the untouched second session are now unauthorized.
    await expect.poll(() => isAuthenticated(contextA)).toBe(false);
    expect(await isAuthenticated(contextB)).toBe(false);

    // Old password no longer works; new password does.
    const contextRetry = await browser.newContext();
    const pageRetry = await contextRetry.newPage();
    await pageRetry.goto('/login');
    await pageRetry.locator('#email').fill(email);
    await pageRetry.locator('#password').fill(originalPassword);
    await pageRetry.getByRole('button', { name: 'Sign in' }).click();
    await expect(pageRetry.getByText(/invalid email or password/i)).toBeVisible();

    await login(pageRetry, email, newPassword);
    expect(await isAuthenticated(contextRetry)).toBe(true);

    await contextA.close();
    await contextB.close();
    await contextRetry.close();
  });
});
