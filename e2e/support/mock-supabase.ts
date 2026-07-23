// Minimal, dependency-free mock of the subset of Supabase's PostgREST/GoTrue/RPC
// HTTP API that gitgud uses. It exists so the deterministic Playwright suite can
// assert real rendered rows/links/filters AND the authenticated admin
// submit-path (auth gate, admin recheck, de-dup, isolated inserts) against known
// fixtures without ever touching a live Supabase project or mutating remote
// data.
//
// Why a real HTTP server (and not page.route)? The app fetches its list data
// server-side during SSR (src/routes/*/+page.server.ts) using @supabase/supabase-js
// inside the Node preview process, then hydrates. The server-side admin recheck
// (src/routes/api/codeforces/problems/+server.ts) likewise runs in that process.
// Browser-level request interception cannot see those server-side fetches, so a
// real endpoint the preview server's PUBLIC_SUPABASE_URL points at is the only
// faithful way to feed deterministic data/auth into the rendered page and the
// server routes alike.
//
// Why one switchable server (and not one per scenario)? SvelteKit inlines
// $env/static/public (PUBLIC_SUPABASE_URL) at BUILD time, so the served build is
// permanently bound to a single Supabase URL. Rather than build many times, a
// single mock is built into the app and its response mode is switched at
// runtime via a control endpoint that each test hits before navigating.
//
// Reads endpoints (exact shapes verified against @supabase/supabase-js):
//   GET  /rest/v1/problems?select=...     -> array of problem rows
//   GET  /rest/v1/contests?select=...     -> array of contest rows
//   POST /rest/v1/rpc/get_leaderboard     -> array of leaderboard rows
//
// Auth endpoints (GoTrue subset):
//   GET  /auth/v1/user                    -> the user for the Bearer token
//   POST /auth/v1/token?grant_type=...    -> a refreshed session (deterministic)
//
// Authenticated submit-path endpoints (bounded, in-memory, isolated):
//   GET  /rest/v1/user_roles?user_id=eq.  -> the caller's role row(s)
//   GET  /rest/v1/problems?url=eq.        -> de-dup existence check
//   POST /rest/v1/problems                -> isolated insert (in-memory only)
//   GET  /rest/v1/contests?url=eq.        -> de-dup existence check
//   POST /rest/v1/contests                -> isolated insert (in-memory only)
//
// Control endpoint (test-only):
//   POST /__control/scenario  body {"scenario":"data"|"empty"|"error"}
//   POST /__control/reset     resets the in-memory insert store + provider mode
//   POST /__control/provider  body {"mode":"ok"|"fail"|"notfound", ...fixtures}
//   GET  /__control/scenario  -> {"scenario","inserted":{...},"provider":"..."}
//
// Every write lands ONLY in this process's in-memory maps and is wiped by
// /__control/reset (called per scenario), so tests never touch a real store and
// never leak state across scenarios. This is test-only infrastructure: no
// credentials, never bundled into the app.
import http from 'node:http';
import { PROBLEMS, CONTESTS, LEADERBOARD } from './fixtures.ts';
import { ADMIN_USER, MEMBER_USER } from './constants.ts';

type Scenario = 'data' | 'empty' | 'error';
type ProviderMode = 'ok' | 'fail' | 'notfound' | 'malformed' | 'ratelimited';

// Server-wide current scenario, switched via the control endpoint.
let scenario: Scenario = (process.env.MOCK_SCENARIO as Scenario) || 'data';
const port = Number(process.env.MOCK_PORT || 54321);

// --- Auth identities ---------------------------------------------------------
// Bearer token -> user, and user id -> role, seeded from the shared fixtures so
// specs and the mock agree on exactly one admin and one non-admin identity.
const USERS = [ADMIN_USER, MEMBER_USER];
const userByToken = new Map(USERS.map((u) => [u.accessToken, u]));
const roleByUserId = new Map(USERS.map((u) => [u.id, u.role]));

// --- In-memory insert store (isolated, reset per scenario) -------------------
// Only URLs written during a run live here; existence checks and inserts read
// and write these, never the read fixtures, so a submit test's writes are fully
// isolated and deterministic.
let insertedProblems: { id: string; url: string; name: string }[] = [];
let insertedContests: { id: string; url: string; name: string }[] = [];
let insertSeq = 0;

// In-memory user_solved_problems store, keyed by user_id -> set of problem_id.
// Idempotent (a repeat insert of an existing pair is a unique violation the app
// treats as already-solved) and reset per scenario so imports never leak.
let solvedByUser = new Map<string, Set<string>>();
// Total user_solved_problems write attempts (POST) seen this run, so a spec can
// assert that preview performs ZERO writes.
let solvedWriteAttempts = 0;

// --- Provider (Codeforces/Kattis) stub mode ----------------------------------
// The server-side app endpoints (/api/codeforces/problems, /api/kattis) fetch
// real upstream providers. In E2E those upstreams are redirected to this mock
// (via PUBLIC_CODEFORCES_API_BASE / PUBLIC_KATTIS_BASE), so the mock serves a
// deterministic upstream response here. `provider` selects success/failure so a
// spec can drive the provider-failure path without any flaky live call.
let provider: ProviderMode = 'ok';

function resetState(): void {
  insertedProblems = [];
  insertedContests = [];
  insertSeq = 0;
  solvedByUser = new Map();
  solvedWriteAttempts = 0;
  provider = 'ok';
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    // The Supabase JS client sends these on every request; echoing permissive
    // CORS keeps any (non-SSR) client-side call from failing on preflight.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(payload);
}

// A PostgREST-style error body. The data services read `error.message`, so a
// realistic shape keeps the failure path faithful to production.
function sendError(res: http.ServerResponse): void {
  sendJson(res, 500, {
    code: 'PGRST500',
    message: 'mock backend failure',
    details: null,
    hint: null
  });
}

// PostgREST returns a single object (not an array) when the client asks for one
// via `Accept: application/vnd.pgrst.object+json` (set by `.single()`). Honor
// that so `.insert(...).select().single()` and `.select().single()` resolve.
function wantsSingleObject(req: http.IncomingMessage): boolean {
  const accept = req.headers['accept'] || '';
  return String(accept).includes('application/vnd.pgrst.object+json');
}

function bearerToken(req: http.IncomingMessage): string {
  const auth = String(req.headers['authorization'] || '');
  return auth.replace(/^Bearer\s+/i, '').trim();
}

function payloadFor(pathname: string): unknown[] | null {
  if (pathname === '/rest/v1/problems') return PROBLEMS;
  if (pathname === '/rest/v1/contests') return CONTESTS;
  if (pathname === '/rest/v1/rpc/get_leaderboard') return LEADERBOARD;
  return null;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

// Extract the value of a PostgREST `col=eq.<value>` filter from the query string.
function eqFilter(url: URL, col: string): string | null {
  const raw = url.searchParams.get(col);
  if (!raw) return null;
  return raw.startsWith('eq.') ? raw.slice(3) : raw;
}

// --- Auth (GoTrue) -----------------------------------------------------------
// GET /auth/v1/user resolves the Bearer token to a seeded user. The server-side
// admin recheck calls supabase.auth.getUser(token); an unknown/absent token
// yields a 401 exactly as GoTrue would.
function handleAuthUser(req: http.IncomingMessage, res: http.ServerResponse): void {
  const token = bearerToken(req);
  const u = userByToken.get(token);
  if (!u) {
    sendJson(res, 401, { code: 401, msg: 'invalid claim: missing sub claim' });
    return;
  }
  sendJson(res, 200, {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    app_metadata: { provider: 'github' },
    user_metadata: {},
    created_at: '2024-01-01T00:00:00.000Z'
  });
}

// POST /auth/v1/token (refresh). The seeded sessions carry a far-future
// expiry so getSession never refreshes in practice; this exists only so an
// unexpected refresh resolves deterministically rather than erroring.
function handleAuthToken(res: http.ServerResponse, body: string): void {
  let refreshToken = '';
  try {
    refreshToken = (JSON.parse(body || '{}') as { refresh_token?: string }).refresh_token || '';
  } catch {
    // fall through with empty token
  }
  const u = USERS.find((x) => x.refreshToken === refreshToken) || ADMIN_USER;
  sendJson(res, 200, {
    access_token: u.accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: u.refreshToken,
    user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' }
  });
}

// --- user_roles read ---------------------------------------------------------
// isAdmin() (client) and the server-side recheck both read a single role row
// filtered by user_id. `.single()` expects one object; a user with no row gets
// a PostgREST "no rows" error (client isAdmin treats that as non-admin).
function handleUserRoles(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const userId = eqFilter(url, 'user_id');
  const role = userId ? roleByUserId.get(userId) : undefined;

  if (wantsSingleObject(req)) {
    if (!role) {
      sendJson(res, 406, {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: 'Results contain 0 rows'
      });
      return;
    }
    sendJson(res, 200, { role });
    return;
  }

  sendJson(res, 200, role ? [{ role }] : []);
}

// --- problems/contests existence check + insert ------------------------------
function handleExistenceCheck(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  table: 'problems' | 'contests'
): void {
  const wantUrl = eqFilter(url, 'url');
  const store = table === 'problems' ? insertedProblems : insertedContests;
  const rows = store.filter((r) => r.url === wantUrl).map((r) => ({ id: r.id }));
  // `.select('id').eq('url', ...)` is a list read (no `.single()`).
  sendJson(res, 200, rows);
}

async function handleInsert(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  table: 'problems' | 'contests',
  body: string
): Promise<void> {
  let record: { url?: string; name?: string };
  try {
    const parsed = JSON.parse(body || '{}');
    record = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    sendJson(res, 400, { code: 'PGRST102', message: 'invalid insert body' });
    return;
  }

  const store = table === 'problems' ? insertedProblems : insertedContests;
  const url = record.url || '';

  // Isolated de-dup: a duplicate URL within the run is a unique-violation, the
  // exact shape the app maps to "already exists".
  if (store.some((r) => r.url === url)) {
    sendJson(res, 409, {
      code: '23505',
      message: `duplicate key value violates unique constraint "${table}_url_key"`,
      details: `Key (url)=(${url}) already exists.`
    });
    return;
  }

  const row = { id: `${table}-${++insertSeq}`, url, name: record.name || '' };
  store.push(row);

  // `.insert(...).select('id').single()` -> a single object with the new id.
  if (wantsSingleObject(req)) {
    sendJson(res, 201, { id: row.id });
    return;
  }
  sendJson(res, 201, [{ id: row.id }]);
}

// --- Provider (upstream) stubs -----------------------------------------------
// These answer the app's server-side provider fetches when redirected here.
// Codeforces problemset (problemset.problems) resolves the two fixture problems;
// Kattis returns a minimal problem-page HTML. `provider` mode drives failure.
function handleCodeforcesProblemset(res: http.ServerResponse): void {
  if (provider === 'fail') {
    sendJson(res, 503, { status: 'FAILED', comment: 'mock codeforces upstream failure' });
    return;
  }
  const problems =
    provider === 'notfound'
      ? []
      : [
          { contestId: 1234, index: 'A', name: 'Mock CF Problem A', tags: ['math'], rating: 1200 },
          { contestId: 1234, index: 'B', name: 'Mock CF Problem B', tags: ['dp'], rating: 1700 }
        ];
  sendJson(res, 200, { status: 'OK', result: { problems } });
}

// Codeforces user.status upstream (redirected here via PUBLIC_CODEFORCES_API_BASE).
// Drives the solved-problem import: `ok` returns accepted solves that intersect
// the two fixture problems plus an untracked one; the other modes exercise the
// not-found, provider-failure, rate-limited, and malformed paths.
function handleCodeforcesUserStatus(res: http.ServerResponse): void {
  if (provider === 'fail') {
    sendJson(res, 503, { status: 'FAILED', comment: 'mock codeforces upstream failure' });
    return;
  }
  if (provider === 'ratelimited') {
    sendJson(res, 429, { status: 'FAILED', comment: 'Call limit exceeded' });
    return;
  }
  if (provider === 'notfound') {
    sendJson(res, 400, { status: 'FAILED', comment: 'handle: User with handle ghost not found' });
    return;
  }
  if (provider === 'malformed') {
    // Valid HTTP 200 but a body the route cannot parse as JSON.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('<html>not json</html>');
    return;
  }
  // ok: accepted solves for the two tracked fixture problems (contest 1000 A/B)
  // plus an accepted solve for an untracked problem and a rejected solve that
  // must be ignored.
  const result = [
    { verdict: 'OK', problem: { contestId: 1000, index: 'A' } },
    { verdict: 'OK', problem: { contestId: 1000, index: 'A' } },
    { verdict: 'OK', problem: { contestId: 1000, index: 'B' } },
    { verdict: 'OK', problem: { contestId: 9999, index: 'Z' } },
    { verdict: 'WRONG_ANSWER', problem: { contestId: 1000, index: 'C' } }
  ];
  sendJson(res, 200, { status: 'OK', result });
}

// --- user_solved_problems (read + idempotent user-scoped insert) -------------
// GET returns the caller's solved problem_ids; POST records them idempotently in
// the isolated store. The caller is resolved from the Bearer token so writes are
// scoped to the current user exactly as RLS (auth.uid() = user_id) would.
function handleSolvedRead(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const userId = eqFilter(url, 'user_id');
  const set = userId ? solvedByUser.get(userId) : undefined;
  const rows = set ? Array.from(set).map((problem_id) => ({ problem_id })) : [];
  sendJson(res, 200, rows);
}

async function handleSolvedInsert(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string
): Promise<void> {
  solvedWriteAttempts++;
  const caller = userByToken.get(bearerToken(req));
  if (!caller) {
    sendJson(res, 401, { code: 401, msg: 'invalid claim: missing sub claim' });
    return;
  }

  let records: { user_id?: string; problem_id?: string }[];
  try {
    const parsed = JSON.parse(body || '[]');
    records = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    sendJson(res, 400, { code: 'PGRST102', message: 'invalid insert body' });
    return;
  }

  const set = solvedByUser.get(caller.id) ?? new Set<string>();
  const inserted: { problem_id: string }[] = [];
  for (const record of records) {
    // Emulate RLS: a row may only be written for the caller's own user_id.
    if (record.user_id && record.user_id !== caller.id) {
      sendJson(res, 403, { code: '42501', message: 'row-level security violation' });
      return;
    }
    const problemId = record.problem_id || '';
    if (!problemId) continue;
    // ignoreDuplicates: an already-solved pair is not returned as newly inserted.
    if (!set.has(problemId)) {
      set.add(problemId);
      inserted.push({ problem_id: problemId });
    }
  }
  solvedByUser.set(caller.id, set);

  // upsert(...).select('problem_id') returns only the newly-inserted rows when
  // ignoreDuplicates is set.
  sendJson(res, 201, inserted);
}

function handleKattisPage(res: http.ServerResponse): void {
  if (provider === 'fail') {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('mock kattis upstream failure');
    return;
  }
  const html =
    '<html><body><h1>Mock Kattis Problem</h1>' +
    '<span class="difficulty_number">4.2</span></body></html>';
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  // Control endpoints ---------------------------------------------------------
  if (url.pathname === '/__control/scenario') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      try {
        const next = JSON.parse(body || '{}').scenario as Scenario;
        if (next === 'data' || next === 'empty' || next === 'error') {
          scenario = next;
        }
      } catch {
        // Ignore malformed control payloads; keep the current scenario.
      }
    }
    sendJson(res, 200, {
      scenario,
      provider,
      inserted: { problems: insertedProblems.length, contests: insertedContests.length },
      solvedWriteAttempts
    });
    return;
  }

  if (url.pathname === '/__control/reset') {
    await readBody(req);
    resetState();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/__control/provider') {
    const body = await readBody(req);
    try {
      const next = (JSON.parse(body || '{}') as { mode?: ProviderMode }).mode;
      if (
        next === 'ok' ||
        next === 'fail' ||
        next === 'notfound' ||
        next === 'malformed' ||
        next === 'ratelimited'
      ) {
        provider = next;
      }
    } catch {
      // Ignore malformed payloads; keep current provider mode.
    }
    sendJson(res, 200, { provider });
    return;
  }

  // Auth (GoTrue) -------------------------------------------------------------
  if (url.pathname === '/auth/v1/user') {
    await readBody(req);
    handleAuthUser(req, res);
    return;
  }
  if (url.pathname === '/auth/v1/token') {
    const body = await readBody(req);
    handleAuthToken(res, body);
    return;
  }

  // Provider (upstream) stubs -------------------------------------------------
  if (url.pathname === '/api/problemset.problems') {
    await readBody(req);
    handleCodeforcesProblemset(res);
    return;
  }
  if (url.pathname === '/api/user.status') {
    await readBody(req);
    handleCodeforcesUserStatus(res);
    return;
  }

  // user_solved_problems: read (GET) and idempotent user-scoped insert (POST).
  if (url.pathname === '/rest/v1/user_solved_problems') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      await handleSolvedInsert(req, res, body);
      return;
    }
    await readBody(req);
    if (scenario === 'error') {
      sendError(res);
      return;
    }
    handleSolvedRead(req, res, url);
    return;
  }
  if (url.pathname.startsWith('/problems/')) {
    // Kattis problem page (open.kattis.com/problems/<id>) redirected here.
    await readBody(req);
    handleKattisPage(res);
    return;
  }

  // user_roles (auth/admin gate) ---------------------------------------------
  if (url.pathname === '/rest/v1/user_roles') {
    await readBody(req);
    if (scenario === 'error') {
      sendError(res);
      return;
    }
    handleUserRoles(req, res, url);
    return;
  }

  // problems / contests: existence check (GET with url=eq.) and insert (POST).
  if (url.pathname === '/rest/v1/problems' || url.pathname === '/rest/v1/contests') {
    const table = url.pathname.endsWith('problems') ? 'problems' : 'contests';

    if (req.method === 'POST') {
      const body = await readBody(req);
      await handleInsert(req, res, table, body);
      return;
    }

    // A GET carrying a url=eq. filter is the app's de-dup existence check,
    // which must read the isolated insert store (not the display fixtures).
    if (url.searchParams.has('url')) {
      await readBody(req);
      if (scenario === 'error') {
        sendError(res);
        return;
      }
      handleExistenceCheck(req, res, url, table);
      return;
    }
  }

  // Plain list reads (display fixtures) --------------------------------------
  const data = payloadFor(url.pathname);
  await readBody(req); // drain any request body (RPC calls POST JSON)

  if (data === null) {
    // Unknown route (e.g. other GoTrue endpoints): return an empty array so an
    // unexpected read never wedges the page.
    sendJson(res, 200, []);
    return;
  }

  if (scenario === 'error') {
    sendError(res);
    return;
  }
  sendJson(res, 200, scenario === 'empty' ? [] : data);
});

// Bind on all interfaces so both 127.0.0.1 (control/SSR) and the
// gitgud-e2e.localhost host (browser) reach the same process.
server.listen(port, '0.0.0.0', () => {
  // Printed so a human running the server standalone can see where it bound;
  // Playwright waits on the preview URL, not this line.
  console.log(`[mock-supabase] default scenario=${scenario} listening on http://0.0.0.0:${port}`);
});
