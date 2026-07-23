import { test, expect, type Page } from '@playwright/test';
import { waitForShell } from './support/harness.ts';

// Layer B — live read-only Supabase smoke.
//
// This suite runs ONLY against a real Supabase project, to prove the app loads
// actual anonymous data end to end. It is opt-in and requires all three of:
//
//   SUPABASE_SMOKE=1
//   PUBLIC_SUPABASE_URL=<real project URL>
//   PUBLIC_SUPABASE_ANON_KEY=<real anon (publishable) key>
//
// In CI these come from repository secrets/variables (see README / the CI
// workflow). When they are absent the whole suite skips with an explicit
// message — it never silently passes, and it never invents credentials.
//
// Safety contract (enforced by only reading, never writing):
//   * Anonymous session only — no login, no OAuth, no form submission.
//   * Only public SELECT/RPC reads that the app issues for an anonymous
//     visitor (problems, contests, get_leaderboard) — all granted to `anon` in
//     sql/permissions.sql.
//   * The anon key is a publishable, client-safe key. NEVER use a service-role
//     key here.

const ENABLED =
  process.env.SUPABASE_SMOKE === '1' &&
  !!process.env.PUBLIC_SUPABASE_URL &&
  !!process.env.PUBLIC_SUPABASE_ANON_KEY &&
  process.env.PUBLIC_SUPABASE_URL !== 'http://localhost';

test.describe('live read-only Supabase smoke', () => {
  test.skip(
    !ENABLED,
    'live smoke disabled: set SUPABASE_SMOKE=1 with real PUBLIC_SUPABASE_URL and ' +
      'PUBLIC_SUPABASE_ANON_KEY (client-safe anon key) to enable. See README.'
  );

  async function loadResolved(page: Page, path: string) {
    await page.goto(path);
    await waitForShell(page);
    // Wait for the read to resolve out of the loading state.
    await expect(page.getByText(/Loading (problems|contests|leaderboard)/i)).toHaveCount(0, {
      timeout: 15_000
    });
    // A live read must not surface the failure banner.
    await expect(page.getByText(/Failed to load/i)).toHaveCount(0);
  }

  test('home loads real problems from Supabase', async ({ page }) => {
    await loadResolved(page, '/');
    // The problems table shell is present, and real data produced at least one
    // row. (Live data volume is unknown, so assert "> 0", not an exact count.)
    await expect(page.getByRole('columnheader', { name: /Problem/i })).toBeVisible();
    const rows = page.locator('table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    // Each rendered problem row links out to a real problem URL.
    const firstLink = rows.first().locator('td:nth-child(3) a');
    await expect(firstLink).toHaveAttribute('href', /^https?:\/\//);
  });

  test('contests loads real contests from Supabase', async ({ page }) => {
    await loadResolved(page, '/contests');
    await expect(page.getByRole('columnheader', { name: /Contest/i })).toBeVisible();
    expect(await page.locator('table tbody tr').count()).toBeGreaterThan(0);
  });

  test('leaderboard loads real entries from the get_leaderboard RPC', async ({ page }) => {
    await loadResolved(page, '/leaderboard');
    await expect(page.getByRole('columnheader', { name: /Rank/i })).toBeVisible();
    const rows = page.locator('table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    // The first entry links to an internal user page.
    await expect(rows.first().locator('a[href^="/user/"]').first()).toBeVisible();
  });
});
