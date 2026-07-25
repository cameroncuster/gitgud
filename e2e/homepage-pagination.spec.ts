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

test('homepage batches complete derived rows accessibly without a hydration refetch', async ({
  page
}) => {
  const response = await page.goto('/');
  const html = (await response?.text()) ?? '';
  const serverBody = html.match(/<tbody id="problem-table-body">([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  expect(new TextEncoder().encode(html).byteLength).toBeLessThanOrEqual(400_000);
  expect((serverBody.match(/<tr/g) ?? []).length).toBe(50);
  expect(html).not.toContain('date_added');

  const rows = page.locator('#problem-table-body > tr');
  await expect(rows).toHaveCount(50);
  await expect(page.getByText('50 of 280 problems shown')).toBeVisible();
  const showMore = page.getByRole('button', { name: 'Show 50 more problems' });
  await expect(showMore).toHaveAttribute('type', 'button');
  await expect(showMore).toHaveAttribute('aria-controls', 'problem-table-body');
  await page.waitForLoadState('networkidle');
  expect(await page.locator('*').count()).toBeLessThanOrEqual(2_500);
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

  await showMore.click();
  await expect(rows).toHaveCount(100);
  await expect(page.getByText('100 of 280 problems shown')).toBeVisible();

  await page.getByLabel('Filter by author').selectOption('beyond-author');
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Beyond First Batch' })).toBeVisible();
  await expect(page.getByRole('button', { name: /more problems|All problems shown/ })).toHaveCount(
    0
  );

  await page.getByLabel('Filter by author').selectOption('all');
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: /Difficulty, not sorted/i }).click();
  await expect(rows.first().getByRole('link', { name: 'Beyond First Batch' })).toBeVisible();

  for (const count of [100, 150, 200, 250]) {
    await page.getByRole('button', { name: 'Show 50 more problems' }).click();
    await expect(rows).toHaveCount(count);
  }
  const finalBatch = page.getByRole('button', { name: 'Show 30 more problems' });
  await finalBatch.click();
  await expect(rows).toHaveCount(280);
  const complete = page.getByRole('button', { name: 'All problems shown' });
  await expect(complete).toBeVisible();
  await expect(complete).toBeDisabled();
  await expect(complete).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('280 of 280 problems shown');
  expect((await problemReadMetadata()).problemsReadCount).toBe(1);
});

test('profile problem display remains unlimited', async ({ page }) => {
  await page.goto(`/user/${LEADERBOARD[0].user_id}`);
  await expect(page.locator('#problem-table-body > tr')).toHaveCount(280);
  await expect(page.getByRole('button', { name: /more problems|All problems shown/ })).toHaveCount(
    0
  );
});
