import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKattisIngestion,
  extractKattisEntries,
  mapKattisDifficulty,
  parseKattisProblemId,
  type KattisIngestionDependencies
} from '../src/lib/providers/kattis/ingestion.ts';

const now = '2026-01-01T00:00:00.000Z';

function ingestion(overrides: Partial<KattisIngestionDependencies> = {}) {
  return createKattisIngestion({
    checkProblem: async () => ({ duplicate: false }),
    fetchPage: async () => '<html />',
    parsePage: () => ({ name: 'Two Stones', rating: 1 }),
    now: () => now,
    logError: () => {},
    ...overrides
  });
}

test('accepts IDs and URLs, canonicalizes, and deduplicates', () => {
  assert.deepEqual(
    extractKattisEntries(
      'hello https://open.kattis.com/problems/hello open.kattis.com/problems/twostones'
    ),
    [
      { kind: 'problem', url: 'https://open.kattis.com/problems/hello' },
      { kind: 'problem', url: 'https://open.kattis.com/problems/twostones' }
    ]
  );
  assert.equal(parseKattisProblemId('https://evil.com/problems/hello'), null);
});

test('maps 1-10 ratings to 800-3500', () => {
  assert.equal(mapKattisDifficulty(1), 800);
  assert.equal(mapKattisDifficulty(5), 2000);
  assert.equal(mapKattisDifficulty(10), 3500);
});

test('page metadata produces exact defaults, submitter profile, and label', async () => {
  const service = ingestion();
  const [entry] = service.extract('hello');
  assert.deepEqual(await service.resolve(entry, 'alice'), {
    valid: true,
    kind: 'problem',
    label: 'Two Stones',
    url: entry.url,
    payload: {
      name: 'Two Stones',
      tags: [],
      difficulty: 800,
      url: entry.url,
      solved: 0,
      dateAdded: now,
      addedBy: 'alice',
      addedByUrl: 'https://open.kattis.com/users/alice',
      likes: 0,
      dislikes: 0
    }
  });
});

test('fetch or parse failure logs and remains a valid title-cased fallback row', async () => {
  const logs: unknown[][] = [];
  const service = ingestion({
    fetchPage: async () => {
      throw new Error('offline');
    },
    logError: (...values: unknown[]) => logs.push(values)
  });
  const [entry] = service.extract('customscontrols');
  const row = await service.resolve(entry, '');
  assert.equal(row.valid, true);
  assert.equal(row.valid && row.label, 'Customscontrols');
  assert.equal(row.valid && row.payload.difficulty, undefined);
  assert.equal(row.valid && row.payload.addedByUrl, 'https://open.kattis.com/users/');
  assert.equal(logs[0][0], 'Error fetching Kattis problem HTML:');
});

test('duplicate checks are read-only and ingestion exposes no persistence write', async () => {
  let checks = 0;
  const service = ingestion({
    checkProblem: async () => {
      checks++;
      return { duplicate: true, message: 'Problem already exists in database' };
    }
  });
  const [entry] = service.extract('hello');
  const row = await service.resolve(entry, '');
  assert.equal(checks, 1);
  assert.equal(row.valid, false);
  assert.equal('commit' in service, false);
});
