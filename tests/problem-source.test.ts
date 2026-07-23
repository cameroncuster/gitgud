import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProblemSource } from '../src/lib/services/problemSource.ts';

test('classifies canonical Kattis problem URLs', () => {
  assert.equal(getProblemSource('https://open.kattis.com/problems/hello'), 'kattis');
  assert.equal(getProblemSource('https://kattis.com/problems/hello'), 'kattis');
});

test('classifies ordinary Codeforces problem URLs', () => {
  assert.equal(getProblemSource('https://codeforces.com/problemset/problem/1/A'), 'codeforces');
});

test('does not classify URLs by an untrusted hostname substring', () => {
  for (const url of [
    'https://open.kattis.com.evil.example/problems/hello',
    'https://evil.example/open.kattis.com/problems/hello',
    'https://open.kattis.com@evil.example/problems/hello',
    'https://evil.example/?next=https://open.kattis.com/problems/hello',
    'not-a-url-containing-kattis.com'
  ]) {
    assert.equal(getProblemSource(url), 'codeforces');
  }
});
