/**
 * Unit tests for post-login redirect sanitization. Run with:
 * `node --test tests/`
 *
 * These tests are pure and dependency-free: they exercise `sanitizeRedirect`
 * directly and never hit the network, a browser, Supabase, or any production
 * data. They lock in the same-origin validation that keeps the GitHub OAuth
 * callback's `next` parameter from becoming an open redirect (the class of bug
 * the old `/${next.slice(1)}` server callback allowed via `//evil.com`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRedirect, DEFAULT_REDIRECT } from '../src/lib/services/redirect.ts';

test('accepts single-slash-rooted same-origin paths unchanged', () => {
  assert.equal(sanitizeRedirect('/'), '/');
  assert.equal(sanitizeRedirect('/settings'), '/settings');
  assert.equal(sanitizeRedirect('/user/alice'), '/user/alice');
  assert.equal(sanitizeRedirect('/submit/codeforces'), '/submit/codeforces');
  assert.equal(sanitizeRedirect('/leaderboard?tab=all#top'), '/leaderboard?tab=all#top');
});

test('falls back to default for missing/empty values', () => {
  assert.equal(sanitizeRedirect(null), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect(undefined), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect(''), DEFAULT_REDIRECT);
});

test('rejects protocol-relative URLs (the open-redirect vector)', () => {
  assert.equal(sanitizeRedirect('//evil.com'), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect('//evil.com/path'), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect('///evil.com'), DEFAULT_REDIRECT);
});

test('rejects backslash variants browsers treat as protocol-relative', () => {
  assert.equal(sanitizeRedirect('/\\evil.com'), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect('\\\\evil.com'), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect('\\/evil.com'), DEFAULT_REDIRECT);
});

test('rejects absolute URLs and non-rooted values', () => {
  assert.equal(sanitizeRedirect('https://evil.com'), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect('http://evil.com/path'), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect('http:evil'), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect('settings'), DEFAULT_REDIRECT);
  assert.equal(sanitizeRedirect('evil.com'), DEFAULT_REDIRECT);
});
