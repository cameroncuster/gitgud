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

test('homepage never caches mutable reaction counts', async () => {
  for (const [successful, problems] of [
    [true, [problem]],
    [true, []],
    [false, []]
  ] as const) {
    const result = await invoke(successful, [...problems]);
    assert.deepEqual(result.data, { problems: [...problems] });
    assert.equal(result.headers['cache-control'], 'no-store');
  }
});
