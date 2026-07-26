import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizationResult } from '../src/lib/server/authorization.ts';
import { _createProblemsPost, _getCatalog } from '../src/routes/api/codeforces/problems/+server.ts';
import {
  _createUserSolvesGet,
  GET as UserSolvesGET
} from '../src/routes/api/codeforces/user-solves/+server.ts';
import { _buildUpstreamUrl, _createKattisGet } from '../src/routes/api/kattis/+server.ts';
import { createSessionBoundSupabase, supabase } from '../src/lib/services/database.ts';

const authorized = async () => ({
  authorized: true as const,
  userId: 'actor',
  supabase: {} as SupabaseClient
});

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function postEvent(request: Request, fetchFn: typeof fetch = fetch) {
  return { request, fetch: fetchFn, url: new URL(request.url) } as never;
}

function getEvent(url: string, fetchFn: typeof fetch = fetch) {
  return { url: new URL(url), request: new Request(url), fetch: fetchFn } as never;
}

test('problem resolver route returns auth denial before parsing or loading', async () => {
  let loaded = 0;
  const handler = _createProblemsPost({
    authorize: async () => ({
      authorized: false,
      response: Response.json({ error: 'denied' }, { status: 403 })
    }),
    loadCatalog: async () => {
      loaded++;
      return [];
    }
  });
  const response = await handler(
    postEvent(new Request('https://gitgud.test/api', { method: 'POST', body: '{' }))
  );
  assert.equal(response.status, 403);
  assert.equal(loaded, 0);
});

test('problem resolver route validates JSON, non-empty arrays, and batch bounds', async () => {
  let loaded = 0;
  const handler = _createProblemsPost({
    authorize: authorized,
    loadCatalog: async () => {
      loaded++;
      return [];
    }
  });
  const cases: Array<[string, string]> = [
    ['{', 'Invalid JSON body'],
    [JSON.stringify({}), 'Request must include a non-empty "problems" array'],
    [JSON.stringify({ problems: [] }), 'Request must include a non-empty "problems" array'],
    [
      JSON.stringify({
        problems: Array.from({ length: 101 }, () => ({ contestId: '1', index: 'A' }))
      }),
      'Too many problems requested (max 100)'
    ]
  ];
  for (const [requestBody, message] of cases) {
    const response = await handler(
      postEvent(
        new Request('https://gitgud.test/api', {
          method: 'POST',
          body: requestBody
        })
      )
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), { error: message });
  }
  assert.equal(loaded, 0);
});

test('problem resolver route resolves valid and malformed refs without widening the request', async () => {
  const handler = _createProblemsPost({
    authorize: authorized,
    loadCatalog: async () => [
      { contestId: 1, index: 'A', name: 'Watermelon', tags: ['math'], rating: 800 }
    ]
  });
  const response = await handler(
    postEvent(
      new Request('https://gitgud.test/api', {
        method: 'POST',
        body: JSON.stringify({
          problems: [{ contestId: '1', index: 'A' }, { contestId: 'bad', index: 'A' }, null]
        })
      })
    )
  );
  assert.equal(response.status, 200);
  const payload = (await body(response)) as {
    results: Array<{ problem?: { name: string }; error?: string }>;
  };
  assert.equal(payload.results[0].problem?.name, 'Watermelon');
  assert.match(payload.results[1].error ?? '', /Invalid contestId/);
  assert.match(payload.results[2].error ?? '', /Missing contestId or index/);
});

test('problem resolver route converts catalog failures to bounded 502 responses', async () => {
  for (const failure of [new Error('upstream unavailable'), 'unknown']) {
    const handler = _createProblemsPost({
      authorize: authorized,
      loadCatalog: async () => {
        throw failure;
      }
    });
    const response = await handler(
      postEvent(
        new Request('https://gitgud.test/api', {
          method: 'POST',
          body: JSON.stringify({ problems: [{ contestId: '1', index: 'A' }] })
        })
      )
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await body(response), {
      error: failure instanceof Error ? failure.message : 'Failed to fetch Codeforces problemset'
    });
  }
});

function trackedClient(result: { data: unknown; error: { code?: string } | null }) {
  return {
    from: () => ({ select: async () => result })
  } as unknown as SupabaseClient;
}

function userSolvesHandler(options: {
  fetchFn?: typeof fetch;
  database?: SupabaseClient;
  authorize?: (request: Request) => Promise<AuthorizationResult>;
}) {
  const handler = _createUserSolvesGet({
    authorize: options.authorize ?? authorized,
    createAnonClient: () => options.database ?? trackedClient({ data: [], error: null })
  });
  return (url: string) => handler(getEvent(url, options.fetchFn));
}

test('user-solves route denies unauthorized and malformed handles before network access', async () => {
  let fetched = 0;
  const fetchFn: typeof fetch = async () => {
    fetched++;
    throw new Error('must not fetch');
  };
  const denied = userSolvesHandler({
    fetchFn,
    authorize: async () => ({
      authorized: false,
      response: Response.json({ error: 'auth' }, { status: 401 })
    })
  });
  assert.equal((await denied('https://gitgud.test/api?handle=tourist')).status, 401);

  const handler = userSolvesHandler({ fetchFn });
  for (const [url, error] of [
    ['https://gitgud.test/api', 'No handle provided'],
    ['https://gitgud.test/api?handle=!', 'Invalid Codeforces handle']
  ]) {
    const response = await handler(url);
    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), { error });
  }
  assert.equal(fetched, 0);
});

test('user-solves route matches only accepted tracked solves and trims the handle', async () => {
  let requested = '';
  let options: RequestInit | undefined;
  const fetchFn: typeof fetch = async (input, init) => {
    requested = String(input);
    options = init;
    return Response.json({
      status: 'OK',
      result: [
        { verdict: 'OK', problem: { contestId: 1, index: 'A' } },
        { verdict: 'WRONG_ANSWER', problem: { contestId: 2, index: 'B' } }
      ]
    });
  };
  const handler = userSolvesHandler({
    fetchFn,
    database: trackedClient({
      data: [{ id: 'p1', url: 'https://codeforces.com/contest/1/problem/A', name: 'A' }],
      error: null
    })
  });
  const response = await handler('https://gitgud.test/api?handle=%20tourist%20');
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), {
    matched: [{ id: 'p1', url: 'https://codeforces.com/contest/1/problem/A', name: 'A' }],
    unmatchedCount: 0
  });
  assert.match(requested, /user\.status\?handle=tourist$/);
  assert.equal(options?.redirect, 'error');
  assert.equal(new Headers(options?.headers).get('accept'), 'application/json');
});

test('user-solves route distinguishes timeout, transport, read, and JSON failures', async () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';
  const cases: Array<[typeof fetch, number, string]> = [
    [
      async () => {
        throw abortError;
      },
      504,
      'Timed out fetching solves from Codeforces'
    ],
    [
      async () => {
        throw new Error('offline');
      },
      502,
      'Failed to fetch solves from Codeforces'
    ],
    [async () => new Response('not json'), 502, 'Unexpected response from Codeforces'],
    [
      async () =>
        new Response(
          new ReadableStream({
            pull: (controller) => controller.error(new Error('read failed'))
          })
        ),
      502,
      'Failed to read Codeforces response'
    ]
  ];
  for (const [fetchFn, status, error] of cases) {
    const response = await userSolvesHandler({ fetchFn })('https://gitgud.test/api?handle=tourist');
    assert.equal(response.status, status);
    assert.deepEqual(await body(response), { error });
  }
});

test('user-solves route enforces the response-size cap and supports bodyless responses', async () => {
  let cancelled = false;
  const oversized = {
    status: 200,
    ok: true,
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: { byteLength: 26 * 1024 * 1024 } }),
        cancel: async () => {
          cancelled = true;
        }
      })
    }
  } as unknown as Response;
  const oversizedResponse = await userSolvesHandler({
    fetchFn: async () => oversized
  })('https://gitgud.test/api?handle=tourist');
  assert.equal(oversizedResponse.status, 502);
  assert.deepEqual(await body(oversizedResponse), { error: 'Codeforces response too large' });
  assert.equal(cancelled, true);

  const bodyless = {
    status: 200,
    ok: true,
    body: null,
    text: async () => JSON.stringify({ status: 'OK', result: [] })
  } as unknown as Response;
  const bodylessResponse = await userSolvesHandler({
    fetchFn: async () => bodyless
  })('https://gitgud.test/api?handle=tourist');
  assert.deepEqual(await body(bodylessResponse), { matched: [], unmatchedCount: 0 });
});

test('user-solves route maps upstream failure classes and database errors', async () => {
  const upstreamCases: Array<[unknown, number, string, number]> = [
    [
      { status: 'FAILED', comment: 'handle not found' },
      200,
      'Handle "tourist" not found on Codeforces',
      404
    ],
    [
      { status: 'FAILED', comment: 'Call limit exceeded' },
      200,
      'Codeforces rate limit reached; try again shortly',
      429
    ],
    [{ status: 'FAILED' }, 429, 'Codeforces rate limit reached; try again shortly', 429],
    [{ status: 'FAILED' }, 500, 'Failed to fetch solves from Codeforces', 502]
  ];
  for (const [payload, upstreamStatus, error, expectedStatus] of upstreamCases) {
    const response = await userSolvesHandler({
      fetchFn: async () => Response.json(payload, { status: upstreamStatus })
    })('https://gitgud.test/api?handle=tourist');
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(await body(response), { error });
  }

  for (const database of [
    trackedClient({ data: null, error: { code: 'denied' } }),
    {
      from: () => {
        throw new Error('offline');
      }
    } as unknown as SupabaseClient
  ]) {
    const databaseFailure = await userSolvesHandler({
      fetchFn: async () => Response.json({ status: 'OK', result: [] }),
      database
    })('https://gitgud.test/api?handle=tourist');
    assert.equal(databaseFailure.status, 500);
    assert.deepEqual(await body(databaseFailure), {
      error: 'Failed to match against tracked problems'
    });
  }
});

test('user-solves route treats a null tracked-problem result as an empty set', async () => {
  const response = await userSolvesHandler({
    fetchFn: async () =>
      Response.json({
        status: 'OK',
        result: [{ verdict: 'OK', problem: { contestId: 1, index: 'A' } }]
      }),
    database: trackedClient({ data: null, error: null })
  })('https://gitgud.test/api?handle=tourist');
  assert.equal(response.status, 200);
  const payload = (await body(response)) as { matched?: unknown[]; solvedCount?: number };
  assert.deepEqual(payload.matched ?? [], []);
});

test('Kattis route rejects absent and unsafe targets before fetching', async () => {
  let fetched = 0;
  const handler = _createKattisGet(async () => {
    fetched++;
    throw new Error('must not fetch');
  });
  for (const [url, error] of [
    ['https://gitgud.test/api', 'No URL provided'],
    ['https://gitgud.test/api?url=https://evil.test/problems/hello', 'Invalid Kattis problem URL']
  ]) {
    const response = await handler({ url: new URL(url) } as never);
    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), { error });
  }
  assert.equal(fetched, 0);
});

test('Kattis route rebuilds canonical target and returns HTML or upstream status', async () => {
  let requested = '';
  let options: RequestInit | undefined;
  const success = _createKattisGet(async (input, init) => {
    requested = String(input);
    options = init;
    return new Response('<h1>Hello</h1>');
  });
  const response = await success({
    url: new URL('https://gitgud.test/api?url=https://open.kattis.com/problems/hello?ignored=1')
  } as never);
  assert.deepEqual(await body(response), { html: '<h1>Hello</h1>' });
  assert.equal(requested, 'https://open.kattis.com/problems/hello');
  assert.equal(options?.redirect, 'error');

  const failed = _createKattisGet(async () => new Response('', { status: 404 }));
  const failure = await failed({ url: new URL('https://gitgud.test/api?url=hello') } as never);
  assert.equal(failure.status, 404);
  assert.deepEqual(await body(failure), { error: 'Failed to fetch problem' });
});

test('Kattis route distinguishes aborts from other fetch failures', async () => {
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  for (const [failure, status, error] of [
    [abort, 504, 'Timed out fetching problem'],
    [new Error('offline'), 500, 'Failed to fetch problem'],
    ['non-Error failure', 500, 'Failed to fetch problem']
  ] as const) {
    const handler = _createKattisGet(async () => {
      throw failure;
    });
    const response = await handler({ url: new URL('https://gitgud.test/api?url=hello') } as never);
    assert.equal(response.status, status);
    assert.deepEqual(await body(response), { error });
  }
});

test('Kattis route contains response body failures', async () => {
  const handler = _createKattisGet(async () => {
    return {
      ok: true,
      text: async () => {
        throw new Error('body disconnected');
      }
    } as unknown as Response;
  });
  const response = await handler({ url: new URL('https://gitgud.test/api?url=hello') } as never);
  assert.equal(response.status, 500);
  assert.deepEqual(await body(response), { error: 'Failed to fetch problem' });
});

test('the production upstream builder honors an override base and the canonical origin', () => {
  assert.equal(
    _buildUpstreamUrl('hello', 'https://mirror.test/'),
    'https://mirror.test/problems/hello'
  );
  assert.equal(
    _buildUpstreamUrl('hello', 'https://mirror.test'),
    'https://mirror.test/problems/hello'
  );
  assert.equal(_buildUpstreamUrl('hello', ''), 'https://open.kattis.com/problems/hello');
  // No override argument falls through to the configured environment base.
  assert.equal(_buildUpstreamUrl('hello'), 'https://open.kattis.com/problems/hello');
});

test('the production catalog loader fetches and caches the problemset once', async () => {
  let fetches = 0;
  const fetchFn = (async () => {
    fetches++;
    return Response.json({
      status: 'OK',
      result: {
        problems: [{ contestId: 1, index: 'A', name: 'Watermelon', tags: ['math'], rating: 800 }],
        problemStatistics: []
      }
    });
  }) as unknown as typeof fetch;
  const first = await _getCatalog(fetchFn);
  const second = await _getCatalog(fetchFn);
  assert.equal(fetches, 1);
  assert.equal(first[0].name, 'Watermelon');
  assert.equal(second, first);
});

test('the session-bound and shared Supabase clients construct without network access', () => {
  const bound = createSessionBoundSupabase('token');
  assert.equal(typeof bound.from, 'function');
  assert.equal(typeof supabase.from, 'function');
});

test('the production user-solves GET wires the anon client through to a match result', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const target = new URL(String(input));
    if (target.pathname.startsWith('/auth/')) {
      return new Response(JSON.stringify({ id: 'actor' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (target.hostname === 'codeforces.com') {
      return Response.json({ status: 'OK', result: [] });
    }
    return Response.json([]);
  }) as typeof fetch;
  const response = await UserSolvesGET({
    url: new URL('https://gitgud.test/api?handle=tourist'),
    request: new Request('https://gitgud.test/api', {
      headers: { authorization: 'Bearer tok' }
    }),
    fetch: globalThis.fetch
  } as never);
  assert.equal(response.status, 200);
});
