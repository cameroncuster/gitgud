import {
  buildCanonicalKattisProblemUrl,
  parseKattisProblemId
} from '$lib/providers/kattis/ingestion';
import type { TrackedProblem } from './codeforcesSolves';

export const MAX_KATTIS_INPUT_SIZE = 1_000_000;
export const MAX_KATTIS_FILE_SIZE = 2_000_000;
export const MAX_KATTIS_SOLVES = 5_000;

export type KattisSolveParseResult = {
  problemIds: string[];
  duplicateCount: number;
  capped: boolean;
};

export type KattisSolveMatchResult = {
  matched: TrackedProblem[];
  unmatchedCount: number;
  duplicateCount: number;
  capped: boolean;
};

function addProblemId(
  problemId: string | null,
  seen: Set<string>,
  result: KattisSolveParseResult
): void {
  if (!problemId) return;
  if (seen.has(problemId)) {
    result.duplicateCount++;
    return;
  }
  if (result.problemIds.length >= MAX_KATTIS_SOLVES) {
    result.capped = true;
    return;
  }
  seen.add(problemId);
  result.problemIds.push(problemId);
}

function extractHtmlProblemIds(
  input: string,
  seen: Set<string>,
  result: KattisSolveParseResult
): void {
  const withoutLinks = input.replace(
    /\b(?:href|data-href)\s*=\s*["']([^"']+)["']/gi,
    (_attribute, rawValue: string) => {
      const value = rawValue.trim();
      const relativeId = value.match(/^\/problems\/([a-z0-9]+)(?:[?#/]|$)/i)?.[1];
      addProblemId(relativeId?.toLowerCase() ?? parseKattisProblemId(value), seen, result);
      return '';
    }
  );

  const absoluteUrls = withoutLinks.matchAll(
    /https:\/\/(?:open\.|www\.)?kattis\.com\/problems\/[a-z0-9]+(?:[?#][^\s"'<]*)?/gi
  );
  for (const match of absoluteUrls) addProblemId(parseKattisProblemId(match[0]), seen, result);
}

export function parseKattisSolveInput(input: string, isHtml = false): KattisSolveParseResult {
  const bounded = input.slice(0, MAX_KATTIS_INPUT_SIZE);
  const result: KattisSolveParseResult = {
    problemIds: [],
    duplicateCount: 0,
    capped: input.length > MAX_KATTIS_INPUT_SIZE
  };
  const seen = new Set<string>();

  if (isHtml) {
    extractHtmlProblemIds(bounded, seen, result);
    return result;
  }

  for (const rawToken of bounded.split(/[\s,;]+/)) {
    const token = rawToken.replace(/^[('[\]]+|[)'\]".!?]+$/g, '');
    addProblemId(parseKattisProblemId(token), seen, result);
  }
  return result;
}

export function matchKattisSolves(
  parsed: KattisSolveParseResult,
  problems: TrackedProblem[]
): KattisSolveMatchResult {
  const trackedById = new Map<string, TrackedProblem>();
  for (const problem of problems) {
    const problemId = parseKattisProblemId(problem.url);
    if (problemId && problem.id) trackedById.set(problemId, problem);
  }

  const matched: TrackedProblem[] = [];
  let unmatchedCount = 0;
  for (const problemId of parsed.problemIds) {
    const problem = trackedById.get(problemId);
    if (problem) matched.push(problem);
    else unmatchedCount++;
  }

  return {
    matched,
    unmatchedCount,
    duplicateCount: parsed.duplicateCount,
    capped: parsed.capped
  };
}

export function kattisProblemUrls(problemIds: string[]): string[] {
  return problemIds.slice(0, MAX_KATTIS_SOLVES).map(buildCanonicalKattisProblemUrl);
}
