import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetMockStore, seedMemberSession, setMutationMode } from './support/auth.ts';
import { CONTESTS, PROBLEMS } from './support/fixtures.ts';
import { setScenario } from './support/scenario.ts';

const problem = PROBLEMS[0];
const contest = CONTESTS[0];

function rowFor(page: Page, name: string): Locator {
  return page.getByRole('link', { name, exact: true }).locator('xpath=ancestor::tr');
}

test.beforeEach(async ({ page }) => {
  await setScenario('data');
  await resetMockStore();
  await seedMemberSession(page);
});

test('problem reactions persist the authoritative count across reload', async ({ page }) => {
  await page.goto('/');

  let row = rowFor(page, problem.name);
  await row.getByRole('button', { name: `Like, ${problem.likes} likes` }).click();
  await expect(
    row.getByRole('button', { name: `Like (liked), ${problem.likes + 1} likes` })
  ).toBeVisible();

  const response = await page.reload();
  expect(response?.headers()['cache-control']).toBe('no-store');
  row = rowFor(page, problem.name);
  await expect(
    row.getByRole('button', { name: `Like (liked), ${problem.likes + 1} likes` })
  ).toBeVisible();
});

test('problem reactions roll back when the RPC returns no authoritative row', async ({ page }) => {
  await setMutationMode('null');
  await page.goto('/');

  const row = rowFor(page, problem.name);
  await row.getByRole('button', { name: `Like, ${problem.likes} likes` }).click();

  await expect(page.getByRole('alert')).toContainText('Couldn’t save reaction. Try again.');
  await expect(row.getByRole('button', { name: `Like, ${problem.likes} likes` })).toBeVisible();
});

test('contest reactions wait for server confirmation', async ({ page }) => {
  await setMutationMode('delayed-success');
  await page.goto('/contests');

  const row = rowFor(page, contest.name);
  await row.getByRole('button', { name: `Like, ${contest.likes} likes` }).click();

  await expect(row.getByRole('button', { name: `Like, ${contest.likes} likes` })).toBeVisible();
  await expect(
    row.getByRole('button', { name: `Like (liked), ${contest.likes + 1} likes` })
  ).toBeVisible();
});

test('problem solved is optimistic and reloads after a failed write', async ({ page }) => {
  await setMutationMode('delayed-error');
  await page.goto('/');

  const row = rowFor(page, problem.name);
  await row.getByRole('button', { name: 'Mark as solved' }).click();

  await expect(row.getByRole('button', { name: 'Mark as unsolved' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Mark as solved' })).toBeVisible();
});

test('contest participation waits for server confirmation', async ({ page }) => {
  await setMutationMode('delayed-success');
  await page.goto('/contests');

  const row = rowFor(page, contest.name);
  await row.getByRole('button', { name: 'Mark as participated' }).click();

  await expect(row.getByRole('button', { name: 'Mark as participated' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Mark as not participated' })).toBeVisible();
});
