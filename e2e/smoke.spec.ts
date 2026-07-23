import { test, expect } from '@playwright/test';
import { collect, expectClean, waitForShell } from './support/harness.ts';
import { setScenario } from './support/scenario.ts';

// Shell, navigation, guard, and theme behavior. These run in the `data`
// scenario against the mock Supabase backend, which is reachable and returns
// representative fixtures — so, unlike the original placeholder-backed suite,
// they hold to a strict bar: no unexpected console errors and no failed network
// requests (see harness.ts). Data-content assertions live in data.spec.ts.

test.beforeEach(async () => {
  await setScenario('data');
});

const PUBLIC_ROUTES = [
  { path: '/', title: /Problems/i },
  { path: '/contests', title: /Contests/i },
  { path: '/leaderboard', title: /Leaderboard/i },
  { path: '/about', title: /About/i }
];

test.describe('public routes render without unexpected errors', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`loads ${route.path}`, async ({ page }) => {
      const errors = collect(page);
      await page.goto(route.path);
      await expect(page).toHaveTitle(route.title);
      await waitForShell(page);
      expectClean(errors, route.path);
    });
  }
});

test.describe('content shells render', () => {
  test('home page renders the problems table header', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('columnheader', { name: /Problem/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Difficulty/i })).toBeVisible();
  });

  test('leaderboard page renders a table with expected columns', async ({ page }) => {
    await page.goto('/leaderboard');
    const table = page.locator('table').first();
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Rank/i })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /User/i })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Solves/i })).toBeVisible();
  });

  test('contests page renders its shell', async ({ page }) => {
    await page.goto('/contests');
    await expect(page).toHaveTitle(/Contests/i);
    await waitForShell(page);
  });
});

test.describe('desktop navigation', () => {
  // The desktop nav is hidden below the lg breakpoint, so this behavior is
  // meaningful only on the desktop project.
  test.skip(
    ({ viewport }) => !!viewport && viewport.width < 1024,
    'desktop nav only visible at lg breakpoint'
  );

  const links = [
    { name: 'Contests', path: /\/contests$/ },
    { name: 'Leaderboard', path: /\/leaderboard$/ },
    { name: 'About', path: /\/about$/ },
    { name: 'Problems', path: /\/$/ }
  ];

  test('navigates through the primary nav links', async ({ page }) => {
    await page.goto('/');
    await waitForShell(page);
    const nav = page.getByRole('navigation').first();
    for (const link of links) {
      await nav.getByRole('link', { name: link.name, exact: true }).click();
      await page.waitForURL(link.path);
    }
  });
});

test.describe('mobile navigation', () => {
  // The hamburger menu is only rendered below the lg breakpoint.
  test.skip(
    ({ viewport }) => !!viewport && viewport.width >= 1024,
    'mobile menu only present below lg breakpoint'
  );

  test('opens the menu and navigates', async ({ page }) => {
    await page.goto('/');
    const openMenu = page.getByRole('button', { name: 'Open menu' });
    await expect(openMenu).toBeVisible();
    await openMenu.click();

    const mobileNav = page.getByRole('navigation').first();
    await mobileNav.getByRole('link', { name: 'Leaderboard', exact: true }).click();
    await page.waitForURL(/\/leaderboard$/);
    // Navigating closes the menu, so the open-menu button is shown again.
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  });
});

test.describe('anonymous guards', () => {
  // Both routes gate their content behind an authenticated session. For an
  // anonymous visitor the guard redirects home and never exposes the protected
  // UI. Asserting the redirect plus the absence of protected content captures
  // the guard against a reachable backend (where the session check resolves
  // quickly).
  test('anonymous /settings redirects home and never exposes the settings form', async ({
    page
  }) => {
    await page.goto('/settings');
    // The guard finds no session and redirects to the home route.
    await page.waitForURL(/\/$/);
    // The authenticated-only Privacy section is never reached.
    await expect(page.getByText('Privacy', { exact: true })).toHaveCount(0);
  });

  test('anonymous /submit redirects home and never exposes the submit options', async ({
    page
  }) => {
    await page.goto('/submit');
    await page.waitForURL(/\/$/);
    // The submit page's own UI (its heading and admin-only provider cards) is
    // never reached. (Asserted via the submit heading rather than a source
    // name, since the home page legitimately contains Codeforces/Kattis links.)
    await expect(page.getByRole('heading', { name: /Submit Problems/i })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/submit/);
  });
});

test.describe('theme startup', () => {
  test('defaults to the light (Paper) theme with no stored preference', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('honors a stored Dark Ink preference before first paint', async ({ page }) => {
    // Theme is controllable without auth via the same localStorage key the
    // pre-paint script reads; set it before any navigation.
    await page.addInitScript(() => {
      window.localStorage.setItem('gitgud-theme', 'dark');
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
