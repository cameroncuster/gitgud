// Provider adapters for the unified /submit workspace.
//
// Each adapter wires an existing provider service into the shared two-phase
// contract (see submitForm.ts): `extract` parses pasted text, `resolve` fetches
// metadata and runs the duplicate check WITHOUT writing, and `commit` inserts a
// previously-resolved entry only on the admin's final confirmation. Keeping the
// provider-specific work here leaves the workspace UI, staging, and completion
// summary fully shared.

import type { ProviderAdapter, ResolvedItem, CommitResult } from './submitForm';
import { insertProblem, type Problem } from '$lib/services/problem';
import { insertContest, type Contest } from '$lib/services/contest';
import {
  extractCodeforcesProblemInfo,
  fetchCodeforcesProblemData,
  formatCodeforcesUrl,
  extractCodeforcesUrls,
  resolveCodeforcesProblems
} from '$lib/services/codeforces';
import type { ResolvedProblem } from '$lib/services/codeforcesProblemset';
import { extractCodeforcesContestInfo, fetchCodeforcesContestData } from '$lib/services/contest';
import {
  extractKattisProblemInfo,
  fetchKattisProblemData,
  formatKattisUrl,
  extractKattisUrls
} from '$lib/services/kattis';

// --- Codeforces --------------------------------------------------------------
//
// Codeforces accepts both problem and contest URLs in one paste. Extraction
// returns problems first (in input order) then contests; `resolve` dispatches
// on which set a URL belongs to. Non-gym problems are resolved against the
// problemset catalog in a single batch memoized per extraction, so a whole
// paste costs at most one upstream catalog fetch — the same batching the old
// per-page form used, preserved here.
function createCodeforcesAdapter(): ProviderAdapter {
  let contestUrlSet = new Set<string>();
  let resolvedProblems: Map<string, { problem?: ResolvedProblem; error?: string }> | null = null;
  let batchRefs: { contestId: string; index: string }[] = [];

  function extract(text: string): string[] {
    const { problemUrls, contestUrls } = extractCodeforcesUrls(text);
    contestUrlSet = new Set(contestUrls);

    // Reset the per-paste batch resolution and precompute the non-gym refs.
    resolvedProblems = null;
    batchRefs = problemUrls
      .filter((url) => !url.includes('/gym/'))
      .map((url) => extractCodeforcesProblemInfo(url))
      .filter((info): info is NonNullable<typeof info> => info !== null)
      .map((info) => ({ contestId: info.contestId, index: info.index }));

    // De-duplicate while preserving input order (problems first, then contests).
    return [...new Set([...problemUrls, ...contestUrls])];
  }

  async function ensureResolved() {
    if (resolvedProblems) return resolvedProblems;
    resolvedProblems =
      batchRefs.length > 0
        ? await resolveCodeforcesProblems(batchRefs)
        : new Map<string, { problem?: ResolvedProblem; error?: string }>();
    return resolvedProblems;
  }

  async function resolveContest(url: string): Promise<ResolvedItem> {
    const info = extractCodeforcesContestInfo(url);
    if (!info) {
      return { valid: false, kind: 'contest', label: url, url, reason: 'Invalid contest URL' };
    }
    const result = await fetchCodeforcesContestData(info);
    if (!result.success || !result.contest) {
      return {
        valid: false,
        kind: 'contest',
        label: url,
        url,
        reason: result.message || 'Failed to fetch contest data'
      };
    }
    return {
      valid: true,
      kind: 'contest',
      label: result.contest.name || url,
      url,
      payload: result.contest
    };
  }

  async function resolveProblem(url: string, handle: string): Promise<ResolvedItem> {
    const info = extractCodeforcesProblemInfo(url);
    if (!info) {
      return { valid: false, kind: 'problem', label: url, url, reason: 'Invalid problem URL' };
    }
    const resolved = url.includes('/gym/')
      ? undefined
      : (await ensureResolved()).get(`${info.contestId}:${info.index}`);
    const result = await fetchCodeforcesProblemData(info, handle, resolved);
    if (!result.success || !result.problem) {
      return {
        valid: false,
        kind: 'problem',
        label: formatCodeforcesUrl(url),
        url,
        reason: result.message || 'Failed to fetch problem data'
      };
    }
    return {
      valid: true,
      kind: 'problem',
      label: formatCodeforcesUrl(url, result.problem.name),
      url,
      payload: result.problem
    };
  }

  return {
    id: 'codeforces',
    name: 'Codeforces',
    icon: '/images/codeforces.png',
    placeholder:
      'https://codeforces.com/contest/1234/problem/A\n' +
      'https://codeforces.com/problemset/problem/1234/A\n' +
      'https://codeforces.com/gym/104427/problem/A\n' +
      'https://codeforces.com/contest/1234',
    help: 'Paste Codeforces problem or contest URLs. Problems and contests can be mixed; separate entries with spaces or new lines.',
    extract,
    resolve: (url, handle) =>
      contestUrlSet.has(url) ? resolveContest(url) : resolveProblem(url, handle),
    commit: async (item): Promise<CommitResult> => {
      if (item.kind === 'contest') {
        const res = await insertContest(item.payload as Omit<Contest, 'id' | 'dateAdded'>);
        return { success: res.success, message: res.message };
      }
      const res = await insertProblem(item.payload as Omit<Problem, 'source'>);
      return { success: res.success, message: res.message };
    }
  };
}

// --- Kattis ------------------------------------------------------------------
//
// Kattis only ever produces problems. `resolve` fetches the problem page (via
// the SSRF-guarded /api/kattis proxy) and runs the duplicate check without
// writing; `commit` inserts the pre-fetched payload.
function createKattisAdapter(): ProviderAdapter {
  return {
    id: 'kattis',
    name: 'Kattis',
    icon: '/images/kattis.png',
    placeholder:
      'open.kattis.com/problems/hello\nopen.kattis.com/problems/twostones\ncustomscontrols',
    help: 'Paste Kattis problem URLs or bare problem IDs. Separate entries with spaces or new lines.',
    extract: extractKattisUrls,
    resolve: async (url, handle): Promise<ResolvedItem> => {
      const info = extractKattisProblemInfo(url);
      if (!info) {
        return { valid: false, kind: 'problem', label: url, url, reason: 'Invalid URL' };
      }
      const result = await fetchKattisProblemData(info, handle);
      if (!result.success || !result.problem) {
        return {
          valid: false,
          kind: 'problem',
          label: formatKattisUrl(url),
          url,
          reason: result.message || 'Failed to fetch problem data'
        };
      }
      return {
        valid: true,
        kind: 'problem',
        label: formatKattisUrl(url, result.problem.name),
        url,
        payload: result.problem
      };
    },
    commit: async (item): Promise<CommitResult> => {
      const res = await insertProblem(item.payload as Omit<Problem, 'source'>);
      return { success: res.success, message: res.message };
    }
  };
}

// Fresh adapters are created per workspace instance so the Codeforces per-paste
// batch memoization never leaks across mounts.
export function createProviderAdapters(): Record<'codeforces' | 'kattis', ProviderAdapter> {
  return {
    codeforces: createCodeforcesAdapter(),
    kattis: createKattisAdapter()
  };
}
