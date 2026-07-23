/**
 * Pure, dependency-free validation of untrusted Kattis problem references.
 *
 * This module has no SvelteKit or Supabase imports so it can be shared by the
 * `/api/kattis` proxy endpoint, the client-side Kattis service, and unit
 * tests. It is the single trust boundary that keeps the proxy from being an
 * SSRF / open-proxy: only canonical `https://open.kattis.com/problems/<id>`
 * references are accepted, and the URL that is ultimately fetched is rebuilt
 * from the validated id rather than taken from caller input.
 */

/** Canonical host the proxy is ever allowed to fetch from. */
export const KATTIS_HOST = 'open.kattis.com';

/**
 * Hosts a submitter may write in a problem URL. All canonicalize to
 * {@link KATTIS_HOST}; this is an exact-match allowlist, so lookalike hosts
 * (`open.kattis.com.evil.com`, `openkattis.com`, ...) never match.
 */
const ALLOWED_HOSTS = new Set([KATTIS_HOST, 'kattis.com', 'www.kattis.com']);

/** Character class for a Kattis problem id (lowercase alphanumerics). */
const KATTIS_PROBLEM_ID = /^[a-z0-9]+$/;

/**
 * Build the one canonical HTTPS problem URL for a validated problem id.
 * The id must already have passed {@link parseKattisProblemId}.
 */
export function buildCanonicalKattisProblemUrl(problemId: string): string {
  return `https://${KATTIS_HOST}/problems/${problemId}`;
}

/**
 * Validate untrusted input and extract the Kattis problem id from it.
 *
 * Accepts either a bare problem id (`hello`) or a Kattis problem URL, and
 * returns the lowercase alphanumeric problem id. Returns null for anything
 * else. It is deliberately strict:
 *
 *   - only the `https:` scheme (no http, no scheme-relative, no other schemes)
 *   - host must be in the exact allowlist (parsed via the WHATWG URL parser,
 *     so subdomain tricks, lookalike hosts, userinfo `@` splits, IP literals
 *     and `localhost`/metadata aliases all fail the exact match)
 *   - no embedded credentials (userinfo)
 *   - no explicit port
 *   - path must be exactly `/problems/<id>` with a valid id
 *   - query string and fragment are ignored (the canonical URL has neither)
 *
 * @param input - untrusted problem id or URL
 * @returns the validated problem id, or null if the input is not a canonical
 *   Kattis problem reference
 */
export function parseKattisProblemId(input: string): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // Bare problem id (e.g. `hello`).
  if (KATTIS_PROBLEM_ID.test(trimmed)) {
    return trimmed;
  }

  // Otherwise it must resolve to a canonical HTTPS Kattis URL. Parse with the
  // WHATWG URL parser rather than a substring/regex match so that host,
  // scheme, userinfo and port are all interpreted the way the network stack
  // would, closing subdomain/lookalike/userinfo bypasses.
  //
  // A scheme-less but otherwise ordinary host form (`kattis.com/problems/x`)
  // is accepted for submitter convenience by defaulting to https, but ONLY
  // when it does not already carry a scheme. A scheme-relative input
  // (`//evil.com/...`) or any explicit scheme is parsed as-is, so http and
  // other protocols are rejected below rather than silently upgraded.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const isSchemeRelative = trimmed.startsWith('//');
  const candidate = hasScheme || isSchemeRelative ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') {
    return null;
  }
  // Exact host allowlist. `hostname` excludes any port; reject credentials and
  // an explicit port outright rather than tolerating them.
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  if (parsed.port) {
    return null;
  }

  const pathMatch = parsed.pathname.match(/^\/problems\/([a-z0-9]+)$/);
  if (!pathMatch) {
    return null;
  }

  return pathMatch[1];
}
