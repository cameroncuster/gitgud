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

test.describe('accessible sortable/filterable table headers', () => {
  // The Difficulty column header is a real, keyboard-operable control: a button
  // inside a th that carries aria-sort. These assertions run on the empty shell
  // (no data needed) and would fail against the old mouse-only `th on:click`.
  test('home Difficulty header is a button and exposes sort state via aria-sort', async ({
    page
  }) => {
    await page.goto('/');
    const difficultyHeader = page.getByRole('columnheader', { name: /Difficulty/i });
    await expect(difficultyHeader).toBeVisible();
    // Not yet sorted.
    await expect(difficultyHeader).toHaveAttribute('aria-sort', 'none');

    const sortButton = difficultyHeader.getByRole('button', { name: /Difficulty/i });
    await expect(sortButton).toBeVisible();

    // Activate via the keyboard (Enter) — the whole point of the semantic
    // control — and confirm the sort state advances to ascending.
    await sortButton.focus();
    await page.keyboard.press('Enter');
    await expect(difficultyHeader).toHaveAttribute('aria-sort', 'ascending');

    // Space advances again (ascending -> descending).
    await page.keyboard.press('Space');
    await expect(difficultyHeader).toHaveAttribute('aria-sort', 'descending');
  });

  // Runtime guard for the row-class interpolation bug: a `${...}` left inside a
  // plain class="..." attribute is emitted as literal text into the DOM. The
  // table shells must never contain a stray `${` in their rendered markup.
  test('rendered tables contain no un-evaluated ${ class interpolation', async ({ page }) => {
    for (const path of ['/', '/contests']) {
      await page.goto(path);
      // Wait on the same readiness signal the other table tests use — the
      // Difficulty header — so the async ProblemDisplay/contest fetch has
      // resolved and the table is rendered before we snapshot its markup.
      await expect(page.getByRole('columnheader', { name: /Difficulty/i })).toBeVisible();
      const html = await page
        .locator('table')
        .first()
        .evaluate((el) => el.outerHTML);
      expect(html).not.toContain('${');
    }
  });

  test('home solved-status filter header is a button with an accessible name', async ({ page }) => {
    await page.goto('/');
    // The filter control announces its purpose and current state via aria-label.
    const filterButton = page.getByRole('button', { name: /Filter by solved status/i });
    await expect(filterButton).toBeVisible();
    await expect(filterButton).toHaveAccessibleName(/showing all/i);

    // Keyboard activation cycles the filter and updates the accessible name.
    await filterButton.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: /Filter by solved status/i })
    ).toHaveAccessibleName(/showing solved/i);
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

test.describe('viewport allows pinch zoom', () => {
  // The viewport meta must not disable user scaling: no maximum-scale and no
  // user-scalable=no, on every route, on desktop and mobile.
  const routes = ['/', '/contests', '/leaderboard', '/about'];
  for (const path of routes) {
    test(`viewport on ${path} does not block zoom`, async ({ page }) => {
      await page.goto(path);
      const content = await page.locator('meta[name="viewport"]').first().getAttribute('content');
      expect(content, `viewport meta on ${path}`).toBeTruthy();
      expect(content!).not.toMatch(/maximum-scale/i);
      expect(content!).not.toMatch(/user-scalable\s*=\s*no/i);
      // A single viewport meta avoids a restrictive one overriding the base.
      await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
    });
  }
});

test.describe('route heading hierarchy', () => {
  // Every anonymously reachable route must expose exactly one meaningful h1
  // (visible or sr-only) and the heading levels must not skip (no h1 -> h3).
  // Guarded routes (e.g. /submit) redirect anonymous visitors, so their headings
  // are covered where they render, not here.
  const routes = [
    { path: '/', h1: /Problems/i },
    { path: '/contests', h1: /Contests/i },
    { path: '/leaderboard', h1: /Leaderboard/i },
    { path: '/about', h1: /gitgud/i }
  ];
  for (const route of routes) {
    test(`${route.path} has exactly one meaningful h1`, async ({ page }) => {
      await page.goto(route.path);
      await waitForShell(page);
      const h1s = page.locator('h1');
      await expect(h1s).toHaveCount(1);
      await expect(h1s.first()).toHaveText(route.h1);

      // Heading levels must not skip from h1 straight to h3+.
      const levels = await page.$$eval('h1, h2, h3, h4, h5, h6', (els) =>
        els.map((el) => Number(el.tagName.substring(1)))
      );
      let previous = 0;
      for (const level of levels) {
        if (previous !== 0) {
          expect(level, `heading jump on ${route.path}`).toBeLessThanOrEqual(previous + 1);
        }
        previous = level;
      }
      // The first heading on the page is the h1.
      expect(levels[0], `first heading on ${route.path}`).toBe(1);
    });
  }
});

test.describe('mobile menu state, Escape, and focus', () => {
  // These behaviors only exist below the lg breakpoint where the hamburger
  // menu renders.
  test.skip(
    ({ viewport }) => !!viewport && viewport.width >= 1024,
    'mobile menu only present below lg breakpoint'
  );

  test('toggle button exposes aria-expanded and aria-controls', async ({ page }) => {
    await page.goto('/');
    await waitForShell(page);
    const toggle = page.getByRole('button', { name: 'Open menu' });
    await expect(toggle).toHaveAttribute('aria-controls', 'mobile-menu');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    // The accessible name flips to Close menu while open.
    const closeToggle = page.getByRole('button', { name: 'Close menu' });
    await expect(closeToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#mobile-menu')).toBeVisible();
  });

  test('Escape closes the menu and returns focus to the toggle', async ({ page }) => {
    await page.goto('/');
    await waitForShell(page);
    const toggle = page.getByRole('button', { name: 'Open menu' });
    await toggle.click();
    await expect(page.locator('#mobile-menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#mobile-menu')).toHaveCount(0);
    // Focus returns to the toggle button so keyboard users are not stranded.
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });
});

test.describe('skip link', () => {
  // A keyboard-visible skip link must let users bypass the header and land on
  // a stable main-content target.
  test('is hidden until focused, then reveals and targets main-content', async ({ page }) => {
    await page.goto('/');
    await waitForShell(page);

    const skip = page.getByRole('link', { name: 'Skip to main content' });
    // Present in the DOM and pointed at the stable target id.
    await expect(skip).toHaveAttribute('href', '#main-content');

    const main = page.locator('main#main-content');
    await expect(main).toHaveCount(1);
    // The target id is nonempty.
    const id = await main.getAttribute('id');
    expect(id).toBeTruthy();

    // Visually hidden until focused: the first Tab from the top of the page
    // lands on the skip link and reveals it (not-sr-only removes the clip).
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });

  test('activating it moves focus to main content', async ({ page }) => {
    await page.goto('/');
    await waitForShell(page);

    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');

    // The fragment navigation moves focus to the focusable main region so the
    // next Tab continues from the content, not the header.
    const main = page.locator('main#main-content');
    await expect(main).toBeFocused();
    expect(page.url()).toContain('#main-content');
  });
});

test.describe('unknown route (404)', () => {
  test('renders a meaningful title and heading', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle(/404/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/404/);
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
