import type { Page } from '@playwright/test';
import { MOCK_URL, SUPABASE_STORAGE_KEY, ADMIN_USER, MEMBER_USER } from './constants.ts';

// Seed a deterministic Supabase browser session BEFORE app boot, so the
// authenticated admin submit-path can be exercised without ever touching real
// GitHub OAuth. The session is written to localStorage under the exact key
// @supabase/supabase-js derives for the mock URL (SUPABASE_STORAGE_KEY), with a
// far-future expiry so getSession() returns it without triggering a refresh.
//
// This never mints a real credential: the access token is one the mock
// recognizes (see e2e/support/mock-supabase.ts), and all reads/writes it
// unlocks land only in the mock's in-memory store.

type SeedUser = typeof ADMIN_USER | typeof MEMBER_USER;

function sessionFor(u: SeedUser) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    access_token: u.accessToken,
    refresh_token: u.refreshToken,
    token_type: 'bearer',
    // Far-future expiry keeps getSession() from firing a token refresh.
    expires_in: 60 * 60 * 24 * 365,
    expires_at: nowSec + 60 * 60 * 24 * 365,
    user: {
      id: u.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email,
      app_metadata: { provider: 'github' },
      user_metadata: {},
      created_at: '2024-01-01T00:00:00.000Z'
    }
  };
}

// Write the seeded session into localStorage before any app script runs.
async function seed(page: Page, u: SeedUser): Promise<void> {
  const session = sessionFor(u);
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    [SUPABASE_STORAGE_KEY, JSON.stringify(session)] as const
  );
}

export function seedAdminSession(page: Page): Promise<void> {
  return seed(page, ADMIN_USER);
}

export function seedMemberSession(page: Page): Promise<void> {
  return seed(page, MEMBER_USER);
}

// Reset the mock's isolated in-memory insert store and provider mode. Called
// per submit scenario so writes never leak across tests.
export async function resetMockStore(): Promise<void> {
  const res = await fetch(`${MOCK_URL}/__control/reset`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`failed to reset mock store: HTTP ${res.status}`);
  }
}

// Read the mock's isolated insert counts. Used by the two-phase submit specs to
// prove that the resolve/preview stage performs ZERO writes and that only the
// still-present valid rows are written on final confirm.
export async function getInsertedCounts(): Promise<{ problems: number; contests: number }> {
  const res = await fetch(`${MOCK_URL}/__control/scenario`);
  if (!res.ok) {
    throw new Error(`failed to read mock insert counts: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { inserted: { problems: number; contests: number } };
  return body.inserted;
}

// Drive the mock's provider (upstream) mode so a spec can exercise the
// provider-failure, not-found, rate-limited, and malformed paths
// deterministically.
export type ProviderMode = 'ok' | 'fail' | 'notfound' | 'malformed' | 'ratelimited';
export async function setProviderMode(mode: ProviderMode): Promise<void> {
  const res = await fetch(`${MOCK_URL}/__control/provider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode })
  });
  if (!res.ok) {
    throw new Error(`failed to set provider mode '${mode}': HTTP ${res.status}`);
  }
}

// Read the number of user_solved_problems write attempts the mock has seen this
// run. Used to assert that a read-only preview performs ZERO writes.
export async function getSolvedWriteAttempts(): Promise<number> {
  const res = await fetch(`${MOCK_URL}/__control/scenario`);
  if (!res.ok) {
    throw new Error(`failed to read control state: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { solvedWriteAttempts?: number };
  return body.solvedWriteAttempts ?? 0;
}

// Stub the BROWSER-side Codeforces upstream calls the app makes directly
// (gym problem standings and contest list/standings). Server-side provider
// fetches are redirected to the mock via env; this covers the client-side ones
// so no live codeforces.com request is ever made. `mode` mirrors the mock's
// provider mode for parity.
export async function stubCodeforcesBrowserApi(
  page: Page,
  mode: ProviderMode = 'ok'
): Promise<void> {
  await page.route('https://codeforces.com/api/**', async (route) => {
    const url = route.request().url();

    if (mode === 'fail') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'FAILED', comment: 'mock codeforces upstream failure' })
      });
      return;
    }

    if (url.includes('contest.list')) {
      const result =
        mode === 'notfound'
          ? []
          : [
              {
                id: 1234,
                name: 'Mock Codeforces Round',
                type: 'CF',
                phase: 'FINISHED',
                frozen: false,
                durationSeconds: 7200
              }
            ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'OK', result })
      });
      return;
    }

    if (url.includes('contest.standings')) {
      // Gym problem/contest standings. A gym problem falls back to a minimal
      // problem object even when the standings omit problem details, so an
      // empty problems array still yields a successful gym insert.
      const contest = {
        id: 104427,
        name: 'Mock Gym Contest',
        type: 'ICPC',
        phase: 'FINISHED',
        frozen: false,
        durationSeconds: 18000,
        kind: 'Official ICPC Contest'
      };
      const problems =
        mode === 'notfound'
          ? []
          : [{ contestId: 104427, index: 'A', name: 'Mock Gym Problem A', tags: ['gym'] }];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'OK', result: { contest, problems } })
      });
      return;
    }

    // Any other codeforces.com/api path: a benign OK so nothing hits the live
    // provider.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'OK', result: [] })
    });
  });
}
