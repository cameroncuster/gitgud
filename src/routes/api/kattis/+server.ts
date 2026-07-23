import { env as publicEnv } from '$env/dynamic/public';
import { json } from '@sveltejs/kit';
import { buildCanonicalKattisProblemUrl, parseKattisProblemId } from '$lib/services/kattisUrl';
import type { RequestHandler } from './$types';

const FETCH_TIMEOUT_MS = 10_000;

function buildUpstreamUrl(problemId: string): string {
  const base = publicEnv.PUBLIC_KATTIS_BASE;
  if (!base) {
    return buildCanonicalKattisProblemUrl(problemId);
  }
  return `${base.replace(/\/$/, '')}/problems/${problemId}`;
}

/**
 * Returns Kattis problem HTML without exposing an arbitrary-URL proxy.
 *
 * The caller input is reduced to a validated problem id before either the
 * canonical Kattis origin or the optional test upstream is constructed.
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(buildUpstreamUrl(problemId), {
      signal: controller.signal,
      redirect: 'error'
    });
    if (!response.ok) {
      return json({ error: 'Failed to fetch problem' }, { status: response.status });
    }
    return json({ html: await response.text() });
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
