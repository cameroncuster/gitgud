import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codeforcesProblemAliases,
  createCodeforcesIngestion,
  extractCodeforcesEntries,
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
