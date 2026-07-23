import { test, expect, type Page } from '@playwright/test';
import { collect, expectClean, waitForShell } from './support/harness.ts';
import { PROBLEMS, CONTESTS, LEADERBOARD } from './support/fixtures.ts';
import { setScenario } from './support/scenario.ts';
import { getProblemSource } from '../src/lib/services/problemSource.ts';

test.beforeEach(async () => {
  await setScenario('data');
});

// Deterministic data assertions against the mock Supabase backend (the `data`
// scenario). These verify that the exact fixture rows — the ones the mock
// serves for /rest/v1/problems, /rest/v1/contests, and the get_leaderboard RPC
// — actually render as rows, with correct external links, and that the client
// filters and sorts operate on that real data. Every test also asserts a clean
// console/network (harness strict mode), so a data regression that also logs an
// error cannot slip through.

// Problems sorted by score (likes - dislikes) descending, matching
// sortProblemsByScore in ProblemDisplay.svelte.
const problemsByScore = [...PROBLEMS].sort((a, b) => b.likes - b.dislikes - (a.likes - a.dislikes));

async function gotoClean(page: Page, path: string) {
  const errors = collect(page);
  await page.goto(path);
  await waitForShell(page);
  return errors;
}

test.describe('problems data', () => {
  test('renders every fixture problem as a linked row in score order', async ({ page }) => {
    const errors = await gotoClean(page, '/');

    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(PROBLEMS.length);

    // Each problem name links to its external problem URL.
    for (const p of PROBLEMS) {
      const link = page.getByRole('link', { name: p.name, exact: true });
      await expect(link).toHaveAttribute('href', p.url);
      await expect(link).toHaveAttribute('target', '_blank');
    }

    // Default order is by score (likes - dislikes) descending.
    const nameCells = page.locator('table tbody tr td:nth-child(3)');
    await expect(nameCells).toHaveText(problemsByScore.map((p) => p.name));

    // The recommender links point at each author's profile URL.
    for (const p of PROBLEMS) {
      const authorLink = page.getByRole('link', { name: `@${p.added_by}`, exact: true }).first();
      await expect(authorLink).toHaveAttribute('href', p.added_by_url);
    }

    // A problem with a null type renders the "NEW!" badge instead of a topic.
    await expect(page.getByText('NEW!', { exact: true })).toHaveCount(
      PROBLEMS.filter((p) => p.type === null).length
    );

    expectClean(errors, '/ (problems data)');
  });

  test('the source filter narrows problems to a single source', async ({ page }) => {
    await gotoClean(page, '/');
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(PROBLEMS.length);

    const sourceFilter = page.getByRole('button', { name: /Filter by source/i });

    // First click -> codeforces only.
    await sourceFilter.click();
    const codeforces = PROBLEMS.filter((p) => getProblemSource(p.url) === 'codeforces');
    await expect(rows).toHaveCount(codeforces.length);
    for (const p of codeforces) {
      await expect(page.getByRole('link', { name: p.name, exact: true })).toBeVisible();
    }

    // Second click -> kattis only.
    await sourceFilter.click();
    const kattis = PROBLEMS.filter((p) => getProblemSource(p.url) === 'kattis');
    await expect(rows).toHaveCount(kattis.length);
    for (const p of kattis) {
      await expect(page.getByRole('link', { name: p.name, exact: true })).toBeVisible();
    }
  });

  test('the recommender filter narrows problems to a single author', async ({ page }) => {
    await gotoClean(page, '/');
    const rows = page.locator('table tbody tr');

    const author = 'alice';
    const byAuthor = PROBLEMS.filter((p) => p.added_by === author);
    // Sanity: the fixture author owns more than one problem, so the filter is
    // meaningfully narrowing.
    expect(byAuthor.length).toBeGreaterThan(1);
    expect(byAuthor.length).toBeLessThan(PROBLEMS.length);

    await page.getByLabel('Filter by author').first().selectOption(author);
    await expect(rows).toHaveCount(byAuthor.length);
    for (const p of byAuthor) {
      await expect(page.getByRole('link', { name: p.name, exact: true })).toBeVisible();
    }
  });

  test('sorting by difficulty reorders the problems ascending', async ({ page }) => {
    await gotoClean(page, '/');
    const nameCells = page.locator('table tbody tr td:nth-child(3)');

    // Clicking the Difficulty header once sorts ascending.
    await page.getByRole('columnheader', { name: /Difficulty/i }).click();

    const ascending = [...PROBLEMS].sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0));
    await expect(nameCells).toHaveText(ascending.map((p) => p.name));
  });
});

test.describe('contests data', () => {
  test('renders every fixture contest as a linked row', async ({ page }) => {
    const errors = await gotoClean(page, '/contests');

    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(CONTESTS.length);

    for (const c of CONTESTS) {
      const link = page.getByRole('link', { name: c.name, exact: true });
      await expect(link).toHaveAttribute('href', c.url);
      await expect(link).toHaveAttribute('target', '_blank');
    }

    // Default order is by score (likes - dislikes) descending.
    const byScore = [...CONTESTS].sort((a, b) => b.likes - b.dislikes - (a.likes - a.dislikes));
    // Contest name is the third cell (participation, source icon, name).
    const nameCells = page.locator('table tbody tr td:nth-child(3)');
    await expect(nameCells).toHaveText(byScore.map((c) => c.name));

    expectClean(errors, '/contests (contests data)');
  });

  test('the contest type filter separates ICPC from Codeforces', async ({ page }) => {
    await gotoClean(page, '/contests');
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(CONTESTS.length);

    const typeFilter = page.getByRole('button', { name: /Filter by contest type/i });

    await typeFilter.click();
    const icpc = CONTESTS.filter((c) => c.type === 'ICPC');
    await expect(rows).toHaveCount(icpc.length);
    for (const c of icpc) {
      await expect(page.getByRole('link', { name: c.name, exact: true })).toBeVisible();
    }
  });
});

test.describe('leaderboard data', () => {
  test('renders every fixture entry with rank, links, and solves', async ({ page }) => {
    const errors = await gotoClean(page, '/leaderboard');

    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(LEADERBOARD.length);

    // Rows are shown in the rank order the RPC returns.
    const byRank = [...LEADERBOARD].sort((a, b) => a.rank - b.rank);
    for (let i = 0; i < byRank.length; i++) {
      const entry = byRank[i];
      const row = rows.nth(i);
      // Rank bubble.
      await expect(row.getByText(String(entry.rank), { exact: true })).toBeVisible();
      // Username links to the internal user page.
      const userLink = row.getByRole('link', { name: `@${entry.username}`, exact: true });
      await expect(userLink).toHaveAttribute('href', `/user/${entry.user_id}`);
      // GitHub link is external.
      const ghLink = row.getByRole('link', {
        name: new RegExp(`${entry.username}.*GitHub`, 'i')
      });
      await expect(ghLink).toHaveAttribute('href', entry.github_url);
      // Solves count.
      await expect(row.getByText(String(entry.problems_solved), { exact: true })).toBeVisible();
    }

    expectClean(errors, '/leaderboard (leaderboard data)');
  });
});
