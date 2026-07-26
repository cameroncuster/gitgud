import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  kattisProblemUrls,
  matchKattisSolves,
  MAX_KATTIS_INPUT_SIZE,
  MAX_KATTIS_SOLVES,
  parseKattisSolveInput
} from '../src/lib/services/kattisSolves.ts';

test('paste parser accepts canonical IDs and URLs, rejects noise, and counts duplicates', () => {
  const parsed = parseKattisSolveInput(
    'gamma https://open.kattis.com/problems/gamma, twostones https://evil.test/problems/nope'
  );
  assert.deepEqual(parsed, {
    problemIds: ['gamma', 'twostones'],
    duplicateCount: 1,
    capped: false
  });
});

test('saved HTML extraction stays local and finds canonical Kattis problem paths', () => {
  const parsed = parseKattisSolveInput(
    '<a href="https://open.kattis.com/problems/gamma">Gamma</a>' +
      '<a href="/problems/twostones?tab=submissions">Two Stones</a>' +
      '<a href="/users/person">Profile</a>' +
      '<script>const url = "https://open.kattis.com/problems/different";</script>',
    true
  );
  assert.deepEqual(parsed.problemIds, ['gamma', 'twostones', 'different']);
  assert.deepEqual(parseKattisSolveInput('', true).problemIds, []);
});

test('parser caps oversized content and extracted IDs', () => {
  const oversized = parseKattisSolveInput('a'.repeat(MAX_KATTIS_INPUT_SIZE + 1));
  assert.equal(oversized.capped, true);

  const many = parseKattisSolveInput(
    Array.from({ length: MAX_KATTIS_SOLVES + 2 }, (_, index) => `problem${index}`).join(' ')
  );
  assert.equal(many.problemIds.length, MAX_KATTIS_SOLVES);
  assert.equal(many.capped, true);
});

test('matcher returns only tracked database problems and bounded canonical URLs', () => {
  const parsed = parseKattisSolveInput('gamma missing gamma');
  const result = matchKattisSolves(parsed, [
    {
      id: 'database-uuid',
      url: 'https://open.kattis.com/problems/gamma',
      name: 'Gamma'
    },
    { id: 'other', url: 'https://codeforces.com/contest/1/problem/A', name: 'Other' }
  ]);
  assert.deepEqual(result, {
    matched: [
      {
        id: 'database-uuid',
        url: 'https://open.kattis.com/problems/gamma',
        name: 'Gamma'
      }
    ],
    unmatchedCount: 1,
    duplicateCount: 1,
    capped: false
  });
  assert.deepEqual(kattisProblemUrls(parsed.problemIds), [
    'https://open.kattis.com/problems/gamma',
    'https://open.kattis.com/problems/missing'
  ]);
  assert.deepEqual(
    matchKattisSolves(parseKattisSolveInput('gamma'), [
      { id: '', url: 'not-a-kattis-url', name: 'Invalid' }
    ]).matched,
    []
  );
});
