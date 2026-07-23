// Minimal, dependency-free mock of the subset of Supabase's PostgREST/RPC HTTP
// API that gitgud reads anonymously. It exists so the deterministic Playwright
// suite can assert real rendered rows/links/filters against known fixtures
// without ever touching a live Supabase project or mutating remote data.
//
// Why a real HTTP server (and not page.route)? The app fetches its list data
// server-side during SSR (src/routes/*/+page.server.ts) using @supabase/supabase-js
// inside the Node preview process, then hydrates. Browser-level request
// interception cannot see that server-side fetch, so the only faithful way to
// feed deterministic data into the rendered page is a real endpoint the preview
// server's PUBLIC_SUPABASE_URL can point at.
//
// Why one switchable server (and not one per scenario)? SvelteKit inlines
// $env/static/public (PUBLIC_SUPABASE_URL) at BUILD time, so the served build is
// permanently bound to a single Supabase URL. Rather than build three times, a
// single mock is built into the app and its response mode is switched at
// runtime via a control endpoint that each test hits before navigating.
//
// Endpoints implemented (exact shapes verified against @supabase/supabase-js):
//   GET  /rest/v1/problems?select=...  -> array of problem rows
//   GET  /rest/v1/contests?select=...  -> array of contest rows
//   POST /rest/v1/rpc/get_leaderboard  -> array of leaderboard rows
//
// Control endpoint (test-only):
//   POST /__control/scenario  body: {"scenario":"data"|"empty"|"error"}
//   GET  /__control/scenario  -> {"scenario": "..."}
//
// Scenarios:
//   data  (default) -> serves the representative fixtures
//   empty           -> serves [] for every endpoint (drives the empty-state UI)
//   error           -> replies 500 with a PostgREST-style error body (drives the
//                      backend-failure UI the data services surface)
//
// This is test-only infrastructure: it performs no writes to any real store,
// requires no credentials, and is never bundled into the app.
import http from 'node:http';
import { PROBLEMS, CONTESTS, LEADERBOARD } from './fixtures.ts';

type Scenario = 'data' | 'empty' | 'error';

// Server-wide current scenario, switched via the control endpoint.
let scenario: Scenario = (process.env.MOCK_SCENARIO as Scenario) || 'data';
const port = Number(process.env.MOCK_PORT || 54321);

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  // Control endpoint: get/set the active scenario.
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
    sendJson(res, 200, { scenario });
    return;
  }

  const data = payloadFor(url.pathname);
  await readBody(req); // drain any request body (RPC calls POST JSON)

  if (data === null) {
    // Unknown route (e.g. GoTrue /auth/v1/*): return an empty array so an
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

server.listen(port, () => {
  // Printed so a human running the server standalone can see where it bound;
  // Playwright waits on the preview URL, not this line.
  console.log(`[mock-supabase] default scenario=${scenario} listening on http://localhost:${port}`);
});
