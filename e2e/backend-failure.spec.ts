import { test, expect, type Page } from '@playwright/test';
import { MOCK_URL } from './support/constants.ts';
import { waitForShell } from './support/harness.ts';
import { setScenario } from './support/scenario.ts';

test.beforeEach(async () => {
  await setScenario('error');
});

// Explicit backend-failure coverage (the `error` scenario: every Supabase read
// replies 500).
//
// Observed product behavior: the domain queries (fetchProblems / fetchContests /
// fetchLeaderboard) catch the backend error, log it server-side, and return an
// empty result, so the SSR page degrades to a safe empty shell rather than
// crashing or blanking. There is no user-facing error banner on the initial
// load, and because the read happens during SSR the failure is logged in the
// Node process (not the browser). This suite therefore pins the guaranteed,
// deterministic observable: a degraded-but-safe shell (no crash, no hang, no
// rows) on every list surface when the backend returns 500. It documents the
// actual behavior rather than asserting an error UI that does not exist.

async function assertDegradesSafely(page: Page, emptyState: RegExp) {
  await waitForShell(page);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.getByText(emptyState)).toBeVisible();
  await expect(page.getByText(/Loading (problems|contests|leaderboard)/i)).toHaveCount(0);
}

test('problems backend failure degrades to a safe shell', async ({ page }) => {
  await page.goto('/');
  await assertDegradesSafely(page, /No problems match the current filters/i);
  await expect(page).toHaveTitle(/Problems/i);
});

test('contests backend failure degrades to a safe shell', async ({ page }) => {
  await page.goto('/contests');
  await assertDegradesSafely(page, /No contests match the current filters/i);
  await expect(page).toHaveTitle(/Contests/i);
});

test('leaderboard backend failure renders the table shell with no rows', async ({ page }) => {
  await page.goto('/leaderboard');
  await waitForShell(page);
  // Column headers still render from the shell.
  await expect(page.getByRole('columnheader', { name: /Rank/i })).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(0);
});

test('actor feedback and participation reads honor the error scenario', async ({ request }) => {
  for (const table of [
    'user_problem_feedback',
    'user_contest_feedback',
    'user_contest_participation'
  ]) {
    const response = await request.get(`${MOCK_URL}/rest/v1/${table}`);
    expect(response.status()).toBe(500);
    expect(await response.json()).toMatchObject({
      code: 'PGRST500',
      message: 'mock backend failure'
    });
  }
});
