/**
 * Service for providing programming problems data from Codeforces
 */
import type { Problem } from './problem';
import { checkProblemExists } from './problem';
import { extractCodeforcesContestInfo } from './contest';
import { supabase } from './database';
import { parseProblemUrl, type ResolvedProblem } from './codeforcesProblemset';

// Type for Codeforces API problem response
interface CodeforcesProblem {
  contestId: number;
  index: string;
  name: string;
  tags: string[];
  rating?: number;
}

/**
 * Resolve non-gym Codeforces problem metadata in a single batch through the
 * admin-gated /api/codeforces/problems endpoint. The endpoint downloads the
 * problemset catalog once (and caches it) instead of fetching per problem, so
 * a whole submission costs at most one upstream catalog fetch.
 * @param refs - Problems to resolve, identified by contestId and index
 * @returns Per-ref result keyed by `contestId:index`
 */
export async function resolveCodeforcesProblems(
  refs: { contestId: string; index: string }[]
): Promise<Map<string, { problem?: ResolvedProblem; error?: string }>> {
  const resultMap = new Map<string, { problem?: ResolvedProblem; error?: string }>();
  if (refs.length === 0) {
    return resultMap;
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    for (const ref of refs) {
      resultMap.set(`${ref.contestId}:${ref.index}`, { error: 'Authentication required' });
    }
    return resultMap;
  }

  const response = await fetch('/api/codeforces/problems', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ problems: refs })
  });

  if (!response.ok) {
    let message = `Failed to resolve problems (HTTP ${response.status})`;
    try {
      const errBody = await response.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      // keep the default message
    }
    for (const ref of refs) {
      resultMap.set(`${ref.contestId}:${ref.index}`, { error: message });
    }
    return resultMap;
  }

  const data = (await response.json()) as {
    results: { contestId: string; index: string; problem?: ResolvedProblem; error?: string }[];
  };
  for (const r of data.results) {
    resultMap.set(`${r.contestId}:${r.index}`, { problem: r.problem, error: r.error });
  }
  return resultMap;
}

/**
 * Extract problem information from a Codeforces URL
 * @param problemUrl - Codeforces problem URL
 * @returns Problem info or null if invalid URL
 */
export const extractCodeforcesProblemInfo = parseProblemUrl;

/**
 * Fetch problem data for a Codeforces problem.
 *
 * Non-gym problems are resolved through the admin-gated problemset endpoint;
 * pass pre-resolved metadata (from {@link resolveCodeforcesProblems}) to reuse
 * a single batch fetch, otherwise this resolves the problem on its own. Gym
 * problems continue to use the gym standings API, which is unaffected by the
 * Codeforces restriction on non-gym contest standings.
 * @param problemInfo - Problem information
 * @param submitterHandle - Handle of the person submitting the problem
 * @param resolved - Optional pre-resolved metadata for this problem
 * @returns Problem data
 */
export async function fetchCodeforcesProblemData(
  problemInfo: {
    contestId: string;
    index: string;
    problemId: string;
    url: string;
  },
  submitterHandle: string = 'tourist',
  resolved?: { problem?: ResolvedProblem; error?: string }
): Promise<{
  success: boolean;
  message?: string;
  problem?: Omit<Problem, 'source'>;
}> {
  try {
    // Check if problem already exists in our database by URL
    const { exists, error } = await checkProblemExists(problemInfo.url);

    if (error) {
      return {
        success: false,
        message: error
      };
    }

    if (exists) {
      return {
        success: false,
        message: 'Problem already exists in database'
      };
    }

    // Determine if this is a gym problem
    const isGym = problemInfo.url.includes('/gym/');

    // Also check the problemset URL variant (only for regular contests, not gym)
    if (!isGym) {
      const problemsetUrl = `https://codeforces.com/problemset/problem/${problemInfo.contestId}/${problemInfo.index}`;
      if (problemInfo.url !== problemsetUrl) {
        const { exists: existsAlt } = await checkProblemExists(problemsetUrl);
        if (existsAlt) {
          return {
            success: false,
            message: 'Problem already exists in database (with alternate URL)'
          };
        }
      }
    }

    // Gym problems still use the gym standings API, which remains available;
    // only non-gym contest standings were restricted by Codeforces.
    if (isGym) {
      const apiUrl = `https://codeforces.com/api/contest.standings?contestId=${problemInfo.contestId}&from=1&count=1&gym=true`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data.status !== 'OK') {
        throw new Error('Failed to fetch problem data from Codeforces API');
      }

      const problem = data.result.problems.find(
        (p: CodeforcesProblem) => p.index === problemInfo.index
      );

      if (!problem) {
        // The gym standings API may not return problem details; fall back to a
        // minimal problem object with default values.
        return {
          success: true,
          problem: {
            name: `Problem ${problemInfo.index} from Gym Contest ${problemInfo.contestId}`,
            tags: ['gym'],
            // No difficulty for gym problems
            url: problemInfo.url,
            solved: 0,
            dateAdded: new Date().toISOString(),
            addedBy: submitterHandle || 'tourist',
            addedByUrl: submitterHandle
              ? `https://codeforces.com/profile/${submitterHandle}`
              : 'https://codeforces.com/profile/tourist',
            likes: 0,
            dislikes: 0
          }
        };
      }

      return {
        success: true,
        problem: {
          name: problem.name,
          tags: problem.tags || [],
          difficulty: problem.rating,
          url: problemInfo.url,
          solved: 0,
          dateAdded: new Date().toISOString(),
          addedBy: submitterHandle || 'tourist',
          addedByUrl: submitterHandle
            ? `https://codeforces.com/profile/${submitterHandle}`
            : 'https://codeforces.com/profile/tourist',
          likes: 0,
          dislikes: 0
        }
      };
    }

    // Non-gym problems are resolved through the problemset endpoint. Reuse
    // pre-resolved metadata when provided (batch path); otherwise resolve this
    // single problem on its own.
    const resolution =
      resolved ??
      (await resolveCodeforcesProblems([
        { contestId: problemInfo.contestId, index: problemInfo.index }
      ]).then((m) => m.get(`${problemInfo.contestId}:${problemInfo.index}`)));

    if (!resolution || resolution.error || !resolution.problem) {
      return {
        success: false,
        message: resolution?.error || 'Problem not found in Codeforces problemset'
      };
    }

    return {
      success: true,
      problem: {
        name: resolution.problem.name,
        tags: resolution.problem.tags || [],
        difficulty: resolution.problem.rating, // Keep as undefined if no rating
        url: problemInfo.url,
        solved: 0,
        dateAdded: new Date().toISOString(),
        addedBy: submitterHandle || 'tourist',
        addedByUrl: submitterHandle
          ? `https://codeforces.com/profile/${submitterHandle}`
          : 'https://codeforces.com/profile/tourist',
        likes: 0,
        dislikes: 0
      }
    };
  } catch (err) {
    console.error('Error fetching problem data:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

export function formatCodeforcesUrl(url: string, name?: string): string {
  // Handle gym URLs
  if (url.includes('/gym/')) {
    const shortUrl = url.replace(
      /^https?:\/\/(?:www\.)?codeforces\.com\/gym\/(\d+)\/(?:problem\/)?([A-Z\d]+).*$/,
      'GYM $1$2'
    );
    return name ? `${shortUrl} - ${name}` : shortUrl;
  }

  // Handle regular contest URLs
  const shortUrl = url.replace(
    /^https?:\/\/(?:www\.)?codeforces\.com\/(?:contest|problemset\/problem)\/(\d+)\/(?:problem\/)?([A-Z\d]+).*$/,
    'CF $1$2'
  );

  return name ? `${shortUrl} - ${name}` : shortUrl;
}

/**
 * Extract Codeforces URLs from text
 * @param text - Text containing URLs
 * @returns Object with problem and contest URLs
 */
export function extractCodeforcesUrls(text: string): {
  problemUrls: string[];
  contestUrls: string[];
} {
  // Split by any whitespace (spaces, newlines, tabs) to handle multiple URLs
  const lines = text.split(/\s+/).filter((line) => line.trim());

  const problemUrls: string[] = [];
  const contestUrls: string[] = [];

  for (const line of lines) {
    // Skip empty lines or comment lines
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Try to extract problem info for each line
    const problemInfo = extractCodeforcesProblemInfo(line.trim());
    if (problemInfo) {
      problemUrls.push(problemInfo.url);
      continue;
    }

    // If not a problem, try to extract contest info
    const contestInfo = extractCodeforcesContestInfo(line.trim());
    if (contestInfo) {
      contestUrls.push(contestInfo.url);
    }
  }

  return { problemUrls, contestUrls };
}

/**
 * Extract all URLs from text (for backward compatibility)
 * @param text - Text containing URLs
 * @returns Array of all URLs (problems and contests)
 */
export function extractAllCodeforcesUrls(text: string): string[] {
  const { problemUrls, contestUrls } = extractCodeforcesUrls(text);
  return [...problemUrls, ...contestUrls];
}
