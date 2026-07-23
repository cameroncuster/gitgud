/**
 * Service for providing Kattis programming problems data
 */
import type { Problem } from './problem';
import { checkProblemExists } from './problem';
import { parseKattisProblemId, buildCanonicalKattisProblemUrl } from './kattisUrl';

export { KATTIS_HOST, parseKattisProblemId, buildCanonicalKattisProblemUrl } from './kattisUrl';

/**
 * Extract problem information from a Kattis URL
 * @param url - Kattis problem URL
 * @returns Problem info or null if invalid URL
 */
export function extractKattisProblemInfo(url: string): {
  problemId: string;
  url: string;
} | null {
  const problemId = parseKattisProblemId(url);
  if (!problemId) {
    return null;
  }

  return {
    problemId,
    url: buildCanonicalKattisProblemUrl(problemId)
  };
}

/**
 * Maps Kattis difficulty (1-10) to Codeforces-like scale (800-3500)
 * @param difficulty - Kattis difficulty (1.0-10.0)
 * @returns Mapped Codeforces-like difficulty (800-3500)
 */
export function mapKattisDifficulty(difficulty: number): number {
  // Kattis rating is 1-10, we want to map it to 800-3500
  // 1 -> 800
  // 5 -> 2100
  // 10 -> 3500
  return Math.round(800 + ((difficulty - 1) * (3500 - 800)) / 9);
}

/**
 * Fetch problem data from Kattis
 * @param problemInfo - Problem information
 * @param submitterHandle - Handle of the person submitting the problem
 * @param estimatedDifficulty - User-provided difficulty estimate (1.0-10.0)
 * @param problemTags - User-provided tags
 * @returns Problem data
 */
export async function fetchKattisProblemData(
  problemInfo: { problemId: string; url: string },
  submitterHandle: string = 'anonymous',
  estimatedDifficulty?: number,
  problemTags: string[] = []
): Promise<{
  success: boolean;
  message?: string;
  problem?: Omit<Problem, 'source'>;
}> {
  try {
    // Check if problem already exists
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

    // In browser environment, fetch through proxy endpoint and parse HTML
    if (typeof window !== 'undefined') {
      try {
        // Fetch through our proxy endpoint
        const response = await fetch(`/api/kattis?url=${encodeURIComponent(problemInfo.url)}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch problem');
        }

        // Parse the HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(data.html, 'text/html');

        const problemName = doc.querySelector('h1')?.textContent?.trim() || problemInfo.problemId;

        // Extract difficulty from the new format
        const difficultyText = doc
          .querySelector('.difficulty_number, .difficulty')
          ?.textContent?.trim();
        const kattisRating = difficultyText ? parseFloat(difficultyText) : 5; // Default to 5 if not found
        const difficulty = mapKattisDifficulty(kattisRating);

        // Create problem object without source field
        const problem = {
          name: problemName,
          tags: problemTags,
          difficulty: difficulty,
          url: problemInfo.url,
          solved: 0,
          dateAdded: new Date().toISOString(),
          addedBy: submitterHandle,
          addedByUrl: submitterHandle
            ? `https://open.kattis.com/users/${submitterHandle}`
            : 'https://open.kattis.com',
          likes: 0,
          dislikes: 0
        };

        return {
          success: true,
          problem
        };
      } catch (err) {
        console.error('Error fetching Kattis problem HTML:', err);
        // Fall back to the default approach if HTML parsing fails
      }
    }

    // Default approach (used in non-browser environments or as fallback)
    // Map Kattis difficulty to Codeforces scale
    const mappedDifficulty =
      estimatedDifficulty !== undefined ? mapKattisDifficulty(estimatedDifficulty) : undefined;

    // Format problem name from ID (replace hyphens with spaces and capitalize)
    const formattedName = problemInfo.problemId
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const problem: Omit<Problem, 'source'> = {
      name: formattedName,
      tags: problemTags,
      url: problemInfo.url,
      solved: 0,
      dateAdded: new Date().toISOString(),
      addedBy: submitterHandle,
      addedByUrl: `https://open.kattis.com/users/${submitterHandle}`,
      likes: 0,
      dislikes: 0
    };

    // Add difficulty only if provided
    if (mappedDifficulty !== undefined) {
      problem.difficulty = mappedDifficulty;
    }

    return {
      success: true,
      problem
    };
  } catch (error) {
    console.error('Error processing Kattis problem:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to process Kattis problem data'
    };
  }
}

export function formatKattisUrl(url: string, name?: string): string {
  if (name) return name;

  // Extract problem ID from URL
  return url.replace(
    /^https?:\/\/(?:www\.)?(?:open\.)?kattis\.com\/problems\/([a-z0-9]+).*$/,
    '$1'
  );
}

export function extractKattisUrls(text: string): string[] {
  // Split by newlines or spaces to handle both formats
  const lines = text.split(/[\n\s]+/).filter((line) => line.trim());

  const validUrls: string[] = [];

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Try to extract problem info for each line
    const info = extractKattisProblemInfo(line.trim());
    if (info) {
      validUrls.push(info.url);
    }
  }

  return validUrls;
}
