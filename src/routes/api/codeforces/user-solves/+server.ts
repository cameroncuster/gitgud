import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { env as publicEnv } from '$env/dynamic/public';
import {
  codeforcesUserStatusUrl,
  extractSolvedProblemUrls,
  isValidHandle,
  matchSolvedToProblems,
  normalizeHandle,
  type TrackedProblem
} from '$lib/services/codeforcesSolves';
import { requireUser } from '$lib/server/authorization';
import type { RequestHandler } from './$types';

// Bound the upstream fetch so a slow or hostile Codeforces cannot pin a server
// worker open indefinitely.
const FETCH_TIMEOUT_MS = 15_000;

// Cap the raw upstream body so an oversized response cannot exhaust memory. A
// prolific account's user.status is a few MB of JSON; this leaves generous
// headroom while refusing pathological payloads.
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

/**
 * Read the raw body of an upstream response with a hard byte cap so an oversized
 * payload is refused rather than buffered in full. Returns null when the cap is
 * exceeded.
 */
async function readBounded(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    return await response.text();
  }
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/**
 * Resolve a Codeforces handle's accepted solves and intersect them with the
 * problems tracked on gitgud. Authenticated (any app user), read-only, and
 * server-derived: the returned matched set is the single source of truth the
 * confirm step imports, so the client never supplies problem ids to write.
 * Import never creates problems.
 */
export const GET: RequestHandler = async ({ url, request, fetch }) => {
  const auth = await requireUser(request);
  if (!auth.authorized) return auth.response;

  const handle = normalizeHandle(url.searchParams.get('handle') || '');
  if (!handle) {
    return json({ error: 'No handle provided' }, { status: 400 });
  }
  if (!isValidHandle(handle)) {
    return json({ error: 'Invalid Codeforces handle' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(codeforcesUserStatusUrl(handle, publicEnv.PUBLIC_CODEFORCES_API_BASE), {
      signal: controller.signal,
      redirect: 'error',
      headers: { accept: 'application/json' }
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      return json({ error: 'Timed out fetching solves from Codeforces' }, { status: 504 });
    }
    console.error('Codeforces user-solves: upstream fetch failed');
    return json({ error: 'Failed to fetch solves from Codeforces' }, { status: 502 });
  }

  let body: string | null;
  try {
    body = await readBounded(response);
  } catch {
    return json({ error: 'Failed to read Codeforces response' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  if (body === null) {
    return json({ error: 'Codeforces response too large' }, { status: 502 });
  }

  let data: { status?: string; comment?: string; result?: unknown };
  try {
    data = JSON.parse(body);
  } catch {
    return json({ error: 'Unexpected response from Codeforces' }, { status: 502 });
  }

  if (data.status !== 'OK') {
    if (typeof data.comment === 'string' && /not found/i.test(data.comment)) {
      return json({ error: `Handle "${handle}" not found on Codeforces` }, { status: 404 });
    }
    if (
      response.status === 429 ||
      (typeof data.comment === 'string' && /limit/i.test(data.comment))
    ) {
      return json({ error: 'Codeforces rate limit reached; try again shortly' }, { status: 429 });
    }
    return json({ error: 'Failed to fetch solves from Codeforces' }, { status: 502 });
  }

  const solvedUrls = extractSolvedProblemUrls(data.result);

  // Intersect against tracked problems server-side. Public read under the anon
  // key; only id/url/name are selected, and the client never supplies these.
  const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: problems, error: problemsError } = await anon
    .from('problems')
    .select('id, url, name');
  if (problemsError) {
    console.error('Codeforces user-solves: failed to read tracked problems');
    return json({ error: 'Failed to match against tracked problems' }, { status: 500 });
  }

  const result = matchSolvedToProblems(solvedUrls, (problems as TrackedProblem[]) ?? []);
  return json(result);
};
