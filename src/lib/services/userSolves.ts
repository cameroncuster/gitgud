/**
 * Client service for importing a user's solved problems from Codeforces into
 * their gitgud solved-problem list.
 *
 * The server route (/api/codeforces/user-solves) is the single source of truth
 * for the matched set: it authenticates the caller, fetches the public
 * Codeforces user.status API, and intersects the accepted solves with problems
 * already tracked on gitgud. Preview and confirm both call it, so confirm never
 * imports client-fabricated problem ids — it re-derives them server-side and
 * upserts exactly that set under the user's own session and RLS. Import never
 * creates problems.
 */
import { getCurrentActor, resolveCurrentActor } from '$lib/auth/currentActor';
import { supabase } from './database';
import type { SolveMatchResult } from './codeforcesSolves';

// Send the current session's access token so the route can authorize the caller
// and run entirely under that user (no service-role secret is ever used).
async function fetchMatches(
  handle: string
): Promise<{ success: true; result: SolveMatchResult } | { success: false; message: string }> {
  await resolveCurrentActor();
  const accessToken = getCurrentActor().session?.access_token;
  if (!accessToken) {
    return { success: false, message: 'You must be signed in to import solves' };
  }

  let response: Response;
  try {
    response = await fetch(
      `/api/codeforces/user-solves?handle=${encodeURIComponent(handle.trim())}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
  } catch {
    return { success: false, message: 'Failed to reach Codeforces import' };
  }

  let data: { matched?: unknown; unmatchedCount?: unknown; error?: unknown };
  try {
    data = await response.json();
  } catch {
    return { success: false, message: 'Unexpected response from the import service' };
  }

  if (!response.ok) {
    const message =
      typeof data.error === 'string' ? data.error : 'Failed to fetch solves from Codeforces';
    return { success: false, message };
  }

  return {
    success: true,
    result: {
      matched: Array.isArray(data.matched) ? (data.matched as SolveMatchResult['matched']) : [],
      unmatchedCount: typeof data.unmatchedCount === 'number' ? data.unmatchedCount : 0
    }
  };
}

/**
 * Preview the Codeforces solves that match problems tracked on gitgud.
 * Read-only: performs no writes.
 */
export async function previewCodeforcesImport(
  handle: string
): Promise<{ success: true; result: SolveMatchResult } | { success: false; message: string }> {
  return fetchMatches(handle);
}

/**
 * Confirm the import for a handle. Re-derives the matched set server-side (never
 * trusting the previewed client state), then idempotently upserts exactly those
 * server-derived problem ids for the current user. The upsert runs under the
 * user's session and relies on the user_solved_problems RLS (auth.uid() =
 * user_id); ignoreDuplicates makes re-running a no-op. Import never creates
 * problems.
 */
export async function confirmCodeforcesImport(handle: string): Promise<{
  success: boolean;
  imported: number;
  message?: string;
}> {
  await resolveCurrentActor();
  const currentUser = getCurrentActor().user;
  if (!currentUser) {
    return { success: false, imported: 0, message: 'You must be signed in to import solves' };
  }

  const matches = await fetchMatches(handle);
  if (!matches.success) {
    return { success: false, imported: 0, message: matches.message };
  }

  const problemIds = matches.result.matched.map((problem) => problem.id);
  if (problemIds.length === 0) {
    return { success: true, imported: 0 };
  }

  const rows = problemIds.map((problemId) => ({
    user_id: currentUser.id,
    problem_id: problemId
  }));

  try {
    const { data, error } = await supabase
      .from('user_solved_problems')
      .upsert(rows, { onConflict: 'user_id,problem_id', ignoreDuplicates: true })
      .select('problem_id');

    if (error) {
      console.error('Codeforces import: upsert failed');
      return { success: false, imported: 0, message: 'Import failed' };
    }

    // With ignoreDuplicates, only newly-inserted rows are returned.
    return { success: true, imported: data?.length ?? 0 };
  } catch {
    console.error('Codeforces import: unexpected upsert error');
    return { success: false, imported: 0, message: 'Import failed' };
  }
}
