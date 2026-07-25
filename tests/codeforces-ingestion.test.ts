import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codeforcesProblemAliases,
  createCodeforcesIngestion,
  extractCodeforcesEntries,
  parseCodeforcesContestUrl,
  parseCodeforcesProblemUrl,
  type CodeforcesIngestionDependencies
} from '../src/lib/providers/codeforces/ingestion.ts';

const now = '2026-01-01T00:00:00.000Z';

function ingestion(overrides: Partial<CodeforcesIngestionDependencies> = {}) {
  return createCodeforcesIngestion({
    checkProblem: async () => ({ duplicate: false }),
    checkContest: async () => ({ duplicate: false }),
    resolveProblemBatch: async (refs) =>
      new Map(
        refs.map((ref) => [
          `${ref.contestId}:${ref.index}`,
          {
            problem: {
              ...ref,
              name: `Problem ${ref.index}`,
              tags: ['math'],
              rating: 1200
            }
          }
        ])
      ),
    fetchJson: async () => ({ status: 'OK', result: [] }),
    now: () => now,
    ...overrides
  });
}

test('default Codeforces metadata fetcher uses global fetch', async (t) => {
  let requested = '';
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request) => {
      requested = String(input);
      return Response.json({
        status: 'OK',
        result: [{ id: 9, name: 'Fetched Round', durationSeconds: 7200 }]
      });
    },
    { times: 1 }
  );
  const service = createCodeforcesIngestion({
    checkProblem: async () => ({ duplicate: false }),
    checkContest: async () => ({ duplicate: false }),
    resolveProblemBatch: async () => new Map(),
    now: () => now
  });
  const [entry] = service.extract('https://codeforces.com/contest/9');
  const resolved = await service.resolve(entry, '');
  assert.equal(resolved.valid && resolved.payload.name, 'Fetched Round');
  assert.equal(requested, 'https://codeforces.com/api/contest.list?gym=false');
});

test('extracts, canonicalizes, deduplicates, and orders problems before contests', () => {
  assert.deepEqual(
    extractCodeforcesEntries(
      'https://codeforces.com/contest/2 https://mirror.codeforces.com/contest/1/problem/A\n' +
        'https://codeforces.com/problemset/problem/1/A https://codeforces.com/gym/3/problem/B'
    ),
    [
      { kind: 'problem', url: 'https://codeforces.com/contest/1/problem/A' },
      { kind: 'problem', url: 'https://codeforces.com/gym/3/problem/B' },
      { kind: 'contest', url: 'https://codeforces.com/contest/2' }
    ]
  );
});

test('parses contest and gym roots while rejecting problem and foreign URLs', () => {
  assert.deepEqual(parseCodeforcesContestUrl('mirror.codeforces.com/contest/42'), {
    contestId: '42',
    isGym: false,
    url: 'https://codeforces.com/contest/42'
  });
  assert.deepEqual(parseCodeforcesContestUrl('https://codeforces.com/gym/7'), {
    contestId: '7',
    isGym: true,
    url: 'https://codeforces.com/gym/7'
  });
  assert.equal(parseCodeforcesContestUrl('https://codeforces.com/contest/42/problem/A'), null);
  assert.equal(parseCodeforcesContestUrl('https://example.test/contest/42'), null);
});

test('per-paste regular problems use one catalog request and exact drafts', async () => {
  let requests = 0;
  const service = ingestion({
    resolveProblemBatch: async (refs: Array<{ contestId: string; index: string }>) => {
      requests++;
      return new Map(
        refs.map((ref) => [
          `${ref.contestId}:${ref.index}`,
          { problem: { ...ref, name: `Name ${ref.index}`, tags: ['dp'], rating: 1700 } }
        ])
      );
    }
  });
  const entries = service.extract(
    'https://codeforces.com/contest/1/problem/A https://codeforces.com/contest/1/problem/B'
  );
  const first = await service.resolve(entries[0], 'alice');
  const second = await service.resolve(entries[1], 'alice');
  assert.equal(requests, 1);
  assert.deepEqual(first, {
    valid: true,
    kind: 'problem',
    label: 'CF 1A - Name A',
    url: entries[0].url,
    payload: {
      name: 'Name A',
      tags: ['dp'],
      difficulty: 1700,
      url: entries[0].url,
      solved: 0,
      dateAdded: now,
      addedBy: 'alice',
      addedByUrl: 'https://codeforces.com/profile/alice',
      likes: 0,
      dislikes: 0
    }
  });
  assert.equal(second.valid, true);
});

test('regular problem aliases are handed to the duplicate boundary', async () => {
  let checkedAliases: readonly string[] | undefined;
  const service = ingestion({
    checkProblem: async (_url, aliases) => {
      checkedAliases = aliases;
      return { duplicate: false };
    }
  });
  const [entry] = service.extract('https://codeforces.com/contest/42/problem/C');
  await service.resolve(entry, '');
  assert.deepEqual(checkedAliases, ['https://codeforces.com/problemset/problem/42/C']);

  const info = parseCodeforcesProblemUrl(entry.url);
  assert.ok(info);
  assert.deepEqual(codeforcesProblemAliases(info), checkedAliases);
});

test('gym fallback and contest drafts preserve defaults', async () => {
  const service = ingestion({
    fetchJson: async (url: string) =>
      url.includes('contest.list')
        ? {
            status: 'OK',
            result: [{ id: 9, name: 'Codeforces Round', durationSeconds: 7200 }]
          }
        : { status: 'OK', result: { problems: [] } }
  });
  const entries = service.extract(
    'https://codeforces.com/gym/7/problem/A https://codeforces.com/contest/9'
  );
  const gym = await service.resolve(entries[0], '');
  const contest = await service.resolve(entries[1], '');
  assert.deepEqual(gym, {
    valid: true,
    kind: 'problem',
    label: 'GYM 7A - Problem A from Gym Contest 7',
    url: 'https://codeforces.com/gym/7/problem/A',
    payload: {
      name: 'Problem A from Gym Contest 7',
      tags: ['gym'],
      url: 'https://codeforces.com/gym/7/problem/A',
      solved: 0,
      dateAdded: now,
      addedBy: 'tourist',
      addedByUrl: 'https://codeforces.com/profile/tourist',
      likes: 0,
      dislikes: 0
    }
  });
  assert.deepEqual(contest, {
    valid: true,
    kind: 'contest',
    label: 'Codeforces Round',
    url: 'https://codeforces.com/contest/9',
    payload: {
      name: 'Codeforces Round',
      url: 'https://codeforces.com/contest/9',
      durationSeconds: 7200,
      difficulty: undefined,
      addedBy: 'tourist',
      addedByUrl: 'https://codeforces.com/profile/tourist',
      likes: 0,
      dislikes: 0,
      type: 'Codeforces'
    }
  });
});

test('gym problem metadata preserves provider tags and rating', async () => {
  const service = ingestion({
    fetchJson: async () => ({
      status: 'OK',
      result: { problems: [{ index: 'A', name: 'Gym A', tags: ['graphs'], rating: 1900 }] }
    })
  });
  const [entry] = service.extract('https://codeforces.com/gym/7/problem/A');
  const row = await service.resolve(entry, 'alice');
  assert.equal(row.valid, true);
  assert.equal(row.valid && row.payload.name, 'Gym A');
  assert.equal(row.valid && row.payload.difficulty, 1900);
  assert.equal(row.valid && row.kind, 'problem');
  if (row.valid && row.kind === 'problem') assert.deepEqual(row.payload.tags, ['graphs']);
});

test('contest duplicate errors prevent upstream fetches', async () => {
  let fetches = 0;
  const service = ingestion({
    checkContest: async () => ({ duplicate: false, error: 'database unavailable' }),
    fetchJson: async () => {
      fetches++;
      return { status: 'OK', result: [] };
    }
  });
  const [entry] = service.extract('https://codeforces.com/contest/9');
  const row = await service.resolve(entry, '');
  assert.equal(row.valid, false);
  assert.equal(row.valid ? '' : row.reason, 'database unavailable');
  assert.equal(fetches, 0);
});

test('gym and ICPC contest metadata use the ICPC type', async () => {
  const gym = ingestion({
    fetchJson: async () => ({
      status: 'OK',
      result: { contest: { id: 7, name: 'Gym Round', durationSeconds: 18000 } }
    })
  });
  const [gymEntry] = gym.extract('https://codeforces.com/gym/7');
  const gymRow = await gym.resolve(gymEntry, '');
  assert.equal(gymRow.valid && gymRow.payload.type, 'ICPC');

  const icpc = ingestion({
    fetchJson: async () => ({
      status: 'OK',
      result: [{ id: 9, name: 'Regional', durationSeconds: 18000, kind: 'ICPC' }]
    })
  });
  const [contestEntry] = icpc.extract('https://codeforces.com/contest/9');
  const contestRow = await icpc.resolve(contestEntry, '');
  assert.equal(contestRow.valid && contestRow.payload.type, 'ICPC');
});

test('contest provider failures and missing metadata become invalid rows', async () => {
  for (const fetchJson of [
    async () => ({ status: 'FAILED' }),
    async () => ({ status: 'OK', result: [] }),
    async () => Promise.reject('unknown failure')
  ]) {
    const service = ingestion({ fetchJson });
    const [entry] = service.extract('https://codeforces.com/contest/9');
    const row = await service.resolve(entry, '');
    assert.equal(row.valid, false);
    assert.ok((row.valid ? '' : row.reason).length > 0);
  }
});

test('thrown catalog failures become formatted invalid rows', async () => {
  const service = ingestion({
    resolveProblemBatch: async () => {
      throw new Error('catalog offline');
    }
  });
  const [entry] = service.extract('https://codeforces.com/contest/1/problem/A');
  assert.deepEqual(await service.resolve(entry, ''), {
    valid: false,
    kind: 'problem',
    label: 'CF 1A',
    url: entry.url,
    reason: 'catalog offline'
  });
});

test('missing catalog entries, provider failures, and duplicates become invalid rows', async () => {
  const missing = ingestion({ resolveProblemBatch: async () => new Map() });
  const [entry] = missing.extract('https://codeforces.com/contest/1/problem/A');
  const missingRow = await missing.resolve(entry, '');
  assert.match(missingRow.valid ? '' : missingRow.reason, /not found/);

  const failed = ingestion({ fetchJson: async () => ({ status: 'FAILED' }) });
  const [gym] = failed.extract('https://codeforces.com/gym/1/problem/A');
  const failedRow = await failed.resolve(gym, '');
  assert.equal(failedRow.valid, false);

  const duplicate = ingestion({
    checkProblem: async () => ({
      duplicate: true,
      message: 'Problem already exists in database (with alternate URL)'
    })
  });
  const [problem] = duplicate.extract('https://codeforces.com/contest/1/problem/A');
  const duplicateRow = await duplicate.resolve(problem, '');
  assert.equal(duplicateRow.valid, false);
  assert.equal(
    duplicateRow.valid ? '' : duplicateRow.reason,
    'Problem already exists in database (with alternate URL)'
  );
});
