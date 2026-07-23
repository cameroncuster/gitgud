/**
 * Unit tests for the pure Codeforces solved-problem import helpers. Run with:
 * `node --test tests/`
 *
 * These exercise the dependency-free normalization, bounding, URL extraction,
 * and intersection logic only. They never hit the network, Supabase, or any
 * production data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHandle,
  isValidHandle,
  codeforcesUserStatusUrl,
  extractSolvedProblemUrls,
  matchSolvedToProblems,
  CODEFORCES_USER_STATUS_URL,
  MAX_SUBMISSIONS,
  MAX_SOLVED_URLS,
  type TrackedProblem
} from '../src/lib/services/codeforcesSolves.ts';

// --- handle normalization / validation ---------------------------------------

test('normalizeHandle trims surrounding whitespace only', () => {
  assert.equal(normalizeHandle('  tourist  '), 'tourist');
  assert.equal(normalizeHandle('tourist'), 'tourist');
});

test('isValidHandle accepts realistic Codeforces handles', () => {
  for (const h of ['tourist', 'Um_nik', 'a.b-c', 'jiangly', 'ABC_123', 'x'.repeat(24)]) {
    assert.ok(isValidHandle(h), `expected ${h} to be valid`);
  }
});

test('isValidHandle rejects empty, too-short, too-long, and out-of-charset input', () => {
  for (const h of ['', 'ab', 'x'.repeat(25), 'has space', 'bad/slash', 'quote"', 'semi;colon']) {
    assert.ok(!isValidHandle(h), `expected ${JSON.stringify(h)} to be invalid`);
  }
});

// --- upstream URL construction (fixed host) ----------------------------------

test('codeforcesUserStatusUrl uses the fixed Codeforces host by default', () => {
  const url = codeforcesUserStatusUrl('tourist');
  assert.ok(url.startsWith(`${CODEFORCES_USER_STATUS_URL}?handle=`));
  assert.ok(url.includes('handle=tourist'));
});

test('codeforcesUserStatusUrl encodes the handle into the query, never the host', () => {
  const url = codeforcesUserStatusUrl('a b&c');
  assert.ok(url.startsWith(`${CODEFORCES_USER_STATUS_URL}?handle=`));
  assert.ok(url.includes('handle=a%20b%26c'));
  // Only one query parameter; the encoded handle cannot inject host/path.
  assert.equal(url.split('?')[0], CODEFORCES_USER_STATUS_URL);
});

test('codeforcesUserStatusUrl honors an optional base override (E2E redirect)', () => {
  const url = codeforcesUserStatusUrl('tourist', 'http://mock.test/api');
  assert.equal(url, 'http://mock.test/api/user.status?handle=tourist');
  // A trailing slash on the base is normalized away.
  assert.equal(
    codeforcesUserStatusUrl('tourist', 'http://mock.test/api/'),
    'http://mock.test/api/user.status?handle=tourist'
  );
});

// --- solved URL extraction (verdict, dedup, bounds, gym) ---------------------

const ok = (contestId: number, index: string) => ({ verdict: 'OK', problem: { contestId, index } });

test('extractSolvedProblemUrls keeps only accepted solves and de-duplicates', () => {
  const urls = extractSolvedProblemUrls([
    ok(1000, 'A'),
    ok(1000, 'A'), // duplicate accepted solve
    { verdict: 'WRONG_ANSWER', problem: { contestId: 1000, index: 'B' } },
    ok(1000, 'C')
  ]);
  assert.deepEqual(urls, [
    'https://codeforces.com/contest/1000/problem/A',
    'https://codeforces.com/contest/1000/problem/C'
  ]);
});

test('extractSolvedProblemUrls produces the canonical contest URL shape', () => {
  const urls = extractSolvedProblemUrls([ok(2230, 'F'), ok(1528, 'C2')]);
  assert.deepEqual(urls, [
    'https://codeforces.com/contest/1528/problem/C2',
    'https://codeforces.com/contest/2230/problem/F'
  ]);
});

test('extractSolvedProblemUrls excludes gym solves (not part of the trackable set)', () => {
  const urls = extractSolvedProblemUrls([ok(100001, 'A'), ok(1000, 'A')]);
  assert.deepEqual(urls, ['https://codeforces.com/contest/1000/problem/A']);
});

test('extractSolvedProblemUrls rejects malformed / untrusted submission shapes', () => {
  const urls = extractSolvedProblemUrls([
    { verdict: 'OK', problem: { contestId: 'not-a-number', index: 'A' } },
    { verdict: 'OK', problem: { contestId: 1000 } }, // missing index
    { verdict: 'OK', problem: { contestId: 1000, index: 'a' } }, // lowercase index
    { verdict: 'OK', problem: { contestId: -5, index: 'A' } }, // non-positive
    { verdict: 'OK' }, // missing problem
    null,
    'garbage'
  ]);
  assert.deepEqual(urls, []);
});

test('extractSolvedProblemUrls returns [] for non-array input', () => {
  assert.deepEqual(extractSolvedProblemUrls(undefined), []);
  assert.deepEqual(extractSolvedProblemUrls(null), []);
  assert.deepEqual(extractSolvedProblemUrls({ result: [] }), []);
});

test('extractSolvedProblemUrls stops scanning past MAX_SUBMISSIONS', () => {
  // One accepted solve placed just past the scan cap must be ignored.
  const filler = Array.from({ length: MAX_SUBMISSIONS }, () => ({
    verdict: 'WRONG_ANSWER',
    problem: { contestId: 1, index: 'A' }
  }));
  const beyond = [...filler, ok(9999, 'Z')];
  assert.deepEqual(extractSolvedProblemUrls(beyond), []);
});

test('extractSolvedProblemUrls caps the number of distinct solved URLs returned', () => {
  // Generate more distinct accepted solves than MAX_SOLVED_URLS.
  const many = Array.from({ length: MAX_SOLVED_URLS + 50 }, (_unused, i) => ok(1000 + i, 'A'));
  const urls = extractSolvedProblemUrls(many);
  assert.equal(urls.length, MAX_SOLVED_URLS);
});

// --- intersection with tracked problems --------------------------------------

const TRACKED: TrackedProblem[] = [
  { id: 'p1', url: 'https://codeforces.com/contest/1000/problem/A', name: 'Alpha' },
  { id: 'p2', url: 'https://codeforces.com/contest/1000/problem/B', name: 'Beta' },
  { id: 'p3', url: 'https://open.kattis.com/problems/gamma', name: 'Gamma' }
];

test('matchSolvedToProblems returns only tracked matches and counts the rest', () => {
  const result = matchSolvedToProblems(
    [
      'https://codeforces.com/contest/1000/problem/A',
      'https://codeforces.com/contest/1000/problem/B',
      'https://codeforces.com/contest/9999/problem/Z' // not tracked
    ],
    TRACKED
  );
  assert.deepEqual(
    result.matched.map((m) => m.id),
    ['p1', 'p2']
  );
  assert.equal(result.unmatchedCount, 1);
});

test('matchSolvedToProblems never invents problems and returns empty on no overlap', () => {
  const result = matchSolvedToProblems(['https://codeforces.com/contest/5/problem/A'], TRACKED);
  assert.deepEqual(result.matched, []);
  assert.equal(result.unmatchedCount, 1);
});

test('matchSolvedToProblems does not duplicate a matched problem', () => {
  const result = matchSolvedToProblems(
    [
      'https://codeforces.com/contest/1000/problem/A',
      'https://codeforces.com/contest/1000/problem/A'
    ],
    TRACKED
  );
  assert.deepEqual(
    result.matched.map((m) => m.id),
    ['p1']
  );
});

test('matchSolvedToProblems handles an empty tracked set', () => {
  const result = matchSolvedToProblems(['https://codeforces.com/contest/1000/problem/A'], []);
  assert.deepEqual(result.matched, []);
  assert.equal(result.unmatchedCount, 1);
});
