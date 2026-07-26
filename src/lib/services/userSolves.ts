/**
 * Imports tracked solves from Codeforces or user-supplied Kattis IDs. Confirm
 * always re-derives database-owned problem IDs under the current RLS session.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentActor, resolveCurrentActor } from '$lib/auth/currentActor';
import { supabase } from './database';
import type { SolveMatchResult, TrackedProblem } from './codeforcesSolves';
import {
  kattisProblemUrls,
  matchKattisSolves,
  parseKattisSolveInput,
  type KattisSolveMatchResult
} from './kattisSolves';

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

  async function fetchKattisMatches(
    input: string,
    isHtml: boolean
  ): Promise<
    { success: true; result: KattisSolveMatchResult } | { success: false; message: string }
  > {
    await resolveActor();
    if (!getActor().user) {
      return { success: false, message: 'You must be signed in to import solves' };
    }

    const parsed = parseKattisSolveInput(input, isHtml);
    if (parsed.problemIds.length === 0) {
      return { success: true, result: matchKattisSolves(parsed, []) };
    }

    try {
      const tracked: TrackedProblem[] = [];
      const urls = kattisProblemUrls(parsed.problemIds);
      for (let index = 0; index < urls.length; index += 100) {
        const { data, error } = await client
          .from('problems')
          .select('id,url,name')
          .in('url', urls.slice(index, index + 100));
        if (error) return { success: false, message: 'Failed to match tracked Kattis problems' };
        tracked.push(...((data ?? []) as TrackedProblem[]));
      }
      return { success: true, result: matchKattisSolves(parsed, tracked) };
    } catch {
      return { success: false, message: 'Failed to match tracked Kattis problems' };
    }
  }

  async function persistMatches(
    userId: string,
    matched: TrackedProblem[],
    provider: string
  ): Promise<{ success: boolean; imported: number; message?: string }> {
    if (matched.length === 0) return { success: true, imported: 0 };
    const rows = matched.map((problem) => ({ user_id: userId, problem_id: problem.id }));

    try {
      const { data, error } = await client
        .from('user_solved_problems')
        .upsert(rows, { onConflict: 'user_id,problem_id', ignoreDuplicates: true })
        .select('problem_id');
      if (error) {
        console.error(`${provider} import: upsert failed`);
        return { success: false, imported: 0, message: 'Import failed' };
      }
      return { success: true, imported: data?.length ?? 0 };
    } catch {
      console.error(`${provider} import: unexpected upsert error`);
      return { success: false, imported: 0, message: 'Import failed' };
    }
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

    return persistMatches(currentUser.id, matches.result.matched, 'Codeforces');
  }

  async function previewKattisImport(
    input: string,
    isHtml = false
  ): Promise<
    { success: true; result: KattisSolveMatchResult } | { success: false; message: string }
  > {
    return fetchKattisMatches(input, isHtml);
  }

  async function confirmKattisImport(
    input: string,
    isHtml = false
  ): Promise<{ success: boolean; imported: number; message?: string }> {
    await resolveActor();
    const currentUser = getActor().user;
    if (!currentUser) {
      return { success: false, imported: 0, message: 'You must be signed in to import solves' };
    }

    const matches = await fetchKattisMatches(input, isHtml);
    if (!matches.success) return { success: false, imported: 0, message: matches.message };
    if (getActor().user?.id !== currentUser.id) {
      return { success: false, imported: 0, message: 'Your session changed during import' };
    }
    return persistMatches(currentUser.id, matches.result.matched, 'Kattis');
  }

  return {
    previewCodeforcesImport,
    confirmCodeforcesImport,
    previewKattisImport,
    confirmKattisImport
  };
}

export const {
  previewCodeforcesImport,
  confirmCodeforcesImport,
  previewKattisImport,
  confirmKattisImport
} = createUserSolvesService({
  client: supabase,
  resolveActor: resolveCurrentActor,
  getActor: getCurrentActor,
  fetchMatchesResponse: fetch
});
