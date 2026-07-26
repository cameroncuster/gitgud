import { json } from '@sveltejs/kit';
import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions
} from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
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
import type { Database } from '$lib/types/database';
import type { RequestHandler } from './$types';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

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

type UserSolvesGetDependencies = {
  authorize: typeof requireUser;
  createAnonClient: (
    supabaseUrl: string,
    supabaseKey: string,
    options?: SupabaseClientOptions<'public'>
  ) => SupabaseClient<Database>;
};

export function _createUserSolvesGet({
  authorize,
  createAnonClient
}: UserSolvesGetDependencies): RequestHandler {
  return async ({ url, request, fetch }) => {
    const auth = await authorize(request);
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
      response = await fetch(
        codeforcesUserStatusUrl(handle, publicEnv.PUBLIC_CODEFORCES_API_BASE),
        {
          signal: controller.signal,
          redirect: 'error',
          headers: { accept: 'application/json' }
        }
      );
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

    let problems: unknown;
    try {
      const anon = createAnonClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const query = await anon.from('problems').select('id, url, name');
      if (query.error) throw query.error;
      problems = query.data;
    } catch {
      console.error('Codeforces user-solves: failed to read tracked problems');
      return json({ error: 'Failed to match against tracked problems' }, { status: 500 });
    }

    const result = matchSolvedToProblems(solvedUrls, (problems as TrackedProblem[]) ?? []);
    return json(result);
  };
}

export const GET = _createUserSolvesGet({
  authorize: requireUser,
  createAnonClient: (supabaseUrl, supabaseKey, options) =>
    createClient<Database>(supabaseUrl, supabaseKey, options)
});
