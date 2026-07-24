/**
 * Unit tests for the Kattis problem-reference validator that guards the
 * `/api/kattis` proxy against SSRF / open-proxy abuse. Run with:
 * `node --test tests/`
 *
 * These tests exercise the pure, dependency-free Kattis ingestion helpers
 * only. They never hit the network, a browser, Supabase, or any production
 * data. Their purpose is to lock in exactly which inputs the proxy will treat
 * as a canonical Kattis problem reference (and therefore fetch) and which it
 * rejects, so a future refactor cannot silently reintroduce the open-proxy
 * behaviour this replaced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKattisProblemId,
  buildCanonicalKattisProblemUrl,
  KATTIS_HOST
} from '../src/lib/providers/kattis/ingestion.ts';

// --- valid inputs: bare ids and canonical / submitter-friendly URLs ----------
// Each maps to a problem id; the proxy rebuilds the canonical URL from it.
const VALID: Array<[input: string, expectedId: string]> = [
  // Bare problem ids (the placeholder's `customscontrols` case).
  ['hello', 'hello'],
  ['twostones', 'twostones'],
  ['customscontrols', 'customscontrols'],
  ['a1b2c3', 'a1b2c3'],
  ['  hello  ', 'hello'], // surrounding whitespace is trimmed
  // Canonical https URL.
  ['https://open.kattis.com/problems/hello', 'hello'],
  // Explicit default https port is normalized away by the URL parser, so it is
  // the same canonical target and accepted.
  ['https://open.kattis.com:443/problems/hello', 'hello'],
  // Scheme-less host forms accepted for submitter convenience (placeholder
  // examples), all canonicalizing to open.kattis.com.
  ['open.kattis.com/problems/twostones', 'twostones'],
  ['kattis.com/problems/hello', 'hello'],
  ['www.kattis.com/problems/hello', 'hello'],
  // Query string and fragment are ignored — the id still resolves.
  ['https://open.kattis.com/problems/hello?foo=bar', 'hello'],
  ['https://open.kattis.com/problems/hello#section', 'hello']
];

for (const [input, expectedId] of VALID) {
  test(`accepts valid input: ${JSON.stringify(input)}`, () => {
    assert.equal(parseKattisProblemId(input), expectedId);
  });

  test(`rebuilds canonical URL for: ${JSON.stringify(input)}`, () => {
    const id = parseKattisProblemId(input);
    assert.ok(id, 'expected a non-null id');
    assert.equal(
      buildCanonicalKattisProblemUrl(id),
      `https://${KATTIS_HOST}/problems/${expectedId}`
    );
  });
}

// --- malicious / invalid inputs: every one MUST be rejected (null) -----------
const INVALID: Array<[label: string, input: unknown]> = [
  ['empty string', ''],
  ['whitespace only', '   '],
  // Wrong scheme.
  ['http (not https)', 'http://open.kattis.com/problems/hello'],
  ['ftp scheme', 'ftp://open.kattis.com/problems/hello'],
  ['file scheme', 'file:///etc/passwd'],
  ['javascript scheme', 'javascript:alert(1)//open.kattis.com/problems/hello'],
  ['data scheme', 'data:text/html,<script>alert(1)</script>'],
  // Scheme-relative — must NOT be silently upgraded to https on a foreign host.
  ['scheme-relative to evil host', '//evil.com/problems/hello'],
  ['scheme-relative to kattis path on evil host', '//evil.com/open.kattis.com/problems/hello'],
  // Subdomain / lookalike host tricks.
  ['foreign host', 'https://evil.com/problems/hello'],
  ['kattis path on foreign host', 'https://evil.com/open.kattis.com/problems/hello'],
  ['subdomain prefix trick', 'https://open.kattis.com.evil.com/problems/hello'],
  ['unexpected subdomain', 'https://sub.open.kattis.com/problems/hello'],
  ['lookalike without dot', 'https://openkattis.com/problems/hello'],
  ['lookalike homoglyph-ish', 'https://open-kattis.com/problems/hello'],
  ['trailing-dot host (FQDN)', 'https://open.kattis.com./problems/hello'],
  // Userinfo / credentials splitting the host.
  ['userinfo before real host', 'https://open.kattis.com@evil.com/problems/hello'],
  ['userinfo making kattis the user', 'https://evil.com@open.kattis.com/problems/hello'],
  ['userinfo with password', 'https://user:pass@open.kattis.com/problems/hello'],
  // Explicit non-default port. (`:443` is the https default and the URL parser
  // normalizes it away, so it is not a distinct target and is covered by the
  // canonical-URL accept case rather than rejected here.)
  ['explicit port', 'https://open.kattis.com:8080/problems/hello'],
  ['explicit port 80', 'https://open.kattis.com:80/problems/hello'],
  // localhost / private / metadata IP targets (classic SSRF pivots).
  ['localhost', 'https://localhost/problems/hello'],
  ['loopback ip', 'https://127.0.0.1/problems/hello'],
  ['ipv6 loopback', 'https://[::1]/problems/hello'],
  ['private 10.x', 'https://10.0.0.1/problems/hello'],
  ['private 192.168.x', 'https://192.168.1.1/problems/hello'],
  ['link-local 169.254', 'https://169.254.169.254/problems/hello'],
  ['gcp/aws metadata ip', 'http://169.254.169.254/latest/meta-data/'],
  ['metadata hostname', 'https://metadata.google.internal/computeMetadata/v1/'],
  // Non-problem paths on the real host.
  ['host root', 'https://open.kattis.com/'],
  ['users path', 'https://open.kattis.com/users/hello'],
  ['problems index (no id)', 'https://open.kattis.com/problems'],
  ['problems trailing slash', 'https://open.kattis.com/problems/'],
  ['nested problem path', 'https://open.kattis.com/problems/hello/submit'],
  ['path traversal in id', 'https://open.kattis.com/problems/../users/hello'],
  // Invalid id characters (bare and in-URL).
  ['bare id with uppercase', 'Hello'],
  ['bare id with hyphen', 'hello-world'],
  ['bare id with dot', 'hello.world'],
  ['bare id with slash', 'hello/world'],
  ['bare id with space', 'hello world'],
  ['url id with uppercase', 'https://open.kattis.com/problems/Hello'],
  ['url id with hyphen', 'https://open.kattis.com/problems/hello-world'],
  // Encoded tricks that must not decode into a valid canonical fetch.
  ['encoded slash in id', 'https://open.kattis.com/problems/hello%2Fworld'],
  ['encoded newline in id', 'https://open.kattis.com/problems/hello%0d%0a'],
  // Non-string inputs (defensive).
  ['null', null],
  ['undefined', undefined],
  ['number', 123],
  ['object', {}]
];

for (const [label, input] of INVALID) {
  test(`rejects ${label}: ${JSON.stringify(input)}`, () => {
    assert.equal(parseKattisProblemId(input as string), null);
  });
}

// --- the fetched URL is always rebuilt, never the raw input ------------------
test('rebuilt URL never carries query, fragment, port, or credentials', () => {
  const id = parseKattisProblemId('https://user:pass@open.kattis.com/problems/hello?x=1#y');
  // The userinfo form above is rejected outright, so this must be null; the
  // proxy would 400 rather than fetch anything.
  assert.equal(id, null);

  const clean = parseKattisProblemId('https://open.kattis.com/problems/hello?x=1#y');
  assert.equal(clean, 'hello');
  assert.equal(buildCanonicalKattisProblemUrl(clean!), 'https://open.kattis.com/problems/hello');
});
