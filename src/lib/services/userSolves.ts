/**
 * Service for importing a user's solved problems from external platforms
 * into their gitgud solved-problem list.
 */
import { supabase } from './database';
import { user } from './auth';
import { get } from 'svelte/store';
import type { Problem } from './problem';

/**
 * A single Codeforces submission from the user.status API (only the fields used here)
 */
type CodeforcesSubmission = {
  verdict?: string;
  problem: {
    contestId?: number;
    index: string;
  };
};

/**
 * Normalize a Codeforces submission to the canonical problem URL used across
 * the app, matching the URLs produced by the Codeforces submit flow.
 * Returns null when the submission cannot be mapped to a URL (e.g. no contestId).
 */
function codeforcesSubmissionUrl(submission: CodeforcesSubmission): string | null {
  const { contestId, index } = submission.problem;
  if (contestId === undefined || !index) {
    return null;
  }
  // Gym contests use ids >= 100000 and a distinct URL shape
  const isGym = contestId >= 100000;
  return isGym
    ? `https://codeforces.com/gym/${contestId}/problem/${index}`
    : `https://codeforces.com/contest/${contestId}/problem/${index}`;
}

/**
 * Extract the set of solved problem URLs from a Codeforces user.status result.
 * Keeps only accepted (verdict OK) submissions and de-duplicates by URL.
 * Pure function: no network or database access.
 * @param submissions - The `result` array from the Codeforces user.status API
 * @returns Sorted array of unique normalized problem URLs
 */
export function extractCodeforcesSolvedUrls(submissions: CodeforcesSubmission[]): string[] {
  const urls = new Set<string>();

  for (const submission of submissions) {
    if (submission.verdict !== 'OK') {
      continue;
    }
    const url = codeforcesSubmissionUrl(submission);
    if (url) {
      urls.add(url);
    }
  }

  return Array.from(urls).sort();
}

/**
 * Result of matching imported solved URLs against the problems in our database.
 */
export type SolveMatchResult = {
  /** Problems present in our database that the user has solved */
  matched: { id: string; url: string; name: string }[];
  /** Count of solved URLs that are not tracked in our database */
  unmatchedCount: number;
};

/**
 * Match a set of solved problem URLs against the problems tracked in our
 * database. Only problems that already exist are returned; this import never
 * creates problems (that remains admin-only).
 * Pure function: no network or database access.
 * @param solvedUrls - Normalized solved problem URLs from an external platform
 * @param problems - The problems currently tracked in our database
 */
export function matchSolvedToProblems(solvedUrls: string[], problems: Problem[]): SolveMatchResult {
  const problemsByUrl = new Map(problems.map((problem) => [problem.url, problem]));

  const matched: { id: string; url: string; name: string }[] = [];
  let unmatchedCount = 0;

  for (const url of solvedUrls) {
    const problem = problemsByUrl.get(url);
    if (problem?.id) {
      matched.push({ id: problem.id, url: problem.url, name: problem.name });
    } else {
      unmatchedCount++;
    }
  }

  return { matched, unmatchedCount };
}

/**
 * Fetch a Codeforces user's solved problem URLs via our server endpoint.
 * @param handle - Codeforces handle
 * @returns Object with solved URLs, or an error message
 */
export async function fetchCodeforcesSolves(handle: string): Promise<{
  success: boolean;
  solvedUrls?: string[];
  message?: string;
}> {
  try {
    const response = await fetch(
      `/api/codeforces/user-solves?handle=${encodeURIComponent(handle.trim())}`
    );
    const data = await response.json();

    if (!response.ok) {
      return { success: false, message: data.error || 'Failed to fetch solves from Codeforces' };
    }

    return { success: true, solvedUrls: data.solvedUrls as string[] };
  } catch (err) {
    console.error('Error fetching Codeforces solves:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Failed to fetch solves from Codeforces'
    };
  }
}

/**
 * Idempotently mark a set of problems as solved for the current user.
 * Uses an upsert that ignores duplicates, so re-running an import is a no-op
 * for already-solved problems. Relies on the caller being authenticated and on
 * the user_solved_problems RLS policy (auth.uid() = user_id).
 * @param problemIds - Problem ids to mark solved
 * @returns Object with a success flag, the number newly imported, and any message
 */
export async function importSolvedProblems(problemIds: string[]): Promise<{
  success: boolean;
  imported: number;
  message?: string;
}> {
  const currentUser = get(user);

  if (!currentUser) {
    return { success: false, imported: 0, message: 'You must be signed in to import solves' };
  }

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
      console.error('Error importing solved problems:', error);
      return { success: false, imported: 0, message: `Import failed: ${error.message}` };
    }

    // With ignoreDuplicates, only newly-inserted rows are returned
    return { success: true, imported: data?.length ?? 0 };
  } catch (err) {
    console.error('Failed to import solved problems:', err);
    return {
      success: false,
      imported: 0,
      message: err instanceof Error ? err.message : 'Failed to import solved problems'
    };
  }
}
