import { test, expect, type Page } from '@playwright/test';
import { collect, expectClean, waitForShell } from './support/harness.ts';
import { setScenario } from './support/scenario.ts';
import {
  seedMemberSession,
  resetMockStore,
  setProviderMode,
  getSolvedWriteAttempts,
  type ProviderMode
} from './support/auth.ts';

// Codeforces solved-problem import coverage for the Settings page.
//
// A deterministic Supabase session is seeded into localStorage before app boot
// (never real OAuth). The authenticated user-solves route authorizes the caller
// via the seeded Bearer token, the server-side Codeforces user.status fetch is
// redirected to the mock, tracked-problem intersection reads the fixture
// problems, and all writes land only in the mock's isolated, user-scoped
// in-memory store (reset before each test). No live provider is ever contacted.

const HANDLE = 'tourist';
// The two tracked fixture problems the mock's accepted solves intersect.
const TRACKED_MATCHES = 2;

test.beforeEach(async ({ page }) => {
  await setScenario('data');
  await resetMockStore();
  await setProviderMode('ok');
  // Block any accidental real Codeforces call from the browser side.
  await page.route('https://codeforces.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'OK', result: [] })
    })
  );
});

async function gotoSettings(page: Page) {
  const errors = collect(page);
  await page.goto('/settings');
  await waitForShell(page);
  return errors;
}

// The import section is the card whose header holds the exact section title.
// Scoping to it keeps assertions off the unrelated Privacy/Theme cards.
const importCard = (page: Page) =>
  page.locator('section', {
    has: page.getByText('Import solved problems', { exact: true })
  });

async function preview(page: Page, handle = HANDLE) {
  await page.getByPlaceholder('Codeforces handle').fill(handle);
  await page.getByRole('button', { name: /^Preview$/ }).click();
}

test.describe('authorization', () => {
  test('an anonymous visitor is redirected home and never sees the import UI', async ({ page }) => {
    // No seeded session.
    await page.goto('/settings');
    await page.waitForURL(/\/$/);
    await expect(page.getByText('Import solved problems')).toHaveCount(0);
    await expect(page.getByPlaceholder('Codeforces handle')).toHaveCount(0);
  });

  test('an anonymous direct call to the route is denied without writing', async ({ request }) => {
    const res = await request.get('/api/codeforces/user-solves?handle=tourist');
    expect(res.status()).toBe(401);
    expect(await getSolvedWriteAttempts()).toBe(0);
  });
});

test.describe('preview (read-only)', () => {
  test('preview shows only tracked matches and performs zero writes', async ({ page }) => {
    await seedMemberSession(page);
    const errors = await gotoSettings(page);

    await preview(page);

    const card = importCard(page);
    await expect(
      card.getByText(new RegExp(`${TRACKED_MATCHES} solved problems? matched`))
    ).toBeVisible();
    // The untracked accepted solve is surfaced as a not-tracked count, never imported.
    await expect(card.getByText(/not tracked here/i)).toBeVisible();

    // Read-only: previewing must not write a single solved row.
    expect(await getSolvedWriteAttempts()).toBe(0);
    expectClean(errors, '/settings preview');
  });

  test('an empty handle surfaces an inline error and does not call the provider', async ({
    page
  }) => {
    await seedMemberSession(page);
    await gotoSettings(page);

    await page.getByRole('button', { name: /^Preview$/ }).click();
    await expect(page.getByText(/Enter a Codeforces handle/i)).toBeVisible();
    expect(await getSolvedWriteAttempts()).toBe(0);
  });
});

test.describe('confirm (server-derived, idempotent)', () => {
  test('confirm imports only the server-derived tracked matches for the current user', async ({
    page
  }) => {
    await seedMemberSession(page);
    const errors = await gotoSettings(page);

    await preview(page);
    const card = importCard(page);
    await card.getByRole('button', { name: new RegExp(`Import ${TRACKED_MATCHES}`) }).click();

    await expect(
      card.getByText(new RegExp(`Imported ${TRACKED_MATCHES} newly solved`))
    ).toBeVisible();
    expectClean(errors, '/settings confirm');
  });

  test('re-running the import is idempotent (0 newly solved on the second pass)', async ({
    page
  }) => {
    await seedMemberSession(page);
    await gotoSettings(page);

    // First import writes the two matches.
    await preview(page);
    let card = importCard(page);
    await card.getByRole('button', { name: new RegExp(`Import ${TRACKED_MATCHES}`) }).click();
    await expect(
      card.getByText(new RegExp(`Imported ${TRACKED_MATCHES} newly solved`))
    ).toBeVisible();

    // Second import of the same handle imports zero new rows (idempotent).
    await preview(page);
    card = importCard(page);
    await card.getByRole('button', { name: new RegExp(`Import ${TRACKED_MATCHES}`) }).click();
    await expect(card.getByText(/Imported 0 newly solved/)).toBeVisible();
  });
});

test.describe('Kattis local paste and file import', () => {
  async function selectKattis(page: Page): Promise<void> {
    await page.getByRole('radio', { name: 'Kattis' }).check();
  }

  test('paste preview reports counts without contacting Kattis', async ({ page }) => {
    const kattisRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname === 'open.kattis.com' || url.hostname.endsWith('.kattis.com')) {
        kattisRequests.push(request.url());
      }
    });
    await seedMemberSession(page);
    await gotoSettings(page);
    await selectKattis(page);

    await page
      .getByRole('textbox', { name: 'Kattis problem IDs or URLs' })
      .fill('gamma missing gamma https://open.kattis.com/problems/gamma');
    await page.getByRole('button', { name: /^Preview$/ }).click();

    const card = importCard(page);
    await expect(card.getByText(/1 solved problem matched/i)).toBeVisible();
    await expect(card.getByText(/1 unmatched/i)).toBeVisible();
    await expect(card.getByText(/2 duplicates removed/i)).toBeVisible();
    expect(await getSolvedWriteAttempts()).toBe(0);
    expect(kattisRequests).toEqual([]);
  });

  test('local HTML file is parsed in-browser and imports the re-derived tracked UUID', async ({
    page
  }) => {
    await seedMemberSession(page);
    await gotoSettings(page);
    await selectKattis(page);

    await page.getByLabel(/Choose local .txt or .html file/i).setInputFiles({
      name: 'kattis-solves.html',
      mimeType: 'text/html',
      buffer: Buffer.from(
        '<a href="https://open.kattis.com/problems/gamma">Gamma</a>' +
          '<a href="https://evil.test/problems/fabricated">Ignore</a>'
      )
    });
    await expect(page.getByText(/Loaded kattis-solves.html/i)).toBeVisible();
    await page.getByRole('button', { name: /^Preview$/ }).click();
    await expect(importCard(page).getByText(/1 solved problem matched/i)).toBeVisible();
    await page.getByRole('button', { name: 'Import 1' }).click();
    await expect(importCard(page).getByText(/Imported 1 newly solved problem/i)).toBeVisible();
  });

  test('invalid replacement clears the previous local-file payload', async ({ page }) => {
    await seedMemberSession(page);
    await gotoSettings(page);
    await selectKattis(page);
    const fileInput = page.getByLabel(/Choose local .txt or .html file/i);

    await fileInput.setInputFiles({
      name: 'old.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('gamma')
    });
    await expect(page.getByText(/Loaded old.txt/i)).toBeVisible();
    await fileInput.setInputFiles({
      name: 'too-large.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(2_000_001, 'a')
    });
    await expect(importCard(page).getByText(/File is too large/i)).toBeVisible();
    await expect(page.getByText(/Loaded old.txt/i)).toHaveCount(0);
    await page.getByRole('button', { name: /^Preview$/ }).click();
    await expect(page.getByText(/Paste Kattis problem IDs or choose a file/i)).toBeVisible();
    expect(await getSolvedWriteAttempts()).toBe(0);
  });

  test('the latest local file wins when reads complete out of order', async ({ page }) => {
    await page.addInitScript(() => {
      const readFile = File.prototype.text;
      File.prototype.text = async function () {
        const contents = await readFile.call(this);
        await new Promise((resolve) => setTimeout(resolve, this.name === 'slow.txt' ? 150 : 0));
        return contents;
      };
    });
    await seedMemberSession(page);
    await gotoSettings(page);
    await selectKattis(page);
    const fileInput = page.getByLabel(/Choose local .txt or .html file/i);

    await fileInput.setInputFiles({
      name: 'slow.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('missing')
    });
    await fileInput.setInputFiles({
      name: 'latest.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('gamma')
    });
    await expect(page.getByText(/Loaded latest.txt/i)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Kattis problem IDs or URLs' })).toHaveValue(
      'gamma'
    );
    await page.waitForTimeout(200);
    await expect(page.getByText(/Loaded latest.txt/i)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Kattis problem IDs or URLs' })).toHaveValue(
      'gamma'
    );
  });
});

test.describe('provider failure paths', () => {
  const cases: { mode: ProviderMode; expected: RegExp }[] = [
    { mode: 'notfound', expected: /not found on Codeforces/i },
    { mode: 'ratelimited', expected: /rate limit/i },
    { mode: 'fail', expected: /Failed to fetch solves/i },
    { mode: 'malformed', expected: /Unexpected response from Codeforces/i }
  ];

  for (const { mode, expected } of cases) {
    test(`provider mode "${mode}" surfaces a safe inline error and writes nothing`, async ({
      page
    }) => {
      await seedMemberSession(page);
      await gotoSettings(page);
      await setProviderMode(mode);

      await preview(page);

      await expect(importCard(page).getByText(expected)).toBeVisible();
      // No import controls appear and nothing was written.
      await expect(page.getByRole('button', { name: /^Import / })).toHaveCount(0);
      expect(await getSolvedWriteAttempts()).toBe(0);
    });
  }
});

test.describe('accessibility (desktop + mobile via projects)', () => {
  test('the import controls are reachable and labeled', async ({ page }) => {
    await seedMemberSession(page);
    await gotoSettings(page);

    // The handle input carries an accessible name (sr-only label).
    const input = page.getByRole('textbox', { name: /Codeforces handle/i });
    await expect(input).toBeVisible();

    // Keyboard: focusing the input and tabbing reaches the Preview button.
    await input.focus();
    await expect(input).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /^Preview$/ })).toBeFocused();

    // The transient status is announced via a polite live region.
    await preview(page);
    await expect(importCard(page).locator('[role="status"][aria-live="polite"]')).toBeAttached();
  });
});
