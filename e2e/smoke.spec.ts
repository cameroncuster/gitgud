import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// Anonymous smoke suite. Every test runs without authentication and performs
// only public reads and navigation — no login, form submission, or remote
// mutation. Data assertions are deliberately structural (headings, columns,
// nav, guards) so they stay green regardless of the live content behind the
// public Supabase reads.

// The suite runs against a placeholder Supabase (see playwright.config.ts), so
// the client-side data fetch fails with a benign network error. Allow only
// that known-benign class of message; anything else is treated as an
// unexpected error.
const BENIGN_CONSOLE = [
  /Failed to fetch/i,
  /fetch failed/i,
  /Error (fetching|loading)/i,
  /ECONNREFUSED/i,
  /NetworkError/i,
  /net::ERR/i,
  /Failed to load resource/i,
  /favicon/i
];

function isBenign(text: string): boolean {
  return BENIGN_CONSOLE.some((re) => re.test(text));
}

// Attach console/pageerror collectors and return the list of unexpected
// messages seen so far. Data-layer network failures against the placeholder
// backend are filtered out; genuine script errors are not.
function trackPageErrors(page: Page): string[] {
  const unexpected: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !isBenign(msg.text())) {
      unexpected.push(`console.error: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err: Error) => {
    if (!isBenign(err.message)) {
      unexpected.push(`pageerror: ${err.message}`);
    }
  });
  return unexpected;
}

// The app hydrates client-side; the header "Home" link is present in the
// server-rendered HTML, so waiting for it to be visible is a cheap, reliable
// signal that the shell is up. Anchor-based nav then behaves consistently.
async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
}

const PUBLIC_ROUTES = [
  { path: '/', title: /Problems/i },
  { path: '/contests', title: /Contests/i },
  { path: '/leaderboard', title: /Leaderboard/i },
  { path: '/about', title: /About/i }
];

test.describe('public routes render without unexpected errors', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`loads ${route.path}`, async ({ page }) => {
      const errors = trackPageErrors(page);
      await page.goto(route.path);
      await expect(page).toHaveTitle(route.title);
      await waitForShell(page);
      expect(errors, `unexpected page/console errors on ${route.path}`).toEqual([]);
    });
  }
});

test.describe('content shells render (structure only, no data assertions)', () => {
  // The home problems table renders its column headers from the client shell
  // independent of how many rows come back.
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

  // Contests renders a loading state until data resolves, and with the
  // placeholder backend it never resolves to rows — so assert the durable page
  // shell (title + header) rather than the data-dependent table.
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
  // anonymous visitor the guard must never expose the protected UI — it either
  // redirects home or holds the page in its pre-auth state. Asserting the
  // protected content is absent captures the guard without depending on the
  // session-check network timing (which is non-deterministic against the
  // placeholder backend).
  test('anonymous /settings never exposes the settings form', async ({ page }) => {
    await page.goto('/settings');
    await waitForShell(page);
    // The pre-auth state is the loading placeholder; the settings form (the
    // authenticated-only Privacy section) is never reached without a session.
    await expect(page.getByText(/Loading settings/i)).toBeVisible();
    await expect(page.getByText('Privacy', { exact: true })).toHaveCount(0);
  });

  test('anonymous /submit never exposes the submit options', async ({ page }) => {
    await page.goto('/submit');
    await waitForShell(page);
    // The pre-auth state is the permission check; the provider cards
    // (authenticated admin-only) are never reached without a session.
    await expect(page.getByText(/Checking permissions/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Codeforces/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Kattis/i })).toHaveCount(0);
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
