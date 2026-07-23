import { test, expect, type Page } from '@playwright/test';
import { collect, expectClean, waitForShell } from './support/harness.ts';
import { setScenario } from './support/scenario.ts';
import {
  seedAdminSession,
  seedMemberSession,
  resetMockStore,
  setProviderMode,
  stubCodeforcesBrowserApi
} from './support/auth.ts';

// Authenticated admin submit-path coverage for /submit/codeforces.
//
// A deterministic Supabase session is seeded into localStorage before app boot
// (never real OAuth); the admin gate reads the mocked user_roles table, the
// server-side problemset resolve is redirected to the mock, and all inserts land
// only in the mock's isolated in-memory store (reset before each test). Both the
// browser-side Codeforces API (gym/contest) and the server-side problemset are
// stubbed, so no live provider is ever contacted.

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
  await waitForShell(page);
  return errors;
}

// Result rows live inside the results list; scope to it so the header/footer
// <li> elements (nav, etc.) never leak into row counts.
const rows = (page: Page) => page.locator('[data-testid="results"] li');

test.describe('admin authorization gate', () => {
  test('a seeded admin sees the submit form (not the denial)', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await expect(page).toHaveURL(/\/submit\/codeforces$/);
    await expect(page.getByRole('heading', { name: /Submit Codeforces/i })).toBeVisible();
    await expect(page.getByLabel(/Problem URLs/i)).toBeVisible();
    await expect(page.getByText(/do not have permission/i)).toHaveCount(0);
  });

  test('a seeded non-admin is denied and never sees the form', async ({ page }) => {
    await seedMemberSession(page);
    await gotoSubmit(page);

    // Stays on the page (has a session) but the admin-only form is withheld.
    await expect(page.getByText(/Only admins can submit/i)).toBeVisible();
    await expect(page.getByLabel(/Problem URLs/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Submit$/ })).toHaveCount(0);
  });

  test('an anonymous visitor is redirected home', async ({ page }) => {
    // No seeded session.
    await page.goto('/submit/codeforces');
    await page.waitForURL(/\/$/);
    await expect(page.getByRole('heading', { name: /Submit Codeforces/i })).toHaveCount(0);
  });
});

test.describe('admin submit happy paths', () => {
  test('submits a single problem successfully', async ({ page }) => {
    await seedAdminSession(page);
    const errors = await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill(CF_PROBLEM);
    await page.getByRole('button', { name: /^Submit$/ }).click();

    const row = rows(page).filter({ hasText: 'Mock CF Problem A' });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Problem added/i)).toBeVisible();
    await expect(row.getByText(/ID: problems-1/i)).toBeVisible();

    // Run summary reflects one success, zero failures.
    await expect(
      page.getByRole('status').filter({ hasText: /1 item added, 0 failures/i })
    ).toBeVisible();

    expectClean(errors, '/submit/codeforces (single problem)');
  });

  test('submits a contest successfully and badges it as a contest', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill(CF_CONTEST);
    await page.getByRole('button', { name: /^Submit$/ }).click();

    const row = rows(page).filter({ hasText: 'Mock Codeforces Round' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Contest', { exact: true })).toBeVisible();
    await expect(row.getByText(/Contest added/i)).toBeVisible();
  });

  test('submits a mixed batch of two problems and one contest', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill(`${CF_PROBLEM}\n${CF_PROBLEM_B}\n${CF_CONTEST}`);
    await page.getByRole('button', { name: /^Submit$/ }).click();

    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByText(/Problem added/i)).toHaveCount(2);
    await expect(page.getByText(/Contest added/i)).toHaveCount(1);
    await expect(
      page.getByRole('status').filter({ hasText: /3 items added, 0 failures/i })
    ).toBeVisible();
  });
});

test.describe('validation, duplicate, and provider-failure paths', () => {
  test('invalid input surfaces an inline error and processes nothing', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill('not a codeforces url\nhttps://example.com/foo');
    await page.getByRole('button', { name: /^Submit$/ }).click();

    await expect(page.getByRole('alert')).toContainText(/No valid Codeforces URLs/i);
    // No result rows are produced for input that yields no valid URLs.
    await expect(rows(page)).toHaveCount(0);
  });

  test('two distinct problems in one batch both insert (isolated store)', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill(`${CF_PROBLEM}\n${CF_PROBLEM_B}`);
    await page.getByRole('button', { name: /^Submit$/ }).click();

    // Both inserts succeed and receive distinct ids from the isolated store.
    await expect(page.getByText(/Problem added/i)).toHaveCount(2);
    await expect(page.getByText(/ID: problems-1/i)).toBeVisible();
    await expect(page.getByText(/ID: problems-2/i)).toBeVisible();
  });

  test('re-submitting an already-inserted problem reports it as a duplicate', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    // First submission inserts the problem.
    await page.getByLabel(/Problem URLs/i).fill(CF_PROBLEM);
    await page.getByRole('button', { name: /^Submit$/ }).click();
    await expect(page.getByText(/Problem added/i)).toBeVisible();

    // Second submission of the same URL hits the existence check and is denied.
    await page.getByLabel(/Problem URLs/i).fill(CF_PROBLEM);
    await page.getByRole('button', { name: /^Submit$/ }).click();
    await expect(page.getByText(/already exists/i)).toBeVisible();
  });

  test('a provider failure is reported per-item without crashing', async ({ page }) => {
    await seedAdminSession(page);
    // A GYM problem resolves via the browser-side Codeforces standings API
    // (not the server-side, in-memory-cached problemset), so driving the
    // browser stub to fail deterministically exercises the provider-failure
    // path without depending on the server catalog cache.
    await stubCodeforcesBrowserApi(page, 'fail');
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill('https://codeforces.com/gym/104427/problem/A');
    await page.getByRole('button', { name: /^Submit$/ }).click();

    const row = rows(page).first();
    await expect(row).toBeVisible();
    await expect(row.getByText(/✗/)).toBeVisible();
    // The run summary still resolves (no hang) and records the failure.
    await expect(
      page.getByRole('status').filter({ hasText: /0 items added, 1 failure/i })
    ).toBeVisible();
  });
});

test.describe('per-item classification placeholder', () => {
  test('each result row renders the classification placeholder slot', async ({ page }) => {
    await seedAdminSession(page);
    await gotoSubmit(page);

    await page.getByLabel(/Problem URLs/i).fill(CF_PROBLEM);
    await page.getByRole('button', { name: /^Submit$/ }).click();

    await expect(page.getByText(/Problem added/i)).toBeVisible();
    // The Gemini-ready slot exists and shows the empty placeholder for now.
    const slot = page.getByTestId('classification').first();
    await expect(slot).toContainText('Topic:');
    await expect(slot).toContainText('—');
  });
});
