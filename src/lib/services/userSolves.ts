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
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentActor, resolveCurrentActor } from '$lib/auth/currentActor';
import { supabase } from './database';
import type { SolveMatchResult } from './codeforcesSolves';

// Send the current session's access token so the route can authorize the caller
// and run entirely under that user (no service-role secret is ever used).
type UserSolvesDependencies = {
  client: SupabaseClient;
  resolveActor: typeof resolveCurrentActor;
  getActor: typeof getCurrentActor;
  fetchMatchesResponse: typeof fetch;
};

export function createUserSolvesService({
  client,
  resolveActor,
  getActor,
  fetchMatchesResponse
}: UserSolvesDependencies) {
  async function fetchMatches(
    handle: string
  ): Promise<{ success: true; result: SolveMatchResult } | { success: false; message: string }> {
    await resolveActor();
    const accessToken = getActor().session?.access_token;
    if (!accessToken) {
      return { success: false, message: 'You must be signed in to import solves' };
    }

    let response: Response;
    try {
      response = await fetchMatchesResponse(
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

  /** Preview the tracked Codeforces solves without writing. */
  async function previewCodeforcesImport(
    handle: string
  ): Promise<{ success: true; result: SolveMatchResult } | { success: false; message: string }> {
    return fetchMatches(handle);
  }

  /** Confirm by re-deriving and idempotently upserting server-owned IDs. */
  async function confirmCodeforcesImport(handle: string): Promise<{
    success: boolean;
    imported: number;
    message?: string;
  }> {
    await resolveActor();
    const currentUser = getActor().user;
    if (!currentUser) {
      return { success: false, imported: 0, message: 'You must be signed in to import solves' };
    }

    const matches = await fetchMatches(handle);
    if (!matches.success) {
      return { success: false, imported: 0, message: matches.message };
    }
    if (getActor().user?.id !== currentUser.id) {
      return { success: false, imported: 0, message: 'Your session changed during import' };
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
      const { data, error } = await client
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

  return { previewCodeforcesImport, confirmCodeforcesImport };
}

export const { previewCodeforcesImport, confirmCodeforcesImport } = createUserSolvesService({
  client: supabase,
  resolveActor: resolveCurrentActor,
  getActor: getCurrentActor,
  fetchMatchesResponse: fetch
});
