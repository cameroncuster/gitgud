/**
 * Pure, dependency-free helpers for importing a Codeforces user's solved
 * problems. No SvelteKit or Supabase imports so the server endpoint and unit
 * tests can share the normalization, bounding, and matching logic.
 *
 * The import only ever reads Codeforces (the public user.status API) and
 * intersects the accepted solves with problems already tracked on gitgud; it
 * never creates problems.
 */

// Codeforces host used for the public user.status API. Kept as a single
// constant so the upstream origin is fixed and never derived from user input.
export const CODEFORCES_USER_STATUS_URL = 'https://codeforces.com/api/user.status';

// A Codeforces handle is 3-24 chars of letters, digits, underscore, dot, or
// hyphen. The bound rejects overlong input before it reaches the upstream API.
const HANDLE_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;

// Upper bound on submissions scanned from a user.status response. A prolific
// account can have well over 100k submissions; scanning past this cap yields no
// additional tracked matches in practice and bounds the per-request work.
export const MAX_SUBMISSIONS = 100_000;

// Upper bound on distinct solved URLs returned/considered. Guards the response
// size and the downstream intersection regardless of upstream volume.
export const MAX_SOLVED_URLS = 20_000;

/**
 * A single Codeforces submission from the user.status API (only the fields used
 * here). Fields are optional/unknown because the payload is untrusted upstream
 * input and must be validated before use.
 */
export type CodeforcesSubmission = {
  verdict?: unknown;
  problem?: {
    contestId?: unknown;
    index?: unknown;
  };
};

/**
 * Normalize a raw handle to its trimmed form. Does not validate; pair with
 * {@link isValidHandle}.
 */
export function normalizeHandle(raw: string): string {
  return raw.trim();
}

/**
 * Whether a handle is well-formed (see {@link HANDLE_PATTERN}). Rejects empty,
 * overlong, or out-of-charset input so it never reaches the upstream API.
 */
export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

/**
 * Build the user.status URL for a handle. Defaults to the real Codeforces
 * endpoint; an optional base override (an E2E stub host) redirects the upstream
 * fetch without changing behavior when unset. The host is never derived from
 * the handle, only the query value is (encoded).
 */
export function codeforcesUserStatusUrl(handle: string, apiBase?: string): string {
  const base = apiBase ? `${apiBase.replace(/\/$/, '')}/user.status` : CODEFORCES_USER_STATUS_URL;
  return `${base}?handle=${encodeURIComponent(handle)}`;
}

/**
 * Canonical problem URL for a submission, matching the URLs produced elsewhere
 * in the app (see parseProblemUrl in codeforcesProblemset.ts). Returns null when
 * the submission cannot be mapped to a tracked-problem URL (missing/invalid
 * contestId or index). Gym submissions are intentionally excluded because gym
 * problems are not part of the trackable problemset.
 */
function submissionToProblemUrl(submission: CodeforcesSubmission): string | null {
  const problem = submission.problem;
  if (!problem || typeof problem.index !== 'string') {
    return null;
  }
  const contestId = problem.contestId;
  if (typeof contestId !== 'number' || !Number.isInteger(contestId) || contestId <= 0) {
    return null;
  }
  const index = problem.index;
  if (!/^[A-Z]\d*$/.test(index)) {
    return null;
  }
  // Gym contests (id >= 100000) are not part of the trackable problemset.
  if (contestId >= 100_000) {
    return null;
  }
  return `https://codeforces.com/contest/${contestId}/problem/${index}`;
}

/**
 * Extract the set of solved problem URLs from a Codeforces user.status result.
 * Keeps only accepted (verdict OK) submissions, de-duplicates by URL, and is
 * bounded on both the submissions scanned and the URLs returned. Pure: no
 * network or database access.
 * @param submissions - The `result` array from the Codeforces user.status API
 * @returns Sorted array of unique normalized problem URLs
 */
export function extractSolvedProblemUrls(submissions: unknown): string[] {
  if (!Array.isArray(submissions)) {
    return [];
  }

  const urls = new Set<string>();
  const scanLimit = Math.min(submissions.length, MAX_SUBMISSIONS);

  for (let i = 0; i < scanLimit; i++) {
    const submission = submissions[i] as CodeforcesSubmission;
    if (submission?.verdict !== 'OK') {
      continue;
    }
    const url = submissionToProblemUrl(submission);
    if (url) {
      urls.add(url);
      if (urls.size >= MAX_SOLVED_URLS) {
        break;
      }
    }
  }

  return Array.from(urls).sort();
}

/**
 * A problem tracked on gitgud, reduced to the fields needed to match and
 * import. Matches the shape returned by the user-solves endpoint.
 */
export type TrackedProblem = {
  id: string;
  url: string;
  name: string;
};

/**
 * Result of intersecting solved URLs with the problems tracked on gitgud.
 */
export type SolveMatchResult = {
  /** Tracked problems the user has solved (server-derived, safe to import) */
  matched: TrackedProblem[];
  /** Count of solved URLs that are not tracked on gitgud */
  unmatchedCount: number;
};

/**
 * Intersect solved problem URLs with the problems tracked on gitgud. Only
 * problems that already exist are returned; this import never creates problems.
 * Pure: no network or database access.
 * @param solvedUrls - Normalized solved problem URLs
 * @param problems - Problems currently tracked on gitgud
 */
export function matchSolvedToProblems(
  solvedUrls: string[],
  problems: TrackedProblem[]
): SolveMatchResult {
  const problemsByUrl = new Map(problems.map((problem) => [problem.url, problem]));

  const matched: TrackedProblem[] = [];
  const seen = new Set<string>();
  let unmatchedCount = 0;

  for (const url of solvedUrls) {
    const problem = problemsByUrl.get(url);
    if (problem?.id && !seen.has(problem.id)) {
      seen.add(problem.id);
      matched.push({ id: problem.id, url: problem.url, name: problem.name });
    } else if (!problem) {
      unmatchedCount++;
    }
  }

  return { matched, unmatchedCount };
}
