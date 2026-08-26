import type {
  DuplicateCheckResult,
  ExtractedEntry,
  ProblemDraft,
  ResolvedItem
} from '../../submit/types.ts';

export const DMOJ_HOST = 'dmoj.ca';
const ALLOWED_HOSTS = new Set([DMOJ_HOST, 'www.dmoj.ca']);

export type DmojProblemInfo = { problemCode: string; url: string };
export type DmojProblemMetadata = { name: string; types: string[] };

export type DmojIngestionDependencies = {
  checkProblem: (canonicalUrl: string) => Promise<DuplicateCheckResult>;
  fetchProblem: (url: string) => Promise<unknown>;
  parseProblem?: (payload: unknown, problemCode: string) => DmojProblemMetadata;
  now?: () => string;
  logError?: (message: string, error: unknown) => void;
};

export function buildCanonicalDmojProblemUrl(problemCode: string): string {
  return `https://${DMOJ_HOST}/problem/${problemCode}`;
}

/**
 * Reduce input to a DMOJ problem code. Unlike Kattis this rejects bare codes:
 * DMOJ codes are opaque short strings, so accepting them unqualified would let
 * any stray word classify as a DMOJ problem.
 */
export function parseDmojProblemCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

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
  return parsed.pathname.match(/^\/problem\/([a-z0-9_]+)$/)?.[1] ?? null;
}

export function parseDmojProblem(input: string): DmojProblemInfo | null {
  const problemCode = parseDmojProblemCode(input);
  return problemCode ? { problemCode, url: buildCanonicalDmojProblemUrl(problemCode) } : null;
}

export function extractDmojEntries(text: string): ExtractedEntry[] {
  const seen = new Set<string>();
  const entries: ExtractedEntry[] = [];
  for (const input of text.split(/[\n\s]+/)) {
    const info = parseDmojProblem(input.trim());
    if (!info || seen.has(info.url)) continue;
    seen.add(info.url);
    entries.push({ kind: 'problem', url: info.url });
  }
  return entries;
}

export function formatDmojLabel(url: string, name?: string): string {
  if (name) return name;
  return url.replace(/^https?:\/\/(?:www\.)?dmoj\.ca\/problem\/([a-z0-9_]+).*$/, '$1');
}

/** Read the name and problem types out of a DMOJ API v2 single-problem payload. */
export function parseDmojProblemPayload(
  payload: unknown,
  problemCode: string
): DmojProblemMetadata {
  const object = (payload as { data?: { object?: Record<string, unknown> } })?.data?.object;
  const name = typeof object?.name === 'string' ? object.name.trim() : '';
  const types = Array.isArray(object?.types)
    ? object.types.filter((type): type is string => typeof type === 'string')
    : [];
  return { name: name || problemCode, types };
}

export function createDmojIngestion(dependencies: DmojIngestionDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const parseProblem = dependencies.parseProblem ?? parseDmojProblemPayload;
  const logError =
    dependencies.logError ?? ((message: string, error: unknown) => console.error(message, error));

  async function resolve(
    entry: ExtractedEntry,
    handle: string = 'anonymous'
  ): Promise<ResolvedItem> {
    const info = parseDmojProblem(entry.url);
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
        label: formatDmojLabel(info.url),
        url: info.url,
        reason: duplicate.message ?? duplicate.error ?? 'Problem already exists in database'
      };
    }

    // DMOJ scores problems in points, which are not comparable to the stored
    // Codeforces-style rating range, so difficulty is deliberately left unset.
    let metadata: DmojProblemMetadata;
    try {
      metadata = parseProblem(await dependencies.fetchProblem(info.url), info.problemCode);
    } catch (error) {
      logError('Error fetching DMOJ problem metadata:', error);
      metadata = { name: info.problemCode, types: [] };
    }

    const draft: ProblemDraft = {
      name: metadata.name,
      tags: metadata.types,
      url: info.url,
      solved: 0,
      dateAdded: now(),
      addedBy: handle,
      addedByUrl: handle ? `https://${DMOJ_HOST}/user/${handle}` : `https://${DMOJ_HOST}`,
      likes: 0,
      dislikes: 0
    };

    return {
      valid: true,
      kind: 'problem',
      label: formatDmojLabel(info.url, draft.name),
      url: info.url,
      payload: draft
    };
  }

  return { extract: extractDmojEntries, resolve };
}
