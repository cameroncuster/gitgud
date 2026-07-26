import { expect, test } from '@playwright/test';
import { resetMockStore } from './support/auth.ts';
import { LEADERBOARD } from './support/fixtures.ts';
import { MOCK_URL } from './support/constants.ts';
import { setScenario } from './support/scenario.ts';

async function problemReadMetadata(): Promise<{
  problemsReadCount: number;
  lastProblemsSelect: string | null;
}> {
  const response = await fetch(`${MOCK_URL}/__control/scenario`);
  return (await response.json()) as {
    problemsReadCount: number;
    lastProblemsSelect: string | null;
  };
}

test.beforeEach(async () => {
  await resetMockStore();
  await setScenario('large');
});

test('homepage renders every derived row without pagination or a hydration refetch', async ({
  page
}) => {
  const response = await page.goto('/');
  const html = (await response?.text()) ?? '';
  const serverBody = html.match(/<tbody id="problem-table-body">([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  expect(new TextEncoder().encode(html).byteLength).toBeLessThanOrEqual(1_350_000);
  expect((serverBody.match(/<tr/g) ?? []).length).toBe(280);
  expect(html).not.toContain('date_added');

  const rows = page.locator('#problem-table-body > tr');
  await expect(rows).toHaveCount(280);
  await expect(page.getByRole('button', { name: /more problems|All problems shown/ })).toHaveCount(
    0
  );
  await page.waitForLoadState('networkidle');
  const readMetadata = await problemReadMetadata();
  expect(readMetadata.problemsReadCount).toBe(1);
  expect(readMetadata.lastProblemsSelect?.split(',').map((column) => column.trim())).toEqual([
    'id',
    'name',
    'difficulty',
    'url',
    'added_by',
    'added_by_url',
    'likes',
    'dislikes',
    'type'
  ]);

  await page.getByLabel('Filter by author').selectOption('full-list-author');
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Full List Boundary Problem' })).toBeVisible();

  await page.getByLabel('Filter by author').selectOption('all');
  await expect(rows).toHaveCount(280);
  await page.getByRole('button', { name: /Difficulty, not sorted/i }).click();
  await expect(
    rows.first().getByRole('link', { name: 'Full List Boundary Problem' })
  ).toBeVisible();
  expect((await problemReadMetadata()).problemsReadCount).toBe(1);
});

test('profile problem display remains unlimited', async ({ page }) => {
  await page.goto(`/user/${LEADERBOARD[0].user_id}`);
  await expect(page.locator('#problem-table-body > tr')).toHaveCount(280);
  await expect(page.getByRole('button', { name: /more problems|All problems shown/ })).toHaveCount(
    0
  );
});
