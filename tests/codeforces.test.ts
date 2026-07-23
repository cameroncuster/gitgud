/**
 * Unit tests for Codeforces problem URL parsing and problemset-based metadata
 * resolution. Run with: `node --test tests/`
 *
 * These tests exercise the pure, dependency-free helpers only. They use a
 * mocked fetch and never hit the network, Supabase, or any production data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchProblemsetCatalog,
  resolveFromCatalog,
  validateProblemRef,
  parseProblemUrl,
  type CodeforcesProblemsetProblem,
  type FetchLike
} from '../src/lib/services/codeforcesProblemset.ts';

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
      { contestId: '4', index: '1' } // invalid index
    ],
    MOCK_CATALOG
  );

  assert.match(results[0].error ?? '', /not found/i);
  assert.match(results[1].error ?? '', /Invalid contestId/);
  assert.match(results[2].error ?? '', /Invalid problem index/);
});

test('validateProblemRef accepts well-formed refs and rejects bad ones', () => {
  assert.equal(validateProblemRef({ contestId: '2230', index: 'F' }), null);
  assert.equal(validateProblemRef({ contestId: '1', index: 'B2' }), null);
  assert.match(validateProblemRef({ contestId: '', index: 'A' }) ?? '', /Invalid contestId/);
  assert.match(validateProblemRef({ contestId: '1', index: 'aa' }) ?? '', /Invalid problem index/);
});

test('fetchProblemsetCatalog returns problems on OK response', async () => {
  const catalog = await fetchProblemsetCatalog(
    mockFetch({ status: 'OK', result: { problems: MOCK_CATALOG } })
  );
  assert.equal(catalog.length, MOCK_CATALOG.length);
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

test('fetchProblemsetCatalog surfaces HTTP errors', async () => {
  await assert.rejects(() => fetchProblemsetCatalog(mockFetch({}, false, 503)), /HTTP 503/);
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
