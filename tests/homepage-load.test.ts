import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _createHomepageLoad } from '../src/routes/+page.server.ts';
import type { Problem } from '../src/lib/queries/problemQueries.ts';

const problem: Problem = {
  id: 'p1',
  name: 'Problem',
  url: 'https://example.test/problem',
  addedBy: 'alice',
  addedByUrl: 'https://example.test/alice',
  likes: 1,
  dislikes: 0,
  source: 'codeforces'
};

async function invoke(successful: boolean, problems: Problem[]) {
  let headers: Record<string, string> = {};
  const load = _createHomepageLoad({
    fetchProblemsResult: async () =>
      successful ? { successful: true, problems } : { successful: false, problems: [] }
  });
  const data = await load({ setHeaders: (next) => (headers = next) });
  return { data, headers };
}

test('homepage publicly caches successful non-empty results', async () => {
  const result = await invoke(true, [problem]);
  assert.deepEqual(result.data, { problems: [problem] });
  assert.equal(
    result.headers['cache-control'],
    'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
  );
});

test('homepage publicly caches a successful empty result', async () => {
  const result = await invoke(true, []);
  assert.deepEqual(result.data, { problems: [] });
  assert.equal(
    result.headers['cache-control'],
    'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
  );
});

test('homepage explicitly disables caching after a failed read', async () => {
  const result = await invoke(false, []);
  assert.deepEqual(result.data, { problems: [] });
  assert.equal(result.headers['cache-control'], 'private, no-store');
});
