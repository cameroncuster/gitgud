<script lang="ts">
import ProblemSubmitForm from '$lib/components/ProblemSubmitForm.svelte';
import type { ProcessOutcome, SubmitItem } from '$lib/components/submitForm';
import { insertProblem } from '$lib/services/problem';
import {
  extractCodeforcesProblemInfo,
  fetchCodeforcesProblemData,
  formatCodeforcesUrl,
  extractCodeforcesUrls,
  resolveCodeforcesProblems
} from '$lib/services/codeforces';
import type { ResolvedProblem } from '$lib/services/codeforcesProblemset';
import {
  extractCodeforcesContestInfo,
  fetchCodeforcesContestData,
  insertContest
} from '$lib/services/contest';

// Codeforces accepts both problem and contest URLs in one submission. The
// shared form drives a flat list of URLs, so extraction returns problems first
// (in input order) then contests, and processing dispatches on which set a URL
// belongs to. `contestUrlSet` is rebuilt on each extraction so processUrl can
// classify a URL without re-parsing.
let contestUrlSet = new Set<string>();

// Non-gym problems are resolved against the Codeforces problemset catalog in a
// single batch so the catalog is fetched at most once per submission. The batch
// is resolved lazily on the first non-gym problem processed and memoized for
// the rest of the run; a new extraction resets it.
let resolvedProblems: Map<string, { problem?: ResolvedProblem; error?: string }> | null = null;
let batchRefs: { contestId: string; index: string }[] = [];

function extractUrls(text: string): string[] {
  const { problemUrls, contestUrls } = extractCodeforcesUrls(text);
  contestUrlSet = new Set(contestUrls);

  // Reset the per-run batch resolution and precompute the non-gym refs to
  // resolve on first use.
  resolvedProblems = null;
  batchRefs = problemUrls
    .filter((url) => !url.includes('/gym/'))
    .map((url) => extractCodeforcesProblemInfo(url))
    .filter((info): info is NonNullable<typeof info> => info !== null)
    .map((info) => ({ contestId: info.contestId, index: info.index }));

  return [...problemUrls, ...contestUrls];
}

async function ensureResolved(): Promise<
  Map<string, { problem?: ResolvedProblem; error?: string }>
> {
  if (resolvedProblems) {
    return resolvedProblems;
  }
  resolvedProblems =
    batchRefs.length > 0
      ? await resolveCodeforcesProblems(batchRefs)
      : new Map<string, { problem?: ResolvedProblem; error?: string }>();
  return resolvedProblems;
}

async function processContest(url: string): Promise<ProcessOutcome> {
  const contestInfo = extractCodeforcesContestInfo(url);
  if (!contestInfo) {
    return { success: false, kind: 'contest', message: 'Invalid contest URL format' };
  }

  const result = await fetchCodeforcesContestData(contestInfo);
  if (!result.success || !result.contest) {
    return {
      success: false,
      kind: 'contest',
      message: result.message || 'Failed to fetch contest data'
    };
  }

  const insertResult = await insertContest(result.contest);
  if (!insertResult.success) {
    return { success: false, kind: 'contest', message: insertResult.message };
  }

  return {
    success: true,
    kind: 'contest',
    name: result.contest.name,
    message: 'Contest added',
    details: insertResult.id ? `ID: ${insertResult.id}` : undefined
  };
}

async function processProblem(url: string, handle: string): Promise<ProcessOutcome> {
  const problemInfo = extractCodeforcesProblemInfo(url);
  if (!problemInfo) {
    return { success: false, kind: 'problem', message: 'Invalid problem URL format' };
  }

  const resolved = url.includes('/gym/')
    ? undefined
    : (await ensureResolved()).get(`${problemInfo.contestId}:${problemInfo.index}`);
  const result = await fetchCodeforcesProblemData(problemInfo, handle, resolved);
  if (!result.success || !result.problem) {
    return {
      success: false,
      kind: 'problem',
      message: result.message || 'Failed to fetch problem data'
    };
  }

  const insertResult = await insertProblem(result.problem);
  if (!insertResult.success) {
    return { success: false, kind: 'problem', message: insertResult.message };
  }

  return {
    success: true,
    kind: 'problem',
    name: result.problem.name,
    message: 'Problem added',
    details: insertResult.id ? `ID: ${insertResult.id}` : undefined
  };
}

async function processUrl(url: string, handle: string): Promise<ProcessOutcome> {
  return contestUrlSet.has(url) ? processContest(url) : processProblem(url, handle);
}

function formatItemLabel(item: SubmitItem): string {
  if (item.kind === 'contest') {
    return item.name || item.url;
  }
  return formatCodeforcesUrl(item.url, item.name);
}
</script>

<svelte:head>
  <title>Submit | Codeforces</title>
</svelte:head>

<ProblemSubmitForm
  title="Submit Codeforces Problems & Contests"
  platformName="Codeforces"
  platformIcon="/images/codeforces.png"
  handlePlaceholder="Enter your Codeforces handle (optional)"
  urlsPlaceholder="https://codeforces.com/contest/1234/problem/A&#10;https://codeforces.com/problemset/problem/1234/A&#10;https://codeforces.com/gym/104427/problem/A&#10;https://codeforces.com/contest/1234"
  urlsDescription="Enter Codeforces problem or contest URLs. You can mix problems and contests in one submission — separate entries with spaces or new lines."
  intro="Add Codeforces problems and contests to the catalog. Paste one or more URLs and submit — each is fetched, de-duplicated, and recorded."
  {extractUrls}
  {processUrl}
  {formatItemLabel}
/>
