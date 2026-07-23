import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { env as publicEnv } from '$env/dynamic/public';
import {
  fetchProblemsetCatalog,
  problemsetApiUrl,
  resolveFromCatalog,
  type CodeforcesProblemsetProblem,
  type ProblemRef
} from '$lib/services/codeforcesProblemset';
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
 * Verify the request carries a valid Supabase session for an admin user.
 * Uses the caller's own access token (not a service-role secret): the token
 * validates the user and RLS lets that user read only their own role row.
 * Returns null when authorized, or an error response when not.
 */
async function requireAdmin(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  const { data: roleRow, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  if (roleError || roleRow?.role !== 'admin') {
    return json({ error: 'Admin privileges required' }, { status: 403 });
  }

  return null;
}

/**
 * Resolve Codeforces problem metadata for a batch of problems through the
 * anonymous problemset.problems API. Admin-gated so it is not an open proxy,
 * and returns only the requested metadata.
 */
export const POST: RequestHandler = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

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
