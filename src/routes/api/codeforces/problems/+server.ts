import { json } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import {
  fetchProblemsetCatalog,
  problemsetApiUrl,
  resolveFromCatalog,
  type CodeforcesProblemsetProblem,
  type ProblemRef
} from '$lib/services/codeforcesProblemset';
import { requireAdmin } from '$lib/server/authorization';
import type { RequestHandler } from './$types';

// In-memory cache of the Codeforces problemset catalog. The catalog is large
// (~11k problems) and rarely changes, so a single fetch is reused across
// requests within its TTL instead of downloading it per problem or per batch.
const CATALOG_TTL_MS = 5 * 60 * 1000;
let cachedCatalog: CodeforcesProblemsetProblem[] | null = null;
let cachedAt = 0;

async function getCatalog(): Promise<CodeforcesProblemsetProblem[]> {
  const now = Date.now();
  if (cachedCatalog && now - cachedAt < CATALOG_TTL_MS) {
    return cachedCatalog;
  }
  const catalog = await fetchProblemsetCatalog(
    fetch,
    problemsetApiUrl(publicEnv.PUBLIC_CODEFORCES_API_BASE)
  );
  cachedCatalog = catalog;
  cachedAt = now;
  return catalog;
}

/**
 * Resolve Codeforces problem metadata for a batch of problems through the
 * anonymous problemset.problems API. Admin-gated so it is not an open proxy,
 * and returns only the requested metadata.
 */
export const POST: RequestHandler = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const refs = (body as { problems?: unknown })?.problems;
  if (!Array.isArray(refs) || refs.length === 0) {
    return json({ error: 'Request must include a non-empty "problems" array' }, { status: 400 });
  }
  if (refs.length > 100) {
    return json({ error: 'Too many problems requested (max 100)' }, { status: 400 });
  }

  let catalog: CodeforcesProblemsetProblem[];
  try {
    catalog = await getCatalog();
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Failed to fetch Codeforces problemset' },
      { status: 502 }
    );
  }

  const results = resolveFromCatalog(refs as ProblemRef[], catalog);
  return json({ results });
};
