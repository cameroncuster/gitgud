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
 * Resolve the problemset API URL. Defaults to the real Codeforces endpoint; an
 * optional base override (e.g. an E2E stub host) redirects the upstream fetch
 * without changing any behavior when unset.
 */
export function problemsetApiUrl(apiBase?: string): string {
  if (!apiBase) return PROBLEMSET_API_URL;
  return `${apiBase.replace(/\/$/, '')}/problemset.problems`;
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
  fetchFn: FetchLike = fetch,
  apiUrl: string = PROBLEMSET_API_URL
): Promise<CodeforcesProblemsetProblem[]> {
  let response;
  try {
    response = await fetchFn(apiUrl);
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

interface CachedCatalog {
  problems: CodeforcesProblemsetProblem[];
  cachedAt: number;
}

export type CatalogLoader = () => Promise<CodeforcesProblemsetProblem[]>;

export interface CatalogCache {
  get(load: CatalogLoader): Promise<CodeforcesProblemsetProblem[]>;
}

/**
 * TTL cache for the problemset catalog. The loader is supplied per get() call
 * so each refresh runs through the current caller's fetch rather than one
 * captured at construction. Concurrent misses share one in-flight load rather
 * than each triggering their own (avoiding a stampede against the ~11k problem
 * upstream), and a rejected load is not cached so a transient failure does not
 * persist for the whole TTL. The clock is injectable for tests.
 */
export function createCatalogCache(ttlMs: number, now: () => number = Date.now): CatalogCache {
  let cached: CachedCatalog | null = null;
  let inflight: Promise<CodeforcesProblemsetProblem[]> | null = null;

  return {
    get(load: CatalogLoader): Promise<CodeforcesProblemsetProblem[]> {
      if (cached && now() - cached.cachedAt < ttlMs) {
        return Promise.resolve(cached.problems);
      }
      if (inflight) {
        return inflight;
      }
      inflight = load()
        .then((problems) => {
          cached = { problems, cachedAt: now() };
          return problems;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    }
  };
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
      return {
        contestId: typeof ref?.contestId === 'string' ? ref.contestId : '',
        index: typeof ref?.index === 'string' ? ref.index : '',
        error: invalid
      };
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
