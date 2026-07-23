import { test, expect, type Page } from '@playwright/test';
import { collect, expectClean, waitForShell } from './support/harness.ts';
import { setScenario } from './support/scenario.ts';
import {
  seedAdminSession,
  seedMemberSession,
  resetMockStore,
  setProviderMode,
  getInsertedCounts,
  stubCodeforcesBrowserApi
} from './support/auth.ts';

// Authenticated admin coverage for the unified /submit workspace on the
// Codeforces provider (deep link /submit/codeforces preselects it).
//
// A deterministic Supabase session is seeded into localStorage before app boot
// (never real OAuth); the admin gate reads the mocked user_roles table, the
// server-side problemset resolve is redirected to the mock, and all inserts land
// only in the mock's isolated in-memory store (reset before each test). Both the
// browser-side Codeforces API (gym/contest) and the server-side problemset are
// stubbed, so no live provider is ever contacted.
//
// The workspace runs a strict two-phase flow: "Preview links" resolves metadata
// and runs the duplicate check WITHOUT writing, then "Add problems" inserts only
// the surviving valid rows. These specs pin that contract at the task level:
// zero writes before confirm, removal changes the write set, invalid rows cannot
// be submitted, the deep link preselects, and single/batch/error/duplicate all
// behave.

const CF_PROBLEM = 'https://codeforces.com/contest/1234/problem/A';
const CF_PROBLEM_B = 'https://codeforces.com/contest/1234/problem/B';
const CF_CONTEST = 'https://codeforces.com/contest/1234';

test.beforeEach(async ({ page }) => {
  await setScenario('data');
  await resetMockStore();
  await setProviderMode('ok');
  await stubCodeforcesBrowserApi(page, 'ok');
});

async function gotoSubmit(page: Page) {
  const errors = collect(page);
  await page.goto('/submit/codeforces');
  // The deep link redirects into the unified workspace with the provider
  // preselected.
  await page.waitForURL(/\/submit\?provider=codeforces$/);
  await waitForShell(page);
  return errors;
}

const rows = (page: Page) => page.locator('[data-testid="preview-row"]');
const previewButton = (page: Page) => page.getByTestId('preview-button');
// The final "Add problems" action is rendered inline on desktop and pinned to
// the bottom on mobile (only one is shown per viewport), so target the visible
// one regardless of project.
const confirmButton = (page: Page) =>
  page.locator(
    '[data-testid="confirm-button"]:visible, [data-testid="confirm-button-mobile"]:visible'
  );

async function stage(page: Page, text: string) {
  await page.getByLabel(/Problem URLs/i).fill(text);
  await previewButton(page).click();
}

test.describe('admin authorization gate', () => {
  test('a seeded admin sees the workspace (not the denial)', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    const pageHeading = page.getByRole('heading', { level: 1, name: /Submit Problems/i });
    await expect(pageHeading).toHaveCount(1);
    await expect(pageHeading).toHaveClass(/sr-only/);
    const headingBox = await pageHeading.boundingBox();
    expect(headingBox?.width).toBeLessThanOrEqual(1);
    expect(headingBox?.height).toBeLessThanOrEqual(1);
    await expect(page.getByLabel(/Problem URLs/i)).toBeVisible();
    await expect(page.getByTestId('provider-codeforces')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/Only admins can submit/i)).toHaveCount(0);
  });

  test('a seeded non-admin is denied and never sees the form', async ({ page }) => {
    await seedMemberSession(page);
    await gotoSubmit(page);

    await expect(page.getByText(/Only admins can submit/i)).toBeVisible();
    await expect(page.getByLabel(/Problem URLs/i)).toHaveCount(0);
    await expect(previewButton(page)).toHaveCount(0);
  });

  test('an anonymous visitor is redirected home', async ({ page }) => {
    await page.goto('/submit/codeforces');
    await page.waitForURL(/\/$/);
    await expect(page.getByRole('heading', { name: /Submit Problems/i })).toHaveCount(0);
  });
});

test.describe('deep-link provider preselection', () => {
  test('/submit/codeforces preselects the Codeforces provider', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);
    await expect(page.getByTestId('provider-codeforces')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('provider-kattis')).toHaveAttribute('aria-checked', 'false');
  });
});

test.describe('two-phase flow: zero writes before confirm', () => {
  test('previewing resolves rows but writes nothing until confirm', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await stage(page, CF_PROBLEM);

    // A staged, valid preview row exists...
    const row = rows(page).filter({ hasText: 'Mock CF Problem A' });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-valid', 'true');

    // ...but NOTHING has been written yet.
    expect(await getInsertedCounts()).toEqual({ problems: 0, contests: 0 });

    // Only after the explicit final confirm does the write happen.
    await confirmButton(page).click();
    await expect(row.getByText(/✓ Added/)).toBeVisible();
    expect(await getInsertedCounts()).toEqual({ problems: 1, contests: 0 });
  });
});

test.describe('removable rows change the write set', () => {
  test('removing a staged row excludes it from the write', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await stage(page, `${CF_PROBLEM}\n${CF_PROBLEM_B}`);
    await expect(rows(page)).toHaveCount(2);

    // Remove the second problem before confirming.
    const rowB = rows(page).filter({ hasText: 'Mock CF Problem B' });
    await rowB.getByTestId('remove-row').click();
    await expect(rows(page)).toHaveCount(1);

    // The final action reflects the reduced set (one problem).
    await expect(confirmButton(page)).toHaveText(/Add 1\s+problem/);
    await confirmButton(page).click();
    // Wait for the write to complete (the row flips to Added) before reading.
    await expect(rows(page).filter({ hasText: '✓ Added' })).toHaveCount(1);

    // Exactly one problem is written; the removed row never reached the store.
    expect(await getInsertedCounts()).toEqual({ problems: 1, contests: 0 });
  });
});

test.describe('invalid entries cannot be submitted', () => {
  test('an invalid row is flagged and excluded; only valid rows write', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    // One resolvable problem plus one problem that is not in the problemset
    // (provider notfound), which resolves to an invalid row.
    await setProviderMode('notfound');
    await stubCodeforcesBrowserApi(page, 'notfound');
    await stage(page, `${CF_PROBLEM}\n${CF_PROBLEM_B}`);

    await expect(rows(page)).toHaveCount(2);
    // Both are invalid under notfound, so the confirm action is disabled and
    // nothing can be submitted.
    await expect(rows(page).filter({ has: page.locator('[data-valid="true"]') })).toHaveCount(0);
    await expect(confirmButton(page)).toBeDisabled();

    // Even attempting a click writes nothing.
    expect(await getInsertedCounts()).toEqual({ problems: 0, contests: 0 });
  });

  test('invalid input surfaces an inline error and stages nothing', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill('not a codeforces url\nhttps://example.com/foo');
    await previewButton(page).click();

    await expect(page.getByRole('alert')).toContainText(/No valid Codeforces URLs/i);
    await expect(rows(page)).toHaveCount(0);
    expect(await getInsertedCounts()).toEqual({ problems: 0, contests: 0 });
  });
});

test.describe('single / batch / contest / duplicate paths', () => {
  test('@sanity adds a single problem successfully', async ({ page }) => {
    await seedAdminSession(page);
    const errors = await gotoSubmit(page);

    await stage(page, CF_PROBLEM);
    const row = rows(page).filter({ hasText: 'Mock CF Problem A' });
    await confirmButton(page).click();
    await expect(row.getByText(/✓ Added/)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /1\s+problem added/i })).toBeVisible();

    expectClean(errors, '/submit (single CF problem)');
  });

  test('adds a contest and badges it as a contest', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await stage(page, CF_CONTEST);
    const row = rows(page).filter({ hasText: 'Mock Codeforces Round' });
    await expect(row.getByText('Contest', { exact: true })).toBeVisible();

    await confirmButton(page).click();
    await expect(row.getByText(/✓ Added/)).toBeVisible();
    expect(await getInsertedCounts()).toEqual({ problems: 0, contests: 1 });
  });

  test('adds a mixed batch of two problems and one contest', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await stage(page, `${CF_PROBLEM}\n${CF_PROBLEM_B}\n${CF_CONTEST}`);
    await expect(rows(page)).toHaveCount(3);

    await confirmButton(page).click();
    await expect(rows(page).filter({ hasText: '✓ Added' })).toHaveCount(3);
    expect(await getInsertedCounts()).toEqual({ problems: 2, contests: 1 });
  });

  test('re-submitting an already-inserted problem previews it as a duplicate', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    // First run inserts the problem.
    await stage(page, CF_PROBLEM);
    await confirmButton(page).click();
    await expect(rows(page).filter({ hasText: '✓ Added' })).toBeVisible();

    // Second run: the duplicate is caught at resolve time (before any write) and
    // surfaces as an invalid, non-submittable row.
    await page.getByTestId('provider-codeforces').click(); // no-op reselect keeps provider
    await stage(page, CF_PROBLEM);
    const row = rows(page).filter({ hasText: /already exists/i });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-valid', 'false');
    await expect(confirmButton(page)).toBeDisabled();
  });

  test('a provider failure surfaces per-item as invalid without crashing', async ({ page }) => {
    await seedAdminSession(page);
    // A gym problem resolves via the browser-side standings API; drive it to
    // fail deterministically.
    await stubCodeforcesBrowserApi(page, 'fail');
    await gotoSubmit(page);

    await stage(page, 'https://codeforces.com/gym/104427/problem/A');
    const row = rows(page).first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-valid', 'false');
    await expect(confirmButton(page)).toBeDisabled();
    expect(await getInsertedCounts()).toEqual({ problems: 0, contests: 0 });
  });
});

test.describe('mobile final-action usability', () => {
  test('the Add action is reachable and works on a mobile viewport', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mocked-mobile', 'mobile-only assertion');
    await seedAdminSession(page);
    await gotoSubmit(page);

    await stage(page, CF_PROBLEM);
    // The sticky action stays in view without scrolling and is clickable.
    const confirm = confirmButton(page);
    await expect(confirm).toBeInViewport();
    await confirm.click();
    await expect(rows(page).filter({ hasText: '✓ Added' })).toBeVisible();
  });
});
