/**
 * Unit tests for Codeforces ingestion URL parsing and problemset metadata
 * resolution. Run with: `node --test tests/`
 *
 * These tests exercise the pure, dependency-free helpers only. They use a
 * mocked fetch and never hit the network, Supabase, or any production data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCatalogCache,
  fetchProblemsetCatalog,
  problemsetApiUrl,
  PROBLEMSET_API_URL,
  resolveFromCatalog,
  validateProblemRef,
  type CodeforcesProblemsetProblem,
  type FetchLike
} from '../src/lib/services/codeforcesProblemset.ts';
import { parseCodeforcesProblemUrl as parseProblemUrl } from '../src/lib/providers/codeforces/ingestion.ts';

// The five problems from the user repro report.
const REPRO = [
  { contestId: '2230', index: 'F', name: 'Game on Growing Tree', rating: 2700 },
  { contestId: '2026', index: 'F', name: 'Bermart Ice Cream', rating: 2700 },
  { contestId: '2206', index: 'D', name: 'Christmas Tree Un-decoration', rating: 2600 },
  { contestId: '1120', index: 'D', name: 'Power Tree', rating: 2500 },
  { contestId: '1528', index: 'C', name: 'Trees of Tranquillity', rating: 2300 }
];

// A minimal mocked problemset catalog covering the repro problems plus an
// unrelated one.
const MOCK_CATALOG: CodeforcesProblemsetProblem[] = [
  ...REPRO.map((p) => ({
    contestId: Number(p.contestId),
    index: p.index,
    name: p.name,
    tags: ['trees'],
    rating: p.rating
  })),
  { contestId: 4, index: 'A', name: 'Watermelon', tags: ['brute force', 'math'], rating: 800 }
];

function mockFetch(payload: unknown, ok = true, status = 200): FetchLike {
  return async () => ({
    ok,
    status,
    json: async () => payload
  });
}

test('parseProblemUrl parses contest, problemset, and gym URLs', () => {
  const contest = parseProblemUrl('https://codeforces.com/contest/2230/problem/F');
  assert.deepEqual(contest, {
    contestId: '2230',
    index: 'F',
    problemId: '2230F',
    url: 'https://codeforces.com/contest/2230/problem/F'
  });

  const problemset = parseProblemUrl('https://codeforces.com/problemset/problem/1120/D');
  assert.equal(problemset?.contestId, '1120');
  assert.equal(problemset?.index, 'D');
  assert.equal(problemset?.url, 'https://codeforces.com/contest/1120/problem/D');

  const gym = parseProblemUrl('https://codeforces.com/gym/104427/problem/A');
  assert.equal(gym?.problemId, 'G104427A');
  assert.equal(gym?.url, 'https://codeforces.com/gym/104427/problem/A');

  assert.equal(parseProblemUrl('https://example.com/not/a/problem'), null);
  assert.equal(parseProblemUrl('https://evil.test/codeforces.com/contest/1/problem/A'), null);
});

test('resolveFromCatalog resolves all five repro problems from a mocked catalog', () => {
  const refs = REPRO.map((p) => ({ contestId: p.contestId, index: p.index }));
  const results = resolveFromCatalog(refs, MOCK_CATALOG);

  assert.equal(results.length, 5);
  for (let i = 0; i < REPRO.length; i++) {
    assert.equal(
      results[i].error,
      undefined,
      `${REPRO[i].contestId}${REPRO[i].index} should resolve`
    );
    assert.equal(results[i].problem?.name, REPRO[i].name);
    assert.equal(results[i].problem?.rating, REPRO[i].rating);
  }
});

test('resolveFromCatalog reports missing and invalid problems', () => {
  const results = resolveFromCatalog(
    [
      { contestId: '9999999', index: 'Z' }, // valid shape, not in catalog
      { contestId: 'abc', index: 'A' }, // invalid contestId
      { contestId: '4', index: '1' }, // invalid index
      null as unknown as { contestId: string; index: string }
    ],
    MOCK_CATALOG
  );

  assert.match(results[0].error ?? '', /not found/i);
  assert.match(results[1].error ?? '', /Invalid contestId/);
  assert.match(results[2].error ?? '', /Invalid problem index/);
  assert.deepEqual(results[3], {
    contestId: '',
    index: '',
    error: 'Missing contestId or index'
  });
});

test('validateProblemRef accepts well-formed refs and rejects bad ones', () => {
  assert.equal(validateProblemRef({ contestId: '2230', index: 'F' }), null);
  assert.equal(validateProblemRef({ contestId: '1', index: 'B2' }), null);
  assert.match(validateProblemRef({ contestId: '', index: 'A' }) ?? '', /Invalid contestId/);
  assert.match(validateProblemRef({ contestId: '1', index: 'aa' }) ?? '', /Invalid problem index/);
  assert.equal(
    validateProblemRef(null as unknown as { contestId: string; index: string }),
    'Missing contestId or index'
  );
});

test('fetchProblemsetCatalog returns problems on OK response', async () => {
  const catalog = await fetchProblemsetCatalog(
    mockFetch({ status: 'OK', result: { problems: MOCK_CATALOG } })
  );
  assert.equal(catalog.length, MOCK_CATALOG.length);
});

test('fetchProblemsetCatalog defaults to global fetch and the canonical URL', async (t) => {
  let requested = '';
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request) => {
      requested = String(input);
      return Response.json({ status: 'OK', result: { problems: MOCK_CATALOG } });
    },
    { times: 1 }
  );
  assert.equal((await fetchProblemsetCatalog()).length, MOCK_CATALOG.length);
  assert.equal(requested, PROBLEMSET_API_URL);
});

test('fetchProblemsetCatalog surfaces an actionable error on FAILED upstream response', async () => {
  await assert.rejects(
    () =>
      fetchProblemsetCatalog(
        mockFetch({
          status: 'FAILED',
          comment:
            'Non-gym contest standings for non-admin users are available only via anonymous GET requests with no extra parameters'
        })
      ),
    /Codeforces API error:.*anonymous GET requests/
  );
});

test('fetchProblemsetCatalog surfaces HTTP, network, and malformed payload errors', async () => {
  await assert.rejects(() => fetchProblemsetCatalog(mockFetch({}, false, 503)), /HTTP 503/);
  await assert.rejects(
    () => fetchProblemsetCatalog(async () => Promise.reject(new Error('offline'))),
    /Could not reach Codeforces \(offline\)/
  );
  await assert.rejects(
    () => fetchProblemsetCatalog(async () => Promise.reject('string failure')),
    /Could not reach Codeforces \(network error\)/
  );
  await assert.rejects(
    () => fetchProblemsetCatalog(mockFetch({ status: 'OK', result: {} })),
    /unexpected problemset payload/
  );
  await assert.rejects(
    () => fetchProblemsetCatalog(mockFetch({ status: 'FAILED' })),
    /did not return OK/
  );
});

test('problemsetApiUrl defaults to the real endpoint and honors an override base', () => {
  // No override: the canonical Codeforces endpoint (production behavior).
  assert.equal(problemsetApiUrl(), PROBLEMSET_API_URL);
  assert.equal(problemsetApiUrl(undefined), PROBLEMSET_API_URL);
  // Override base (e.g. an E2E stub host); a trailing slash is normalized.
  assert.equal(
    problemsetApiUrl('http://127.0.0.1:54321/api'),
    'http://127.0.0.1:54321/api/problemset.problems'
  );
  assert.equal(
    problemsetApiUrl('http://127.0.0.1:54321/api/'),
    'http://127.0.0.1:54321/api/problemset.problems'
  );
});

test('fetchProblemsetCatalog fetches the URL it is given (override seam)', async () => {
  let requested = '';
  const spyFetch: FetchLike = async (url: string) => {
    requested = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'OK', result: { problems: [] } })
    };
  };
  await fetchProblemsetCatalog(spyFetch, problemsetApiUrl('http://mock.test/api'));
  assert.equal(requested, 'http://mock.test/api/problemset.problems');
});

test('end-to-end: fetch catalog then resolve repro problems', async () => {
  const catalog = await fetchProblemsetCatalog(
    mockFetch({ status: 'OK', result: { problems: MOCK_CATALOG } })
  );
  const results = resolveFromCatalog(
    REPRO.map((p) => ({ contestId: p.contestId, index: p.index })),
    catalog
  );
  assert.ok(results.every((r) => r.problem && !r.error));
});

// A loader that counts invocations and resolves only when released, so a burst
// of concurrent get() calls can be observed while exactly one load is pending.
function deferredLoader() {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = async () => {
    calls += 1;
    await gate;
    return MOCK_CATALOG;
  };
  return { load, release, calls: () => calls };
}

test('createCatalogCache dedupes concurrent misses onto a single load', async () => {
  const loader = deferredLoader();
  const cache = createCatalogCache(1000, () => 0);

  const pending = [cache.get(loader.load), cache.get(loader.load), cache.get(loader.load)];
  loader.release();
  const results = await Promise.all(pending);

  assert.equal(loader.calls(), 1);
  for (const r of results) assert.equal(r, MOCK_CATALOG);
});

test('createCatalogCache reuses within TTL and reloads after it expires', async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return MOCK_CATALOG;
  };
  let clock = 0;
  const cache = createCatalogCache(1000, () => clock);

  await cache.get(load);
  clock = 999; // still within TTL
  await cache.get(load);
  assert.equal(calls, 1);

  clock = 1000; // TTL elapsed
  await cache.get(load);
  assert.equal(calls, 2);
});

test('resolveFromCatalog defaults absent tags and preserves absent ratings', () => {
  assert.deepEqual(
    resolveFromCatalog(
      [{ contestId: '7', index: 'A' }],
      [{ contestId: 7, index: 'A', name: 'No Tags', tags: undefined as unknown as string[] }]
    )[0].problem,
    { contestId: '7', index: 'A', name: 'No Tags', tags: [], rating: undefined }
  );
});

test('createCatalogCache runs each refresh through the loader passed to get()', async () => {
  let clock = 0;
  const cache = createCatalogCache(1000, () => clock);

  const used: string[] = [];
  const loaderFor = (tag: string) => async () => {
    used.push(tag);
    return MOCK_CATALOG;
  };

  await cache.get(loaderFor('first'));
  clock = 1000; // TTL elapsed, forcing a refresh
  await cache.get(loaderFor('second'));

  // The refresh must use the second call's loader, not the first captured one.
  assert.deepEqual(used, ['first', 'second']);
});

test('createCatalogCache does not cache a rejected load', async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    if (calls === 1) throw new Error('upstream down');
    return MOCK_CATALOG;
  };
  const cache = createCatalogCache(1000, () => 0);

  await assert.rejects(() => cache.get(load), /upstream down/);
  const catalog = await cache.get(load);
  assert.equal(calls, 2);
  assert.equal(catalog, MOCK_CATALOG);
});
