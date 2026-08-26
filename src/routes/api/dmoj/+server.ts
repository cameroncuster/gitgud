import { env as publicEnv } from '$env/dynamic/public';
import { json } from '@sveltejs/kit';
import { DMOJ_HOST, parseDmojProblemCode } from '$lib/providers/dmoj/ingestion';
import type { RequestHandler } from './$types';

const FETCH_TIMEOUT_MS = 10_000;

export function _buildUpstreamUrl(
  problemCode: string,
  base: string | undefined = publicEnv.PUBLIC_DMOJ_API_BASE
): string {
  if (!base) {
    return `https://${DMOJ_HOST}/api/v2/problem/${problemCode}`;
  }
  return `${base.replace(/\/$/, '')}/problem/${problemCode}`;
}

/**
 * Returns DMOJ problem metadata without exposing an arbitrary-URL proxy.
 *
 * The caller input is reduced to a validated problem code before either the
 * canonical DMOJ API origin or the optional test upstream is constructed. The
 * public problem pages sit behind bot protection, so the API is the only
 * reliable metadata source.
 */
export function _createDmojGet(fetchProblem: typeof fetch): RequestHandler {
  return async ({ url }) => {
    const problemParam = url.searchParams.get('url');
    if (!problemParam) {
      return json({ error: 'No URL provided' }, { status: 400 });
    }

    const problemCode = parseDmojProblemCode(problemParam);
    if (!problemCode) {
      return json({ error: 'Invalid DMOJ problem URL' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const request = (async () => {
      try {
        const response = await fetchProblem(_buildUpstreamUrl(problemCode), {
          signal: controller.signal,
          redirect: 'error'
        });
        if (!response.ok) {
          return json({ error: 'Failed to fetch problem' }, { status: response.status });
        }
        return json({ problem: await response.json() });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return json({ error: 'Timed out fetching problem' }, { status: 504 });
        }
        console.error('Error fetching DMOJ problem:', error);
        return json({ error: 'Failed to fetch problem' }, { status: 500 });
      }
    })();

    return request.finally(() => clearTimeout(timeout));
  };
}

export const GET = _createDmojGet(fetch);
