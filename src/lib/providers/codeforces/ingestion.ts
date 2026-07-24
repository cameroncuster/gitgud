import type { ResolvedProblem } from '../../services/codeforcesProblemset.ts';
import type {
  ContestDraft,
  DuplicateCheckResult,
  ExtractedEntry,
  ProblemDraft,
  ResolvedItem
} from '../../submit/types.ts';

export type CodeforcesProblemInfo = {
  contestId: string;
  index: string;
  problemId: string;
  url: string;
};

export type CodeforcesContestInfo = {
  contestId: string;
  isGym: boolean;
  url: string;
};

export type ProblemResolution = { problem?: ResolvedProblem; error?: string };
export type ProblemBatchResolver = (
  refs: { contestId: string; index: string }[]
) => Promise<Map<string, ProblemResolution>>;

type JsonFetcher = (url: string) => Promise<unknown>;

export type CodeforcesIngestionDependencies = {
  checkProblem: (
    canonicalUrl: string,
    alternateUrls?: readonly string[]
  ) => Promise<DuplicateCheckResult>;
  checkContest: (url: string) => Promise<DuplicateCheckResult>;
  resolveProblemBatch: ProblemBatchResolver;
  fetchJson?: JsonFetcher;
  now?: () => string;
};

type CodeforcesApiProblem = {
  index: string;
  name: string;
  tags?: string[];
  rating?: number;
};

type CodeforcesContest = {
  id: number;
  name: string;
  durationSeconds: number;
  difficulty?: number;
  kind?: string;
};

type CodeforcesApiResponse = {
  status?: string;
  result?: unknown;
};

export function parseCodeforcesProblemUrl(problemUrl: string): CodeforcesProblemInfo | null {
  const cleanUrl = problemUrl.trim().replace(/^(https?:\/\/)?(www\.)?/, '');
  const contestMatch = cleanUrl.match(
    /(?:mirror\.)?codeforces\.com\/contest\/(\d+)\/problem\/([A-Z\d]+)/
  );
  const problemsetMatch = cleanUrl.match(
    /(?:mirror\.)?codeforces\.com\/problemset\/problem\/(\d+)\/([A-Z\d]+)/
  );
  const gymMatch = cleanUrl.match(/(?:mirror\.)?codeforces\.com\/gym\/(\d+)\/problem\/([A-Z\d]+)/);
  const match = contestMatch || problemsetMatch || gymMatch;
  if (!match) return null;

  const isGym = Boolean(gymMatch);
  return {
    contestId: match[1],
    index: match[2],
    problemId: `${isGym ? 'G' : ''}${match[1]}${match[2]}`,
    url: isGym
      ? `https://codeforces.com/gym/${match[1]}/problem/${match[2]}`
      : `https://codeforces.com/contest/${match[1]}/problem/${match[2]}`
  };
}

export function parseCodeforcesContestUrl(contestUrl: string): CodeforcesContestInfo | null {
  const cleanUrl = contestUrl.trim().replace(/^(https?:\/\/)?(www\.)?/, '');
  const contestMatch = cleanUrl.match(
    /(?:mirror\.)?codeforces\.com\/contest\/(\d+)(?!\/problem\/)/
  );
  const gymMatch = cleanUrl.match(/(?:mirror\.)?codeforces\.com\/gym\/(\d+)(?!\/problem\/)/);

  if (contestMatch) {
    return {
      contestId: contestMatch[1],
      isGym: false,
      url: `https://codeforces.com/contest/${contestMatch[1]}`
    };
  }
  if (gymMatch) {
    return {
      contestId: gymMatch[1],
      isGym: true,
      url: `https://codeforces.com/gym/${gymMatch[1]}`
    };
  }
  return null;
}

export function extractCodeforcesEntries(text: string): ExtractedEntry[] {
  const problems: ExtractedEntry[] = [];
  const contests: ExtractedEntry[] = [];

  for (const value of text.split(/\s+/)) {
    const input = value.trim();
    if (!input || input.startsWith('#')) continue;
    const problem = parseCodeforcesProblemUrl(input);
    if (problem) {
      problems.push({ kind: 'problem', url: problem.url });
      continue;
    }
    const contest = parseCodeforcesContestUrl(input);
    if (contest) contests.push({ kind: 'contest', url: contest.url });
  }

  const seen = new Set<string>();
  return [...problems, ...contests].filter((entry) => {
    const key = `${entry.kind}:${entry.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatCodeforcesLabel(url: string, name?: string): string {
  const shortUrl = url.includes('/gym/')
    ? url.replace(
        /^https?:\/\/(?:www\.)?codeforces\.com\/gym\/(\d+)\/(?:problem\/)?([A-Z\d]+).*$/,
        'GYM $1$2'
      )
    : url.replace(
        /^https?:\/\/(?:www\.)?codeforces\.com\/(?:contest|problemset\/problem)\/(\d+)\/(?:problem\/)?([A-Z\d]+).*$/,
        'CF $1$2'
      );
  return name ? `${shortUrl} - ${name}` : shortUrl;
}

export function codeforcesProblemAliases(info: CodeforcesProblemInfo): string[] {
  if (info.url.includes('/gym/')) return [];
  return [`https://codeforces.com/problemset/problem/${info.contestId}/${info.index}`];
}

function submitter(handle: string, fallback: string = 'tourist') {
  return {
    addedBy: handle || fallback,
    addedByUrl: handle
      ? `https://codeforces.com/profile/${handle}`
      : `https://codeforces.com/profile/${fallback}`
  };
}

function problemDraft(input: {
  info: CodeforcesProblemInfo;
  handle: string;
  now: string;
  name: string;
  tags: string[];
  difficulty?: number;
  includeDifficulty: boolean;
}): ProblemDraft {
  const draft: ProblemDraft = {
    name: input.name,
    tags: input.tags,
    url: input.info.url,
    solved: 0,
    dateAdded: input.now,
    ...submitter(input.handle),
    likes: 0,
    dislikes: 0
  };
  if (input.includeDifficulty) draft.difficulty = input.difficulty;
  return draft;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  return response.json();
}

export function createCodeforcesIngestion(dependencies: CodeforcesIngestionDependencies) {
  const fetchJson = dependencies.fetchJson ?? defaultFetchJson;
  const now = dependencies.now ?? (() => new Date().toISOString());
  type BatchContext = {
    entries: ExtractedEntry[];
    problemBatch: Promise<Map<string, ProblemResolution>> | null;
  };
  let context: BatchContext = { entries: [], problemBatch: null };

  function extract(text: string): ExtractedEntry[] {
    context = { entries: extractCodeforcesEntries(text), problemBatch: null };
    return context.entries;
  }

  function ensureProblemBatch(batch: BatchContext) {
    if (!batch.problemBatch) {
      const refs = batch.entries
        .filter((entry) => entry.kind === 'problem' && !entry.url.includes('/gym/'))
        .map((entry) => parseCodeforcesProblemUrl(entry.url))
        .filter((info): info is CodeforcesProblemInfo => info !== null)
        .map(({ contestId, index }) => ({ contestId, index }));
      batch.problemBatch =
        refs.length > 0 ? dependencies.resolveProblemBatch(refs) : Promise.resolve(new Map());
    }
    return batch.problemBatch;
  }

  async function resolveProblem(
    entry: ExtractedEntry,
    handle: string,
    batch: BatchContext
  ): Promise<ResolvedItem> {
    const info = parseCodeforcesProblemUrl(entry.url);
    if (!info) {
      return {
        valid: false,
        kind: 'problem',
        label: entry.url,
        url: entry.url,
        reason: 'Invalid problem URL'
      };
    }

    const duplicate = await dependencies.checkProblem(info.url, codeforcesProblemAliases(info));
    if (duplicate.error || duplicate.duplicate) {
      return {
        valid: false,
        kind: 'problem',
        label: formatCodeforcesLabel(info.url),
        url: info.url,
        reason: duplicate.message ?? duplicate.error ?? 'Problem already exists in database'
      };
    }

    if (info.url.includes('/gym/')) {
      try {
        const data = (await fetchJson(
          `https://codeforces.com/api/contest.standings?contestId=${info.contestId}&from=1&count=1&gym=true`
        )) as CodeforcesApiResponse;
        if (data.status !== 'OK') {
          throw new Error('Failed to fetch problem data from Codeforces API');
        }
        const result = data.result as { problems: CodeforcesApiProblem[] };
        const problem = result.problems.find((candidate) => candidate.index === info.index);
        const draft = problemDraft({
          info,
          handle,
          now: now(),
          name: problem?.name ?? `Problem ${info.index} from Gym Contest ${info.contestId}`,
          tags: problem ? problem.tags || [] : ['gym'],
          difficulty: problem?.rating,
          includeDifficulty: Boolean(problem)
        });
        return {
          valid: true,
          kind: 'problem',
          label: formatCodeforcesLabel(info.url, draft.name),
          url: info.url,
          payload: draft
        };
      } catch (error) {
        console.error('Error fetching problem data:', error);
        return {
          valid: false,
          kind: 'problem',
          label: formatCodeforcesLabel(info.url),
          url: info.url,
          reason: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    let resolution: ProblemResolution | undefined;
    try {
      resolution = (await ensureProblemBatch(batch)).get(`${info.contestId}:${info.index}`);
    } catch (error) {
      console.error('Error fetching problem data:', error);
      return {
        valid: false,
        kind: 'problem',
        label: formatCodeforcesLabel(info.url),
        url: info.url,
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
    if (!resolution || resolution.error || !resolution.problem) {
      return {
        valid: false,
        kind: 'problem',
        label: formatCodeforcesLabel(info.url),
        url: info.url,
        reason: resolution?.error || 'Problem not found in Codeforces problemset'
      };
    }

    const draft = problemDraft({
      info,
      handle,
      now: now(),
      name: resolution.problem.name,
      tags: resolution.problem.tags || [],
      difficulty: resolution.problem.rating,
      includeDifficulty: true
    });
    return {
      valid: true,
      kind: 'problem',
      label: formatCodeforcesLabel(info.url, draft.name),
      url: info.url,
      payload: draft
    };
  }

  async function resolveContest(entry: ExtractedEntry): Promise<ResolvedItem> {
    const info = parseCodeforcesContestUrl(entry.url);
    if (!info) {
      return {
        valid: false,
        kind: 'contest',
        label: entry.url,
        url: entry.url,
        reason: 'Invalid contest URL'
      };
    }

    const duplicate = await dependencies.checkContest(info.url);
    if (duplicate.error || duplicate.duplicate) {
      return {
        valid: false,
        kind: 'contest',
        label: info.url,
        url: info.url,
        reason: duplicate.message ?? duplicate.error ?? 'Contest already exists in database'
      };
    }

    try {
      const data = (await fetchJson(
        info.isGym
          ? `https://codeforces.com/api/contest.standings?contestId=${info.contestId}&from=1&count=1&gym=true`
          : 'https://codeforces.com/api/contest.list?gym=false'
      )) as CodeforcesApiResponse;
      if (data.status !== 'OK') throw new Error('Failed to fetch contest data from Codeforces API');

      const contest = info.isGym
        ? ((data.result as { contest?: CodeforcesContest }).contest ?? null)
        : ((data.result as CodeforcesContest[]).find(
            (candidate) => candidate.id.toString() === info.contestId
          ) ?? null);
      if (!contest) throw new Error('Contest not found in Codeforces API response');

      const draft: ContestDraft = {
        name: contest.name,
        url: info.url,
        durationSeconds: contest.durationSeconds,
        difficulty: contest.difficulty,
        ...submitter(''),
        likes: 0,
        dislikes: 0,
        type:
          info.isGym || contest.name.includes('ICPC') || contest.kind?.includes('ICPC')
            ? 'ICPC'
            : 'Codeforces'
      };
      return {
        valid: true,
        kind: 'contest',
        label: draft.name || info.url,
        url: info.url,
        payload: draft
      };
    } catch (error) {
      console.error('Error fetching contest data:', error);
      return {
        valid: false,
        kind: 'contest',
        label: info.url,
        url: info.url,
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  return {
    extract,
    resolve: (entry: ExtractedEntry, handle: string) => {
      const batch = context;
      return entry.kind === 'contest'
        ? resolveContest(entry)
        : resolveProblem(entry, handle, batch);
    }
  };
}
