/**
 * Pure, dependency-free helpers for resolving Codeforces problem metadata
 * through the anonymous problemset.problems API.
 *
 * Codeforces disabled contest.standings for non-admin users on non-gym
 * contests ("Non-gym contest standings for non-admin users are available only
 * via anonymous GET requests with no extra parameters"), so problem metadata is
 * resolved from the problemset catalog instead. This module has no SvelteKit or
 * Supabase imports so it can be shared by the server endpoint and unit tests.
 */

// Shape of a problem entry in the Codeforces problemset.problems response.
export interface CodeforcesProblemsetProblem {
  contestId: number;
  index: string;
  name: string;
  tags: string[];
  rating?: number;
}

// Metadata we return to callers for a single resolved problem.
export interface ResolvedProblem {
  contestId: string;
  index: string;
  name: string;
  tags: string[];
  rating?: number;
}

// A requested problem, identified by contest id and index.
export interface ProblemRef {
  contestId: string;
  index: string;
}

export const PROBLEMSET_API_URL = 'https://codeforces.com/api/problemset.problems';

/**
 * Extract problem information from a Codeforces URL. Pure (regex-only) so it can
 * be shared by the client service and unit tests.
 * @param problemUrl - Codeforces problem URL
 * @returns Problem info or null if the URL is not a recognized problem URL
 */
export function parseProblemUrl(problemUrl: string): {
  contestId: string;
  index: string;
  problemId: string;
  url: string;
} | null {
  // Normalize the URL: strip http/https/www.
  const cleanUrl = problemUrl.trim().replace(/^(https?:\/\/)?(www\.)?/, '');

  // Support both codeforces.com and mirror.codeforces.com
  const contestPattern = /(?:mirror\.)?codeforces\.com\/contest\/(\d+)\/problem\/([A-Z\d]+)/;
  const problemsetPattern = /(?:mirror\.)?codeforces\.com\/problemset\/problem\/(\d+)\/([A-Z\d]+)/;
  const gymPattern = /(?:mirror\.)?codeforces\.com\/gym\/(\d+)\/problem\/([A-Z\d]+)/;

  const contestMatch = cleanUrl.match(contestPattern);
  const problemsetMatch = cleanUrl.match(problemsetPattern);
  const gymMatch = cleanUrl.match(gymPattern);

  const match = contestMatch || problemsetMatch || gymMatch;
  if (!match) {
    return null;
  }

  const isGym = !!gymMatch;

  // Always normalize to the appropriate codeforces.com URL for consistency.
  const normalizedFinalUrl = isGym
    ? `https://codeforces.com/gym/${match[1]}/problem/${match[2]}`
    : `https://codeforces.com/contest/${match[1]}/problem/${match[2]}`;

  return {
    contestId: match[1],
    index: match[2],
    // Prefix gym problems with 'G' to distinguish them.
    problemId: `${isGym ? 'G' : ''}${match[1]}${match[2]}`,
    url: normalizedFinalUrl
  };
}

// A contestId is a positive integer; an index is a letter optionally followed
// by digits (e.g. "A", "F", "B2"). Kept strict so malformed input is rejected
// before hitting the upstream API.
const CONTEST_ID_PATTERN = /^\d+$/;
const INDEX_PATTERN = /^[A-Z]\d*$/;

/**
 * Validate a single problem reference. Returns an error string when invalid,
 * or null when the reference is well-formed.
 */
export function validateProblemRef(ref: ProblemRef): string | null {
  if (!ref || typeof ref.contestId !== 'string' || typeof ref.index !== 'string') {
    return 'Missing contestId or index';
  }
  if (!CONTEST_ID_PATTERN.test(ref.contestId)) {
    return `Invalid contestId: ${ref.contestId}`;
  }
  if (!INDEX_PATTERN.test(ref.index)) {
    return `Invalid problem index: ${ref.index}`;
  }
  return null;
}

// Minimal fetch signature so callers/tests can inject a mock.
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

interface ProblemsetResponse {
  status: string;
  comment?: string;
  result?: { problems?: CodeforcesProblemsetProblem[] };
}

/**
 * Fetch the full Codeforces problemset catalog once and return its problems.
 * Throws an Error with an actionable message on any upstream failure so the
 * caller can surface it to the user.
 */
export async function fetchProblemsetCatalog(
  fetchFn: FetchLike
): Promise<CodeforcesProblemsetProblem[]> {
  let response;
  try {
    response = await fetchFn(PROBLEMSET_API_URL);
  } catch (err) {
    throw new Error(
      `Could not reach Codeforces (${err instanceof Error ? err.message : 'network error'})`,
      { cause: err }
    );
  }

  if (!response.ok) {
    throw new Error(`Codeforces API returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as ProblemsetResponse;

  if (data.status !== 'OK') {
    throw new Error(
      `Codeforces API error: ${data.comment || 'problemset.problems did not return OK'}`
    );
  }

  const problems = data.result?.problems;
  if (!Array.isArray(problems)) {
    throw new Error('Codeforces API returned an unexpected problemset payload');
  }

  return problems;
}

/**
 * Resolve requested problems against an already-fetched catalog. Each requested
 * ref maps to either resolved metadata or an error, preserving input order.
 */
export function resolveFromCatalog(
  refs: ProblemRef[],
  catalog: CodeforcesProblemsetProblem[]
): { contestId: string; index: string; problem?: ResolvedProblem; error?: string }[] {
  // Index the catalog once by "contestId:index" for O(1) lookups per ref.
  const byKey = new Map<string, CodeforcesProblemsetProblem>();
  for (const p of catalog) {
    byKey.set(`${p.contestId}:${p.index}`, p);
  }

  return refs.map((ref) => {
    const invalid = validateProblemRef(ref);
    if (invalid) {
      return { contestId: ref.contestId, index: ref.index, error: invalid };
    }

    const match = byKey.get(`${ref.contestId}:${ref.index}`);
    if (!match) {
      return {
        contestId: ref.contestId,
        index: ref.index,
        error: 'Problem not found in Codeforces problemset'
      };
    }

    return {
      contestId: ref.contestId,
      index: ref.index,
      problem: {
        contestId: ref.contestId,
        index: ref.index,
        name: match.name,
        tags: match.tags || [],
        rating: match.rating
      }
    };
  });
}
