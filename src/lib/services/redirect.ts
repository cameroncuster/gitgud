/**
 * Post-login redirect sanitization.
 *
 * The GitHub OAuth callback lands with an optional `next` query parameter that
 * says where to send the user afterwards. That value is attacker-controllable
 * (it rides in the URL), so it must never be trusted as a raw redirect target:
 * a protocol-relative value like `//evil.com` or an absolute `https://evil.com`
 * would otherwise navigate the user off-site (an open redirect).
 *
 * `sanitizeRedirect` collapses any untrusted `next` down to a safe, same-origin
 * relative path. It is pure and dependency-free so it can be shared by the
 * client callback page and exercised directly by unit tests.
 */

/** The path used whenever `next` is missing, malformed, or off-origin. */
export const DEFAULT_REDIRECT = '/';

/**
 * Return a safe same-origin path to redirect to after login.
 *
 * Accepts only a single-slash-rooted relative path (e.g. `/settings`) and
 * returns {@link DEFAULT_REDIRECT} for anything else, including:
 *   - absolute URLs (`https://evil.com`, `http:evil`)
 *   - protocol-relative URLs (`//evil.com`, and `/\evil.com` after backslash
 *     normalization, which browsers treat as protocol-relative)
 *   - values not starting with `/`
 *   - `null` / `undefined` / empty
 */
export function sanitizeRedirect(next: string | null | undefined): string {
  if (!next) return DEFAULT_REDIRECT;

  // Browsers treat backslashes in the authority position like forward slashes,
  // so `/\evil.com` and `\\evil.com` are protocol-relative in practice.
  // Normalize them before validating so those variants can't slip through.
  const normalized = next.replace(/\\/g, '/');

  // Must be rooted at a single slash and must not be protocol-relative (`//`).
  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return DEFAULT_REDIRECT;
  }

  return normalized;
}
