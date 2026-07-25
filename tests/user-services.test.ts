import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserService } from '../src/lib/services/user.ts';
import { createUserSolvesService } from '../src/lib/services/userSolves.ts';

type Result = { data?: unknown; error: { code?: string } | null };
type Call = { operation: string; value?: unknown };

function preferenceClient(results: Result[]) {
  const calls: Call[] = [];
  const next = () => results.shift() as Result;
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => next() }) }),
      update: (value: unknown) => {
        calls.push({ operation: 'update', value });
        return { eq: async () => next() };
      },
      insert: async (value: unknown) => {
        calls.push({ operation: 'insert', value });
        return next();
      }
    })
  } as unknown as SupabaseClient;
  return { client, calls };
}

const preferences = { hideFromLeaderboard: true, theme: 'dark' };

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
    theme: 'light'
  });
});

test('preference reads preserve null data and explicit themes', async () => {
  const noData = preferenceClient([{ data: null, error: null }]);
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
    { hideFromLeaderboard: false, theme: 'paper' }
  );
});

test('missing preferences are created with defaults and returned only after persistence', async () => {
  const success = preferenceClient([
    { data: null, error: { code: 'PGRST116' } },
    { data: null, error: { code: 'PGRST116' } },
    { data: null, error: null }
  ]);
  const service = createUserService({
    client: success.client,
    getCurrentUser: () => ({ id: 'actor' }),
    now: () => '2026-01-01T00:00:00.000Z'
  });
  assert.deepEqual(await service.fetchUserPreferences(), {
    hideFromLeaderboard: false,
    theme: 'light'
  });
  assert.deepEqual(success.calls[0], {
    operation: 'insert',
    value: {
      user_id: 'actor',
      hide_from_leaderboard: false,
      theme: 'light',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }
  });

  const failed = preferenceClient([
    { data: null, error: { code: 'PGRST116' } },
    { data: null, error: { code: 'PGRST116' } },
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
    value: { hide_from_leaderboard: true, theme: 'dark', updated_at: 'timestamp' }
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
    from: () => ({
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
