import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCodeforcesSubmitAdapter } from '../src/lib/submit/providers/codeforces.ts';
import { createKattisSubmitAdapter } from '../src/lib/submit/providers/kattis.ts';
import type {
  ContestDraft,
  ProblemDraft,
  SubmissionPersistence,
  ValidResolvedItem
} from '../src/lib/submit/types.ts';

function persistence(overrides: Partial<SubmissionPersistence> = {}): SubmissionPersistence {
  return {
    checkEquivalentProblemUrls: async () => ({ duplicate: false }),
    checkContest: async () => ({ duplicate: false }),
    insertProblem: async () => ({ success: true, id: 'problem-id' }),
    insertContest: async () => ({ success: true, id: 'contest-id' }),
    ...overrides
  };
}

function actor(token: string | null) {
  return {
    session: token ? ({ access_token: token } as never) : null,
    user: token ? ({ id: 'actor' } as never) : null,
    isAdmin: true,
    adminCheckFailed: false,
    initialized: true
  };
}

test('Codeforces adapter sends one authenticated batch and maps server results', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const adapter = createCodeforcesSubmitAdapter(persistence(), {
    resolveActor: async () => actor('token'),
    getActor: () => actor('token'),
    fetchProblems: async (input, init) => {
      request = { url: String(input), init };
      return Response.json({
        results: [
          {
            contestId: '1',
            index: 'A',
            problem: {
              contestId: '1',
              index: 'A',
              name: 'Watermelon',
              tags: ['math'],
              rating: 800
            }
          }
        ]
      });
    }
  });
  const entries = adapter.extract('https://codeforces.com/contest/1/problem/A');
  const resolved = await adapter.resolve(entries[0], 'alice');
  assert.equal(resolved.valid, true);
  assert.equal(resolved.valid && resolved.payload.name, 'Watermelon');
  assert.equal(request?.url, '/api/codeforces/problems');
  assert.equal(request?.init?.method, 'POST');
  assert.equal(new Headers(request?.init?.headers).get('authorization'), 'Bearer token');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    problems: [{ contestId: '1', index: 'A' }]
  });
});

test('Codeforces adapter blocks unauthenticated resolution without fetch', async () => {
  let fetched = 0;
  const adapter = createCodeforcesSubmitAdapter(persistence(), {
    resolveActor: async () => actor(null),
    getActor: () => actor(null),
    fetchProblems: async () => {
      fetched++;
      throw new Error('must not fetch');
    }
  });
  const [entry] = adapter.extract('https://codeforces.com/contest/1/problem/A');
  const resolved = await adapter.resolve(entry, '');
  assert.equal(resolved.valid, false);
  assert.equal(resolved.valid ? '' : resolved.reason, 'Authentication required');
  assert.equal(fetched, 0);
});

test('Codeforces adapter surfaces server errors and HTTP fallback messages', async () => {
  for (const [response, expected] of [
    [
      Response.json({ error: 'Admin privileges required' }, { status: 403 }),
      'Admin privileges required'
    ],
    [new Response('not-json', { status: 502 }), 'Failed to resolve problems (HTTP 502)']
  ] as const) {
    const adapter = createCodeforcesSubmitAdapter(persistence(), {
      resolveActor: async () => actor('token'),
      getActor: () => actor('token'),
      fetchProblems: async () => response
    });
    const [entry] = adapter.extract('https://codeforces.com/contest/1/problem/A');
    const resolved = await adapter.resolve(entry, '');
    assert.equal(resolved.valid, false);
    assert.equal(resolved.valid ? '' : resolved.reason, expected);
  }
});

test('provider adapters delegate commits by item kind and reject impossible Kattis contests', async () => {
  const calls: string[] = [];
  const store = persistence({
    insertProblem: async () => (calls.push('problem'), { success: true }),
    insertContest: async () => (calls.push('contest'), { success: true })
  });
  const codeforces = createCodeforcesSubmitAdapter(store);
  const problem = {
    valid: true,
    kind: 'problem',
    label: 'p',
    url: 'p',
    payload: {} as ProblemDraft
  } satisfies ValidResolvedItem;
  const contest = {
    valid: true,
    kind: 'contest',
    label: 'c',
    url: 'c',
    payload: {} as ContestDraft
  } satisfies ValidResolvedItem;
  await codeforces.commit(problem);
  await codeforces.commit(contest);

  const kattis = createKattisSubmitAdapter(store);
  await kattis.commit(problem);
  assert.deepEqual(await kattis.commit(contest), {
    success: false,
    message: 'Failed to add entry'
  });
  assert.deepEqual(calls, ['problem', 'contest', 'problem']);
});

test('Kattis adapter fetches encoded canonical URL and parses successful HTML', async () => {
  let requested = '';
  const adapter = createKattisSubmitAdapter(persistence(), async (input) => {
    requested = String(input);
    return Response.json({ html: '<html />' });
  });
  const [entry] = adapter.extract('hello');
  const resolved = await adapter.resolve(entry, 'alice');
  assert.equal(resolved.valid, true);
  assert.equal(requested, '/api/kattis?url=https%3A%2F%2Fopen.kattis.com%2Fproblems%2Fhello');
});

test('Kattis adapter falls back safely on proxy JSON, HTTP, and transport errors', async () => {
  const responses: Array<typeof fetch> = [
    async () => Response.json({ error: 'blocked' }, { status: 403 }),
    async () => Response.json({}, { status: 500 }),
    async () => new Response('not-json'),
    async () => {
      throw new Error('offline');
    }
  ];
  for (const fetchPage of responses) {
    const adapter = createKattisSubmitAdapter(persistence(), fetchPage);
    const [entry] = adapter.extract('hello');
    const resolved = await adapter.resolve(entry, '');
    assert.equal(resolved.valid, true);
    assert.equal(resolved.valid && resolved.payload.name, 'Hello');
    assert.equal(resolved.valid && resolved.payload.difficulty, undefined);
  }
});
