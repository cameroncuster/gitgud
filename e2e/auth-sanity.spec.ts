import { test, expect, type Page } from '@playwright/test';
import { setScenario } from './support/scenario.ts';
import { resetMockStore } from './support/auth.ts';
import { ADMIN_USER, SUPABASE_STORAGE_KEY } from './support/constants.ts';
import { collect, expectClean, waitForShell } from './support/harness.ts';

test.beforeEach(async () => {
  await setScenario('data');
  await resetMockStore();
});

async function openMobileMenu(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Open menu' });
  if (await toggle.isVisible()) {
    await toggle.click();
  }
}

test('@sanity GitHub sign-in persists an admin session and logout revokes access', async ({
  page
}) => {
  const errors = collect(page);
  await page.goto('/');
  await waitForShell(page);
  await openMobileMenu(page);

  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/auth\/callback/);
  await page.waitForURL(/\/$/);

  await openMobileMenu(page);
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Submit', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        ([key, accessToken]) => {
          const raw = localStorage.getItem(key);
          if (!raw) return false;
          try {
            return JSON.parse(raw).access_token === accessToken;
          } catch {
            return false;
          }
        },
        [SUPABASE_STORAGE_KEY, ADMIN_USER.accessToken] as const
      )
    )
    .toBe(true);

  await page.reload();
  await waitForShell(page);
  await openMobileMenu(page);
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();

  await page.goto('/submit');
  await expect(page.getByLabel(/Problem URLs/i)).toBeVisible();
  await openMobileMenu(page);

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), SUPABASE_STORAGE_KEY))
    .toBeNull();
  const mobileMenuToggle = page.getByRole('button', { name: 'Open menu' });
  if (await mobileMenuToggle.isVisible()) {
    await mobileMenuToggle.click();
  }
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  await page.goto('/submit');
  await page.waitForURL(/\/$/);
  await expect(page.getByLabel(/Problem URLs/i)).toHaveCount(0);
  expectClean(errors, 'auth sanity lifecycle');
});
