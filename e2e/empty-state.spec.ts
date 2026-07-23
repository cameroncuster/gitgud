import { test, expect, type Page } from '@playwright/test';
import { waitForShell } from './support/harness.ts';
import { setScenario } from './support/scenario.ts';

test.beforeEach(async () => {
  await setScenario('empty');
});

// Explicit empty-state coverage (the `empty` scenario: every Supabase read
// returns []). The app has no "no rows" placeholder text, so the empty state it
// actually renders is a resolved page — spinner gone, no error banner — showing
// the table shell with its column headers and zero data rows. Asserting all
// three together distinguishes a genuine empty result from a stuck spinner
// (never resolved) or the backend-failure UI (error banner).

async function assertResolved(page: Page) {
  await waitForShell(page);
  // The loading spinner text must be gone (the read resolved).
  await expect(page.getByText(/Loading (problems|contests|leaderboard)/i)).toHaveCount(0);
  // No error/failure banner.
  await expect(page.getByText(/Failed to load/i)).toHaveCount(0);
}

test('empty problems: table shell renders with zero rows', async ({ page }) => {
  await page.goto('/');
  await assertResolved(page);

  // Column headers still render from the shell.
  await expect(page.getByRole('columnheader', { name: /Problem/i })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Difficulty/i })).toBeVisible();

  // Zero data rows.
  await expect(page.locator('table tbody tr')).toHaveCount(0);
});

test('empty contests: table shell renders with zero rows', async ({ page }) => {
  await page.goto('/contests');
  await assertResolved(page);

  await expect(page.getByRole('columnheader', { name: 'Contest', exact: true })).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(0);
});

test('empty leaderboard: table shell renders with zero rows', async ({ page }) => {
  await page.goto('/leaderboard');
  await assertResolved(page);

  await expect(page.getByRole('columnheader', { name: /Rank/i })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /User/i })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Solves/i })).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(0);
});
