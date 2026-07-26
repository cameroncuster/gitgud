import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserService, type UserPreferences } from '../src/lib/services/user.ts';
import { createUserSolvesService } from '../src/lib/services/userSolves.ts';

type Result = { data?: unknown; error: { code?: string } | null };
type Call = { operation: string; value?: unknown; userId?: string };

function preferenceClient(results: Result[]) {
  const calls: Call[] = [];
  const next = () => results.shift() as Result;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => {
            const result = next();
            return {
              ...result,
              data: result.data == null || Array.isArray(result.data) ? result.data : [result.data]
            };
          }
        })
      }),
      update: (value: unknown) => ({
        eq: async (_column: string, userId: string) => {
          calls.push({ operation: 'update', value, userId });
          return next();
        }
      }),
      insert: async (value: unknown) => {
        calls.push({ operation: 'insert', value });
        return next();
      }
    })
  } as unknown as SupabaseClient;
  return { client, calls };
}

const preferences: UserPreferences = { hideFromLeaderboard: true, theme: 'dark' };

test('user preferences require an actor and map stored fallback theme', async () => {
  const anonymous = preferenceClient([]);
  const anonymousService = createUserService({
    client: anonymous.client,
    getCurrentUser: () => null
  });
  assert.equal(await anonymousService.fetchUserPreferences(), null);
  assert.equal(await anonymousService.updateUserPreferences(preferences), false);

  const database = preferenceClient([
    {
      data: {
        hide_from_leaderboard: true,
        theme: ''
      },
      error: null
    }
  ]);
  const service = createUserService({
    client: database.client,
    getCurrentUser: () => ({ id: 'actor' })
  });
  assert.deepEqual(await service.fetchUserPreferences(), {
    hideFromLeaderboard: true,
    theme: 'system'
  });
});

test('preference reads preserve errors and explicit themes', async () => {
  const noData = preferenceClient([{ data: null, error: { code: 'denied' } }]);
  assert.equal(
    await createUserService({
      client: noData.client,
      getCurrentUser: () => ({ id: 'actor' })
    }).fetchUserPreferences(),
    null
  );

  const explicit = preferenceClient([
    { data: { hide_from_leaderboard: false, theme: 'paper' }, error: null }
  ]);
  assert.deepEqual(
    await createUserService({
      client: explicit.client,
      getCurrentUser: () => ({ id: 'actor' })
    }).fetchUserPreferences(),
    { hideFromLeaderboard: false, theme: 'system' }
  );
});

test('missing preferences are created with defaults and returned only after persistence', async () => {
  const success = preferenceClient([
    { data: [], error: null },
    { data: [], error: null },
    { data: null, error: null }
  ]);
  const service = createUserService({
    client: success.client,
    getCurrentUser: () => ({ id: 'actor' }),
    now: () => '2026-01-01T00:00:00.000Z'
  });
  assert.deepEqual(await service.fetchUserPreferences(), {
    hideFromLeaderboard: false,
    theme: 'system'
  });
  assert.deepEqual(success.calls[0], {
    operation: 'insert',
    value: {
      user_id: 'actor',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }
  });

  const failed = preferenceClient([
    { data: [], error: null },
    { data: [], error: null },
    { data: null, error: { code: 'denied' } }
  ]);
  assert.equal(
    await createUserService({
      client: failed.client,
      getCurrentUser: () => ({ id: 'actor' })
    }).fetchUserPreferences(),
    null
  );
});

test('preference update chooses update or insert with stable timestamps', async () => {
  const existing = preferenceClient([
    { data: { id: 'pref' }, error: null },
    { data: null, error: null }
  ]);
  const existingService = createUserService({
    client: existing.client,
    getCurrentUser: () => ({ id: 'actor' }),
    now: () => 'timestamp'
  });
  assert.equal(await existingService.updateUserPreferences(preferences), true);
  assert.deepEqual(existing.calls[0], {
    operation: 'update',
    value: { hide_from_leaderboard: true, theme: 'dark', updated_at: 'timestamp' },
    userId: 'actor'
  });

  const missing = preferenceClient([
    { data: null, error: { code: 'PGRST116' } },
    { data: null, error: null }
  ]);
  assert.equal(
    await createUserService({
      client: missing.client,
      getCurrentUser: () => ({ id: 'actor' }),
      now: () => 'timestamp'
    }).updateUserPreferences(preferences),
    true
  );
  assert.equal(missing.calls[0].operation, 'insert');
});

test('focused preference writes are actor-stable and update independent columns', async () => {
  let currentUser: { id: string } | null = { id: 'actor-a' };
  const database = preferenceClient([
    { data: { id: 'theme-pref' }, error: null },
    { data: null, error: null },
    { data: { id: 'privacy-pref' }, error: null },
    { data: null, error: null }
  ]);
  const service = createUserService({
    client: database.client,
    getCurrentUser: () => currentUser,
    now: () => 'timestamp'
  });

  const themeWrite = service.updateThemePreferenceForUser('actor-a', 'invalid');
  currentUser = { id: 'actor-b' };
  assert.equal(await themeWrite, true);
  assert.equal(await service.updateLeaderboardPrivacyForUser('actor-b', true), true);
  assert.deepEqual(database.calls, [
    {
      operation: 'update',
      value: { theme: 'system', updated_at: 'timestamp' },
      userId: 'actor-a'
    },
    {
      operation: 'update',
      value: { hide_from_leaderboard: true, updated_at: 'timestamp' },
      userId: 'actor-b'
    }
  ]);
  assert.equal(await service.updateThemePreferenceForUser('actor-a', 'dark'), false);
});

test('concurrent theme and privacy writes update only their independent columns', async () => {
  const database = preferenceClient([
    { data: { id: 'theme-pref' }, error: null },
    { data: { id: 'privacy-pref' }, error: null },
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const service = createUserService({
    client: database.client,
    getCurrentUser: () => ({ id: 'actor' }),
    now: () => 'timestamp'
  });

  assert.deepEqual(
    await Promise.all([
      service.updateThemePreferenceForUser('actor', 'dark'),
      service.updateLeaderboardPrivacyForUser('actor', true)
    ]),
    [true, true]
  );
  assert.deepEqual(database.calls, [
    {
      operation: 'update',
      value: { theme: 'dark', updated_at: 'timestamp' },
      userId: 'actor'
    },
    {
      operation: 'update',
      value: { hide_from_leaderboard: true, updated_at: 'timestamp' },
      userId: 'actor'
    }
  ]);
});

test('focused missing-row inserts rely on defaults for the independent field', async () => {
  const theme = preferenceClient([
    { data: [], error: null },
    { data: null, error: null }
  ]);
  const themeService = createUserService({
    client: theme.client,
    getCurrentUser: () => ({ id: 'actor' }),
    now: () => 'timestamp'
  });
  assert.equal(await themeService.updateThemePreferenceForUser('actor', 'dark'), true);
  assert.deepEqual(theme.calls[0], {
    operation: 'insert',
    value: {
      user_id: 'actor',
      theme: 'dark',
      created_at: 'timestamp',
      updated_at: 'timestamp'
    }
  });

  const privacy = preferenceClient([
    { data: [], error: null },
    { data: null, error: null }
  ]);
  const privacyService = createUserService({
    client: privacy.client,
    getCurrentUser: () => ({ id: 'actor' }),
    now: () => 'timestamp'
  });
  assert.equal(await privacyService.updateLeaderboardPrivacyForUser('actor', true), true);
  assert.deepEqual(privacy.calls[0], {
    operation: 'insert',
    value: {
      user_id: 'actor',
      hide_from_leaderboard: true,
      created_at: 'timestamp',
      updated_at: 'timestamp'
    }
  });
});

test('duplicate insert race retries as update and reports retry failure', async () => {
  let waited = 0;
  const raced = preferenceClient([
    { data: null, error: { code: 'PGRST116' } },
    { data: null, error: { code: '23505' } },
    { data: null, error: null }
  ]);
  const service = createUserService({
    client: raced.client,
    getCurrentUser: () => ({ id: 'actor' }),
    now: () => 'timestamp',
    wait: async (milliseconds) => {
      waited = milliseconds;
    }
  });
  assert.equal(await service.updateUserPreferences(preferences), true);
  assert.equal(waited, 100);
  assert.deepEqual(
    raced.calls.map((call) => call.operation),
    ['insert', 'update']
  );

  const retryFailed = preferenceClient([
    { data: null, error: { code: 'PGRST116' } },
    { data: null, error: { code: '23505' } },
    { data: null, error: { code: 'still-failed' } }
  ]);
  assert.equal(
    await createUserService({
      client: retryFailed.client,
      getCurrentUser: () => ({ id: 'actor' }),
      wait: async () => {}
    }).updateUserPreferences(preferences),
    false
  );
});

test('default duplicate retry waits before updating the winning row', async () => {
  const raced = preferenceClient([
    { data: null, error: { code: 'PGRST116' } },
    { data: null, error: { code: '23505' } },
    { data: null, error: null }
  ]);
  const service = createUserService({
    client: raced.client,
    getCurrentUser: () => ({ id: 'actor' }),
    now: () => 'timestamp'
  });
  const started = Date.now();
  assert.equal(await service.updateUserPreferences(preferences), true);
  assert.ok(Date.now() - started >= 80);
  assert.deepEqual(
    raced.calls.map((call) => call.operation),
    ['insert', 'update']
  );
});

test('preference service contains query, write, and thrown errors', async () => {
  const readFailure = preferenceClient([{ data: null, error: { code: 'denied' } }]);
  assert.equal(
    await createUserService({
      client: readFailure.client,
      getCurrentUser: () => ({ id: 'actor' })
    }).fetchUserPreferences(),
    null
  );

  const writeFailure = preferenceClient([
    { data: null, error: { code: 'unexpected-check-error' } },
    { data: null, error: { code: 'denied' } }
  ]);
  assert.equal(
    await createUserService({
      client: writeFailure.client,
      getCurrentUser: () => ({ id: 'actor' })
    }).updateUserPreferences(preferences),
    false
  );

  const throwing = createUserService({
    client: {
      from: () => {
        throw new Error('offline');
      }
    } as unknown as SupabaseClient,
    getCurrentUser: () => ({ id: 'actor' })
  });
  assert.equal(await throwing.fetchUserPreferences(), null);
  assert.equal(await throwing.updateUserPreferences(preferences), false);
});

function importClient(results: Result[], throws = false) {
  const calls: unknown[] = [];
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: async (column: string, values: string[]) => {
          calls.push({ table, columns, column, values });
          if (throws) throw new Error('offline');
          return results.shift();
        }
      }),
      upsert: (rows: unknown, options: unknown) => {
        calls.push({ rows, options });
        if (throws) throw new Error('offline');
        return { select: async () => results.shift() };
      }
    })
  } as unknown as SupabaseClient;
  return { client, calls };
}

function actor(user = true, token = true) {
  return {
    user: user ? ({ id: 'actor' } as never) : null,
    session: token ? ({ access_token: 'access-token' } as never) : null,
    isAdmin: false,
    adminCheckFailed: false,
    initialized: true
  };
}

test('solve preview requires a session and sends trimmed handle with bearer auth', async () => {
  const database = importClient([]);
  const anonymous = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(false, false),
    getActor: () => actor(true, false),
    fetchMatchesResponse: async () => {
      throw new Error('must not fetch');
    }
  });
  assert.deepEqual(await anonymous.previewCodeforcesImport('tourist'), {
    success: false,
    message: 'You must be signed in to import solves'
  });

  let request: { url: string; authorization: string } | undefined;
  const service = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async (input, init) => {
      request = {
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization') ?? ''
      };
      return Response.json({
        matched: [{ id: 'server-id', url: 'u', name: 'n' }],
        unmatchedCount: 2
      });
    }
  });
  const result = await service.previewCodeforcesImport(' tourist ');
  assert.equal(result.success, true);
  assert.deepEqual(request, {
    url: '/api/codeforces/user-solves?handle=tourist',
    authorization: 'Bearer access-token'
  });
});

test('solve preview converts network, JSON, HTTP, and malformed payloads safely', async () => {
  const database = importClient([]);
  const serviceFor = (fetchMatchesResponse: typeof fetch) =>
    createUserSolvesService({
      client: database.client,
      resolveActor: async () => actor(),
      getActor: () => actor(),
      fetchMatchesResponse
    });
  assert.deepEqual(
    await serviceFor(async () => {
      throw new Error('offline');
    }).previewCodeforcesImport('x'),
    {
      success: false,
      message: 'Failed to reach Codeforces import'
    }
  );
  assert.deepEqual(
    await serviceFor(async () => new Response('bad-json')).previewCodeforcesImport('x'),
    {
      success: false,
      message: 'Unexpected response from the import service'
    }
  );
  assert.deepEqual(
    await serviceFor(async () =>
      Response.json({ error: 'rate limited' }, { status: 429 })
    ).previewCodeforcesImport('x'),
    {
      success: false,
      message: 'rate limited'
    }
  );
  assert.deepEqual(
    await serviceFor(async () => Response.json({}, { status: 500 })).previewCodeforcesImport('x'),
    {
      success: false,
      message: 'Failed to fetch solves from Codeforces'
    }
  );
  assert.deepEqual(
    await serviceFor(async () =>
      Response.json({ matched: 'bad', unmatchedCount: 'bad' })
    ).previewCodeforcesImport('x'),
    {
      success: true,
      result: { matched: [], unmatchedCount: 0 }
    }
  );
});

test('solve confirmation re-derives server IDs and idempotently upserts only those rows', async () => {
  const database = importClient([{ data: [{ problem_id: 'server-id' }], error: null }]);
  const service = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () =>
      Response.json({
        matched: [{ id: 'server-id', url: 'u', name: 'n' }],
        unmatchedCount: 0
      })
  });
  assert.deepEqual(await service.confirmCodeforcesImport('tourist'), {
    success: true,
    imported: 1
  });
  assert.deepEqual(database.calls[0], {
    rows: [{ user_id: 'actor', problem_id: 'server-id' }],
    options: { onConflict: 'user_id,problem_id', ignoreDuplicates: true }
  });
});

test('solve confirmation rejects actor changes before persistence', async () => {
  const database = importClient([]);
  let actorReads = 0;
  const service = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(),
    getActor: () => {
      actorReads++;
      return actorReads < 2 ? actor() : { ...actor(), user: { id: 'different-actor' } as never };
    },
    fetchMatchesResponse: async () => Response.json({ matched: [{ id: 'server-id' }] })
  });
  assert.deepEqual(await service.confirmCodeforcesImport('tourist'), {
    success: false,
    imported: 0,
    message: 'Your session changed during import'
  });
  assert.equal(database.calls.length, 0);
});

test('solve confirmation performs no writes for anonymous, failed, or empty matches', async () => {
  const database = importClient([]);
  const anonymous = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(false, false),
    getActor: () => actor(false, false),
    fetchMatchesResponse: async () => Response.json({ matched: [] })
  });
  assert.deepEqual(await anonymous.confirmCodeforcesImport('x'), {
    success: false,
    imported: 0,
    message: 'You must be signed in to import solves'
  });

  const failed = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({ error: 'upstream failed' }, { status: 502 })
  });
  assert.deepEqual(await failed.confirmCodeforcesImport('x'), {
    success: false,
    imported: 0,
    message: 'upstream failed'
  });

  const empty = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({ matched: [] })
  });
  assert.deepEqual(await empty.confirmCodeforcesImport('x'), { success: true, imported: 0 });
  assert.equal(database.calls.length, 0);
});

test('Kattis empty preview needs no database query', async () => {
  const database = importClient([]);
  const service = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.deepEqual(await service.previewKattisImport('!!!'), {
    success: true,
    result: {
      matched: [],
      unmatchedCount: 0,
      duplicateCount: 0,
      capped: false
    }
  });
  assert.equal(database.calls.length, 0);
});

test('Kattis preview queries canonical tracked URLs and reports match counts', async () => {
  const database = importClient([
    {
      data: [
        {
          id: 'database-id',
          url: 'https://open.kattis.com/problems/gamma',
          name: 'Gamma'
        }
      ],
      error: null
    }
  ]);
  const service = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.deepEqual(await service.previewKattisImport('gamma missing gamma'), {
    success: true,
    result: {
      matched: [
        {
          id: 'database-id',
          url: 'https://open.kattis.com/problems/gamma',
          name: 'Gamma'
        }
      ],
      unmatchedCount: 1,
      duplicateCount: 1,
      capped: false
    }
  });
  assert.deepEqual(database.calls[0], {
    table: 'problems',
    columns: 'id,url,name',
    column: 'url',
    values: ['https://open.kattis.com/problems/gamma', 'https://open.kattis.com/problems/missing']
  });
});

test('Kattis confirm re-queries and imports only the database-derived UUID', async () => {
  const database = importClient([
    {
      data: [
        {
          id: 'database-id',
          url: 'https://open.kattis.com/problems/gamma',
          name: 'Gamma'
        }
      ],
      error: null
    },
    { data: [{ problem_id: 'database-id' }], error: null }
  ]);
  const service = createUserSolvesService({
    client: database.client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.deepEqual(await service.confirmKattisImport('gamma fabricated-uuid'), {
    success: true,
    imported: 1
  });
  assert.deepEqual(database.calls[1], {
    rows: [{ user_id: 'actor', problem_id: 'database-id' }],
    options: { onConflict: 'user_id,problem_id', ignoreDuplicates: true }
  });
});

test('Kattis import rejects anonymous actors, changed sessions, and query failures', async () => {
  const anonymous = createUserSolvesService({
    client: importClient([]).client,
    resolveActor: async () => actor(false, false),
    getActor: () => actor(false, false),
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.equal((await anonymous.previewKattisImport('gamma')).success, false);

  let reads = 0;
  const changedDatabase = importClient([
    {
      data: [
        {
          id: 'database-id',
          url: 'https://open.kattis.com/problems/gamma',
          name: 'Gamma'
        }
      ],
      error: null
    }
  ]);
  const changed = createUserSolvesService({
    client: changedDatabase.client,
    resolveActor: async () => actor(),
    getActor: () => {
      reads++;
      return reads < 2 ? actor() : { ...actor(), user: { id: 'changed' } as never };
    },
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.deepEqual(await changed.confirmKattisImport('gamma'), {
    success: false,
    imported: 0,
    message: 'Your session changed during import'
  });

  const failed = createUserSolvesService({
    client: importClient([{ data: null, error: { code: 'denied' } }]).client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.equal((await failed.previewKattisImport('gamma')).success, false);

  const anonymousConfirm = createUserSolvesService({
    client: importClient([]).client,
    resolveActor: async () => actor(false, false),
    getActor: () => actor(false, false),
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.deepEqual(await anonymousConfirm.confirmKattisImport('gamma'), {
    success: false,
    imported: 0,
    message: 'You must be signed in to import solves'
  });

  const thrown = createUserSolvesService({
    client: importClient([], true).client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.deepEqual(await thrown.previewKattisImport('gamma'), {
    success: false,
    message: 'Failed to match tracked Kattis problems'
  });

  const confirmFailed = createUserSolvesService({
    client: importClient([{ data: null, error: { code: 'denied' } }]).client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.deepEqual(await confirmFailed.confirmKattisImport('gamma'), {
    success: false,
    imported: 0,
    message: 'Failed to match tracked Kattis problems'
  });

  const nullTracked = importClient([
    { data: null, error: null },
    { data: [{ problem_id: 'database-id' }], error: null }
  ]);
  const nullTrackedService = createUserSolvesService({
    client: nullTracked.client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({})
  });
  assert.deepEqual(await nullTrackedService.previewKattisImport('gamma'), {
    success: true,
    result: { matched: [], unmatchedCount: 1, duplicateCount: 0, capped: false }
  });
});

test('solve confirmation hides database errors and counts missing return data as zero', async () => {
  for (const database of [
    importClient([{ data: null, error: { code: 'denied' } }]),
    importClient([], true)
  ]) {
    const service = createUserSolvesService({
      client: database.client,
      resolveActor: async () => actor(),
      getActor: () => actor(),
      fetchMatchesResponse: async () => Response.json({ matched: [{ id: 'p' }] })
    });
    assert.deepEqual(await service.confirmCodeforcesImport('x'), {
      success: false,
      imported: 0,
      message: 'Import failed'
    });
  }

  const noRows = importClient([{ data: null, error: null }]);
  const service = createUserSolvesService({
    client: noRows.client,
    resolveActor: async () => actor(),
    getActor: () => actor(),
    fetchMatchesResponse: async () => Response.json({ matched: [{ id: 'p' }] })
  });
  assert.deepEqual(await service.confirmCodeforcesImport('x'), { success: true, imported: 0 });
});
