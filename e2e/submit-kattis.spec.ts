import { test, expect, type Page } from '@playwright/test';
import { collect, expectClean, waitForShell } from './support/harness.ts';
import { setScenario } from './support/scenario.ts';
import {
  seedAdminSession,
  seedMemberSession,
  resetMockStore,
  setProviderMode,
  getInsertedCounts
} from './support/auth.ts';

// Authenticated admin coverage for the unified /submit workspace on the Kattis
// provider (deep link /submit/kattis preselects it). A deterministic Supabase
// session is seeded before app boot; the admin gate reads the mocked user_roles;
// the server-side Kattis page fetch (/api/kattis -> open.kattis.com) is
// redirected to the mock; all inserts land only in the mock's isolated in-memory
// store (reset per test). The workspace's two-phase flow (Preview links, then
// Add problems) is pinned here too: nothing is written before the final confirm.

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
  await page.waitForURL(/\/submit\?provider=kattis$/);
  await waitForShell(page);
  return errors;
}

const rows = (page: Page) => page.locator('[data-testid="preview-row"]');
const previewButton = (page: Page) => page.getByTestId('preview-button');
// Inline on desktop, pinned on mobile — target whichever copy is visible.
const confirmButton = (page: Page) =>
  page.locator(
    '[data-testid="confirm-button"]:visible, [data-testid="confirm-button-mobile"]:visible'
  );

async function stage(page: Page, text: string) {
  await page.getByLabel(/Problem URLs/i).fill(text);
  await previewButton(page).click();
}

test.describe('admin authorization gate', () => {
  test('a seeded admin sees the workspace with Kattis preselected', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    const pageHeading = page.getByRole('heading', { level: 1, name: /Submit Problems/i });
    await expect(pageHeading).toHaveCount(1);
    await expect(pageHeading).toHaveClass(/sr-only/);
    const headingBox = await pageHeading.boundingBox();
    expect(headingBox?.width).toBeLessThanOrEqual(1);
    expect(headingBox?.height).toBeLessThanOrEqual(1);
    await expect(page.getByLabel(/Problem URLs/i)).toBeVisible();
    await expect(page.getByTestId('provider-kattis')).toHaveAttribute('aria-checked', 'true');
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
    await expect(page.getByRole('heading', { name: /Submit Problems/i })).toHaveCount(0);
  });
});

test.describe('two-phase flow and submit paths', () => {
  test('@sanity previewing writes nothing until the final confirm', async ({ page }) => {
    await seedAdminSession(page);
    const errors = await gotoSubmit(page);

    await stage(page, KATTIS_PROBLEM);
    const row = rows(page).filter({ hasText: 'Mock Kattis Problem' });
    await expect(row).toBeVisible();
    expect(await getInsertedCounts()).toEqual({ problems: 0, contests: 0 });

    await confirmButton(page).click();
    await expect(row.getByText(/✓ Added/)).toBeVisible();
    expect(await getInsertedCounts()).toEqual({ problems: 1, contests: 0 });

    expectClean(errors, '/submit (single Kattis problem)');
  });

  test('adds a batch of two problems', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await stage(page, `${KATTIS_PROBLEM}\n${KATTIS_PROBLEM_2}`);
    await expect(rows(page)).toHaveCount(2);

    await confirmButton(page).click();
    await expect(rows(page).filter({ hasText: '✓ Added' })).toHaveCount(2);
    expect(await getInsertedCounts()).toEqual({ problems: 2, contests: 0 });
  });

  test('removing a staged row excludes it from the write', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await stage(page, `${KATTIS_PROBLEM}\n${KATTIS_PROBLEM_2}`);
    await expect(rows(page)).toHaveCount(2);
    await rows(page).last().getByTestId('remove-row').click();
    await expect(rows(page)).toHaveCount(1);

    await confirmButton(page).click();
    // Wait for the write to complete before reading the store.
    await expect(rows(page).filter({ hasText: '✓ Added' })).toHaveCount(1);
    expect(await getInsertedCounts()).toEqual({ problems: 1, contests: 0 });
  });

  test('invalid input surfaces an inline error and stages nothing', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill('https://codeforces.com/contest/1/problem/A');
    await previewButton(page).click();

    await expect(page.getByRole('alert')).toContainText(/No valid Kattis URLs/i);
    await expect(rows(page)).toHaveCount(0);
  });

  test('re-submitting the same problem previews a duplicate that cannot be added', async ({
    page
  }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await stage(page, KATTIS_PROBLEM);
    await confirmButton(page).click();
    await expect(rows(page).filter({ hasText: '✓ Added' })).toBeVisible();

    await stage(page, KATTIS_PROBLEM);
    const row = rows(page).filter({ hasText: /already exists/i });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-valid', 'false');
    await expect(confirmButton(page)).toBeDisabled();
  });

  test('a provider page-fetch failure degrades to the deterministic fallback', async ({ page }) => {
    // Documented existing behavior (fetchKattisProblemData): when the Kattis
    // page fetch fails, the service logs the error and FALLS BACK to a minimal
    // problem derived from the URL id (formatted name), still resolving to a
    // valid, addable row. This pins that fallback. A console error is emitted by
    // the fallback, so we do not assert a clean console here.
    await seedAdminSession(page);
    await setProviderMode('fail');
    await gotoSubmit(page);

    await stage(page, KATTIS_PROBLEM);
    const row = rows(page).filter({ hasText: 'Hello' });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-valid', 'true');
    await confirmButton(page).click();
    await expect(row.getByText(/✓ Added/)).toBeVisible();
  });
});

test.describe('provider switching', () => {
  test('switching providers clears any staged preview', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await stage(page, KATTIS_PROBLEM);
    await expect(rows(page)).toHaveCount(1);

    // Switching to Codeforces discards the Kattis preview so the Review stage
    // never mixes providers.
    await page.getByTestId('provider-codeforces').click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId('provider-codeforces')).toHaveAttribute('aria-checked', 'true');
  });
});
