import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDmojIngestion,
  extractDmojEntries,
  formatDmojLabel,
  parseDmojProblem,
  parseDmojProblemCode,
  parseDmojProblemPayload,
  type DmojIngestionDependencies
} from '../src/lib/providers/dmoj/ingestion.ts';

const now = '2026-01-01T00:00:00.000Z';

function ingestion(overrides: Partial<DmojIngestionDependencies> = {}) {
  return createDmojIngestion({
    checkProblem: async () => ({ duplicate: false }),
    fetchProblem: async () => ({}),
    parseProblem: () => ({ name: 'Number Shuffle', types: ['Simulation'] }),
    now: () => now,
    logError: () => {},
    ...overrides
  });
}

test('accepts only fully qualified DMOJ problem URLs and deduplicates', () => {
  assert.deepEqual(
    extractDmojEntries(
      'https://dmoj.ca/problem/ciw26p2 https://www.dmoj.ca/problem/ciw26p2\ndmoj.ca/problem/helloworld'
    ),
    [
      { kind: 'problem', url: 'https://dmoj.ca/problem/ciw26p2' },
      { kind: 'problem', url: 'https://dmoj.ca/problem/helloworld' }
    ]
  );
  // A bare code is never a DMOJ problem: the codes are opaque short strings.
  assert.deepEqual(extractDmojEntries('ciw26p2'), []);
});

test('problem code parsing rejects every untrusted or malformed target', () => {
  for (const input of [
    '',
    '   ',
    'http://',
    'http://dmoj.ca/problem/ciw26p2',
    'https://dmoj.ca.evil.example/problem/ciw26p2',
    'https://dmoj.ca:8443/problem/ciw26p2',
    'https://user:pass@dmoj.ca/problem/ciw26p2',
    'https://dmoj.ca/problem/ciw26p2/submit',
    'https://dmoj.ca/user/ciw26p2',
    'https://dmoj.ca/problem/CIW26P2',
    // Scheme-relative input carries no base to resolve against.
    '//dmoj.ca/problem/ciw26p2'
  ]) {
    assert.equal(parseDmojProblemCode(input), null, input);
  }
  assert.equal(parseDmojProblemCode(null as unknown as string), null);
  assert.equal(parseDmojProblemCode(' https://dmoj.ca/problem/an_underscore '), 'an_underscore');
});

test('problem parsing and labels preserve canonical codes', () => {
  assert.deepEqual(parseDmojProblem('https://www.dmoj.ca/problem/ciw26p2'), {
    problemCode: 'ciw26p2',
    url: 'https://dmoj.ca/problem/ciw26p2'
  });
  assert.equal(parseDmojProblem('not valid'), null);
  assert.equal(formatDmojLabel('https://dmoj.ca/problem/ciw26p2'), 'ciw26p2');
  assert.equal(
    formatDmojLabel('https://dmoj.ca/problem/ciw26p2', 'Number Shuffle'),
    'Number Shuffle'
  );
});

test('API payload parsing tolerates every missing or mistyped field', () => {
  assert.deepEqual(
    parseDmojProblemPayload(
      { data: { object: { name: '  Number Shuffle  ', types: ['Simulation', 7] } } },
      'ciw26p2'
    ),
    { name: 'Number Shuffle', types: ['Simulation'] }
  );
  assert.deepEqual(parseDmojProblemPayload({ data: { object: { name: '   ' } } }, 'ciw26p2'), {
    name: 'ciw26p2',
    types: []
  });
  assert.deepEqual(parseDmojProblemPayload({ data: { object: { name: 7, types: 'x' } } }, 'x1'), {
    name: 'x1',
    types: []
  });
  assert.deepEqual(parseDmojProblemPayload(undefined, 'x1'), { name: 'x1', types: [] });
});

test('API metadata produces exact defaults, submitter profile, and label', async () => {
  const service = ingestion();
  const [entry] = service.extract('https://dmoj.ca/problem/ciw26p2');
  assert.deepEqual(await service.resolve(entry, 'alice'), {
    valid: true,
    kind: 'problem',
    label: 'Number Shuffle',
    url: entry.url,
    payload: {
      name: 'Number Shuffle',
      tags: ['Simulation'],
      url: entry.url,
      solved: 0,
      dateAdded: now,
      addedBy: 'alice',
      addedByUrl: 'https://dmoj.ca/user/alice',
      likes: 0,
      dislikes: 0
    }
  });
});

test('fetch or parse failure logs and remains a valid code-named fallback row', async () => {
  const logs: unknown[][] = [];
  const service = ingestion({
    fetchProblem: async () => {
      throw new Error('offline');
    },
    logError: (...values: unknown[]) => logs.push(values)
  });
  const [entry] = service.extract('https://dmoj.ca/problem/ciw26p2');
  const row = await service.resolve(entry, '');
  assert.equal(row.valid, true);
  assert.equal(row.valid && row.label, 'ciw26p2');
  assert.equal(row.valid && row.payload.difficulty, undefined);
  assert.deepEqual(row.valid && row.kind === 'problem' ? row.payload.tags : null, []);
  assert.equal(row.valid && row.payload.addedByUrl, 'https://dmoj.ca');
  assert.equal(logs[0][0], 'Error fetching DMOJ problem metadata:');
});

test('invalid entries and duplicate errors avoid API fetches', async () => {
  let fetches = 0;
  const service = ingestion({
    checkProblem: async () => ({ duplicate: false, error: 'database unavailable' }),
    fetchProblem: async () => {
      fetches++;
      return {};
    }
  });
  const invalid = await service.resolve(
    { kind: 'problem', url: 'https://evil.test/problem/x' },
    ''
  );
  assert.deepEqual(invalid, {
    valid: false,
    kind: 'problem',
    label: 'https://evil.test/problem/x',
    url: 'https://evil.test/problem/x',
    reason: 'Invalid URL'
  });
  const [entry] = service.extract('https://dmoj.ca/problem/ciw26p2');
  const duplicate = await service.resolve(entry, '');
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.valid ? '' : duplicate.reason, 'database unavailable');
  assert.equal(fetches, 0);
});

test('duplicate checks are read-only and ingestion exposes no persistence write', async () => {
  let checks = 0;
  const service = ingestion({
    checkProblem: async () => (checks++, { duplicate: true })
  });
  const [entry] = service.extract('https://dmoj.ca/problem/ciw26p2');
  const row = await service.resolve(entry, '');
  assert.equal(checks, 1);
  assert.equal(row.valid, false);
  assert.equal(row.valid ? '' : row.reason, 'Problem already exists in database');
  assert.equal(row.valid ? '' : row.label, 'ciw26p2');
  assert.equal('commit' in service, false);
});
