import type {
  DuplicateCheckResult,
  ExtractedEntry,
  ProblemDraft,
  ResolvedItem
} from '../../submit/types.ts';

export const KATTIS_HOST = 'open.kattis.com';
const ALLOWED_HOSTS = new Set([KATTIS_HOST, 'kattis.com', 'www.kattis.com']);
const KATTIS_PROBLEM_ID = /^[a-z0-9]+$/;

export type KattisProblemInfo = { problemId: string; url: string };
export type KattisPageMetadata = { name: string; rating: number };

export type KattisIngestionDependencies = {
  checkProblem: (canonicalUrl: string) => Promise<DuplicateCheckResult>;
  fetchPage: (url: string) => Promise<string>;
  parsePage?: (html: string, problemId: string) => KattisPageMetadata;
  now?: () => string;
  logError?: (message: string, error: unknown) => void;
};

export function buildCanonicalKattisProblemUrl(problemId: string): string {
  return `https://${KATTIS_HOST}/problems/${problemId}`;
}

export function parseKattisProblemId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (KATTIS_PROBLEM_ID.test(trimmed)) return trimmed;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const isSchemeRelative = trimmed.startsWith('//');
  const candidate = hasScheme || isSchemeRelative ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  return parsed.pathname.match(/^\/problems\/([a-z0-9]+)$/)?.[1] ?? null;
}

export function parseKattisProblem(input: string): KattisProblemInfo | null {
  const problemId = parseKattisProblemId(input);
  return problemId ? { problemId, url: buildCanonicalKattisProblemUrl(problemId) } : null;
}

export function extractKattisEntries(text: string): ExtractedEntry[] {
  const seen = new Set<string>();
  const entries: ExtractedEntry[] = [];
  for (const input of text.split(/[\n\s]+/)) {
    const info = parseKattisProblem(input.trim());
    if (!info || seen.has(info.url)) continue;
    seen.add(info.url);
    entries.push({ kind: 'problem', url: info.url });
  }
  return entries;
}

export function mapKattisDifficulty(difficulty: number): number {
  return Math.round(800 + ((difficulty - 1) * (3500 - 800)) / 9);
}

export function formatKattisLabel(url: string, name?: string): string {
  if (name) return name;
  return url.replace(
    /^https?:\/\/(?:www\.)?(?:open\.)?kattis\.com\/problems\/([a-z0-9]+).*$/,
    '$1'
  );
}

export function parseKattisProblemPage(html: string, problemId: string): KattisPageMetadata {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, 'text/html');
  const name = document.querySelector('h1')?.textContent?.trim() || problemId;
  const difficultyText = document
    .querySelector('.difficulty_number, .difficulty')
    ?.textContent?.trim();
  return { name, rating: difficultyText ? parseFloat(difficultyText) : 5 };
}

function titleCaseProblemId(problemId: string): string {
  return problemId.replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function createKattisIngestion(dependencies: KattisIngestionDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const parsePage = dependencies.parsePage ?? parseKattisProblemPage;
  const logError =
    dependencies.logError ?? ((message: string, error: unknown) => console.error(message, error));

  async function resolve(
    entry: ExtractedEntry,
    handle: string = 'anonymous'
  ): Promise<ResolvedItem> {
    const info = parseKattisProblem(entry.url);
    if (!info) {
      return {
        valid: false,
        kind: 'problem',
        label: entry.url,
        url: entry.url,
        reason: 'Invalid URL'
      };
    }

    const duplicate = await dependencies.checkProblem(info.url);
    if (duplicate.error || duplicate.duplicate) {
      return {
        valid: false,
        kind: 'problem',
        label: formatKattisLabel(info.url),
        url: info.url,
        reason: duplicate.message ?? duplicate.error ?? 'Problem already exists in database'
      };
    }

    let draft: ProblemDraft;
    try {
      const metadata = parsePage(await dependencies.fetchPage(info.url), info.problemId);
      draft = {
        name: metadata.name,
        tags: [],
        difficulty: mapKattisDifficulty(metadata.rating),
        url: info.url,
        solved: 0,
        dateAdded: now(),
        addedBy: handle,
        addedByUrl: handle ? `https://open.kattis.com/users/${handle}` : 'https://open.kattis.com',
        likes: 0,
        dislikes: 0
      };
    } catch (error) {
      logError('Error fetching Kattis problem HTML:', error);
      draft = {
        name: titleCaseProblemId(info.problemId),
        tags: [],
        url: info.url,
        solved: 0,
        dateAdded: now(),
        addedBy: handle,
        addedByUrl: `https://open.kattis.com/users/${handle}`,
        likes: 0,
        dislikes: 0
      };
    }

    return {
      valid: true,
      kind: 'problem',
      label: formatKattisLabel(info.url, draft.name),
      url: info.url,
      payload: draft
    };
  }

  return { extract: extractKattisEntries, resolve };
}
