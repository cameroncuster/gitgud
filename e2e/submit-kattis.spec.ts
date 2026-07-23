import { test, expect, type Page } from '@playwright/test';
import { collect, expectClean, waitForShell } from './support/harness.ts';
import { setScenario } from './support/scenario.ts';
import {
  seedAdminSession,
  seedMemberSession,
  resetMockStore,
  setProviderMode
} from './support/auth.ts';

// Authenticated admin submit-path coverage for /submit/kattis (the shared
// ProblemSubmitForm). A deterministic Supabase session is seeded before app
// boot; the admin gate reads the mocked user_roles; the server-side Kattis page
// fetch (/api/kattis -> open.kattis.com) is redirected to the mock; all inserts
// land only in the mock's isolated in-memory store (reset per test).

const KATTIS_PROBLEM = 'open.kattis.com/problems/hello';
const KATTIS_PROBLEM_2 = 'open.kattis.com/problems/twostones';

test.beforeEach(async () => {
  await setScenario('data');
  await resetMockStore();
  await setProviderMode('ok');
});

async function gotoSubmit(page: Page) {
  const errors = collect(page);
  await page.goto('/submit/kattis');
  await waitForShell(page);
  return errors;
}

const rows = (page: Page) => page.locator('[data-testid="results"] li');

test.describe('admin authorization gate', () => {
  test('a seeded admin sees the submit form', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await expect(page).toHaveURL(/\/submit\/kattis$/);
    await expect(page.getByRole('heading', { name: /Submit Kattis/i })).toBeVisible();
    await expect(page.getByLabel(/Problem URLs/i)).toBeVisible();
  });

  test('a seeded non-admin is denied and never sees the form', async ({ page }) => {
    await seedMemberSession(page);
    await gotoSubmit(page);

    await expect(page.getByText(/Only admins can submit/i)).toBeVisible();
    await expect(page.getByLabel(/Problem URLs/i)).toHaveCount(0);
  });

  test('an anonymous visitor is redirected home', async ({ page }) => {
    await page.goto('/submit/kattis');
    await page.waitForURL(/\/$/);
    await expect(page.getByRole('heading', { name: /Submit Kattis/i })).toHaveCount(0);
  });
});

test.describe('admin submit paths', () => {
  test('submits a single Kattis problem successfully', async ({ page }) => {
    await seedAdminSession(page);
    const errors = await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill(KATTIS_PROBLEM);
    await page.getByRole('button', { name: /^Submit$/ }).click();

    const row = rows(page).filter({ hasText: 'Mock Kattis Problem' });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Problem added/i)).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: /1 item added, 0 failures/i })
    ).toBeVisible();

    expectClean(errors, '/submit/kattis (single problem)');
  });

  test('submits a batch of two problems', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill(`${KATTIS_PROBLEM}\n${KATTIS_PROBLEM_2}`);
    await page.getByRole('button', { name: /^Submit$/ }).click();

    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText(/Problem added/i)).toHaveCount(2);
  });

  test('invalid input surfaces an inline error and processes nothing', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    // A URL for a different site yields no valid Kattis URLs.
    await page.getByLabel(/Problem URLs/i).fill('https://codeforces.com/contest/1/problem/A');
    await page.getByRole('button', { name: /^Submit$/ }).click();

    await expect(page.getByRole('alert')).toContainText(/No valid Kattis URLs/i);
    await expect(rows(page)).toHaveCount(0);
  });

  test('re-submitting the same problem reports a duplicate', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill(KATTIS_PROBLEM);
    await page.getByRole('button', { name: /^Submit$/ }).click();
    await expect(page.getByText(/Problem added/i)).toBeVisible();

    await page.getByLabel(/Problem URLs/i).fill(KATTIS_PROBLEM);
    await page.getByRole('button', { name: /^Submit$/ }).click();
    await expect(page.getByText(/already exists/i)).toBeVisible();
  });

  test('a provider page-fetch failure degrades to the deterministic fallback insert', async ({
    page
  }) => {
    // Documented existing behavior (fetchKattisProblemData): when the Kattis
    // page fetch fails, the service logs the error and FALLS BACK to a minimal
    // problem derived from the URL id (formatted name), still inserting. This
    // pins that fallback rather than asserting a failure UI that does not
    // exist. A console error is emitted by the fallback, so we do not assert a
    // clean console here.
    await seedAdminSession(page);
    await setProviderMode('fail');
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill(KATTIS_PROBLEM);
    await page.getByRole('button', { name: /^Submit$/ }).click();

    // The fallback formats the problem id ('hello') into a display name.
    const row = rows(page).filter({ hasText: 'Hello' });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Problem added/i)).toBeVisible();
  });
});
