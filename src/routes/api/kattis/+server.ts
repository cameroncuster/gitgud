import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseKattisProblemId, buildCanonicalKattisProblemUrl } from '$lib/services/kattisUrl';

/** Upstream fetch timeout (ms) so a slow/hung Kattis response cannot pin a request. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Proxy that returns the raw HTML of a Kattis problem page so the browser can
 * parse its title/difficulty without a cross-origin request.
 *
 * Only ever fetches the one canonical `https://open.kattis.com/problems/<id>`
 * URL, rebuilt from a validated problem id — the untrusted `url` search param
 * is never passed to `fetch`. This is the SSRF / open-proxy trust boundary:
 * anything that is not a canonical Kattis problem reference is rejected with a
 * 400 before any network call.
 */
export const GET: RequestHandler = async ({ url }) => {
  const problemParam = url.searchParams.get('url');
  if (!problemParam) {
    return json({ error: 'No URL provided' }, { status: 400 });
  }

  const problemId = parseKattisProblemId(problemParam);
  if (!problemId) {
    return json({ error: 'Invalid Kattis problem URL' }, { status: 400 });
  }

  // Rebuild the URL from the validated id rather than fetching any part of the
  // caller-supplied input.
  const canonicalUrl = buildCanonicalKattisProblemUrl(problemId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(canonicalUrl, {
      signal: controller.signal,
      redirect: 'error'
    });
    if (!response.ok) {
      return json({ error: 'Failed to fetch problem' }, { status: response.status });
    }
    const html = await response.text();
    return json({ html });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return json({ error: 'Timed out fetching problem' }, { status: 504 });
    }
    console.error('Error fetching Kattis problem:', error);
    return json({ error: 'Failed to fetch problem' }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
};
