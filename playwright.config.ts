import { defineConfig, devices } from '@playwright/test';
import { MOCK_PORT, MOCK_URL } from './e2e/support/constants.ts';

// Two-layer Playwright setup.
//
// Layer A — deterministic mocked suite (default, always runs). A single
// production build is served by `vite preview` with PUBLIC_SUPABASE_URL baked to
// a local mock Supabase server (e2e/support/mock-supabase.ts). SvelteKit inlines
// $env/static/public at build time, so the URL is fixed at build; the mock's
// response mode (data / empty / error) is instead switched at runtime through a
// control endpoint each test hits before navigating (see e2e/support/scenario.ts).
// Because the app fetches list data server-side during SSR, this mock — not
// browser interception — is what feeds deterministic rows into the rendered page.
//
// Layer B — live read-only smoke (opt-in). When SUPABASE_SMOKE=1 and real
// PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY are provided (via CI secrets),
// a second build+preview is pointed at the real project and the `live-*`
// projects assert that actual anonymous data loads. It performs only anonymous
// reads — never a login, form submission, or write. When the env is absent the
// smoke projects skip with a clear contract (see e2e/live-smoke.spec.ts) and the
// live server is not started.

const MOCK_PREVIEW_PORT = 4173;
const LIVE_PREVIEW_PORT = 4176;
const MOCK_BASE = `http://localhost:${MOCK_PREVIEW_PORT}`;
const LIVE_BASE = `http://localhost:${LIVE_PREVIEW_PORT}`;

// Layer B is enabled only when explicitly requested AND real credentials are
// present (and are not the mock URL). Missing either keeps the live server down;
// the smoke spec then skips with an explicit message rather than passing.
const LIVE_SMOKE =
  process.env.SUPABASE_SMOKE === '1' &&
  !!process.env.PUBLIC_SUPABASE_URL &&
  !!process.env.PUBLIC_SUPABASE_ANON_KEY &&
  process.env.PUBLIC_SUPABASE_URL !== MOCK_URL;

// The mocked and live layers each run their own `vite build` into SvelteKit's
// shared output dir, so they must never build concurrently. They are therefore
// run as separate invocations: the mocked layer by default, and the live layer
// only when E2E_LIVE_ONLY=1 (set by the dedicated CI step). When live-only, the
// mocked servers/projects are omitted entirely so only the live build runs.
const LIVE_ONLY = LIVE_SMOKE && process.env.E2E_LIVE_ONLY === '1';

// Mocked layer. Two web servers, each managed by Playwright (no shell
// backgrounding):
//   1. the switchable mock Supabase server, and
//   2. the app build+preview bound to the mock URL.
// SvelteKit inlines PUBLIC_SUPABASE_URL at build time, so the preview build is
// bound to the mock URL; the mock's data/empty/error mode is switched at runtime
// via its control endpoint (see e2e/support/scenario.ts).
const mockServerWebServer = {
  command: `MOCK_PORT=${MOCK_PORT} node e2e/support/mock-supabase.ts`,
  // Playwright polls this until it responds; the control endpoint is a cheap
  // readiness probe.
  url: `${MOCK_URL}/__control/scenario`,
  reuseExistingServer: !process.env.CI,
  timeout: 30_000
};

const mockPreviewWebServer = {
  command: `pnpm exec vite build && pnpm exec vite preview --port ${MOCK_PREVIEW_PORT}`,
  url: MOCK_BASE,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  env: {
    PUBLIC_SUPABASE_URL: MOCK_URL,
    PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
  }
};

// Live layer: build+preview bound to the real project.
const liveWebServer = {
  command: `pnpm exec vite build && pnpm exec vite preview --port ${LIVE_PREVIEW_PORT}`,
  url: LIVE_BASE,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  env: {
    PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL || '',
    PUBLIC_SUPABASE_ANON_KEY: process.env.PUBLIC_SUPABASE_ANON_KEY || ''
  }
};

const desktop = devices['Desktop Chrome'];
const mobile = devices['Pixel 5'];

// The mocked specs run on both desktop and mobile viewports.
const mockedProjects = [
  {
    name: 'mocked-desktop',
    use: { ...desktop, baseURL: MOCK_BASE },
    testIgnore: /live-smoke\.spec\.ts/
  },
  {
    name: 'mocked-mobile',
    use: { ...mobile, baseURL: MOCK_BASE },
    testIgnore: /live-smoke\.spec\.ts/
  }
];

const liveProjects = [
  {
    name: 'live-desktop-smoke',
    use: { ...desktop, baseURL: LIVE_BASE },
    testMatch: /live-smoke\.spec\.ts/
  },
  {
    name: 'live-mobile-smoke',
    use: { ...mobile, baseURL: LIVE_BASE },
    testMatch: /live-smoke\.spec\.ts/
  }
];

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The mocked scenarios share one mock server whose scenario is switched per
  // test, so mocked specs must not run in parallel against it. A single worker
  // keeps the shared scenario deterministic.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    storageState: undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: LIVE_ONLY ? liveProjects : mockedProjects,
  webServer: LIVE_ONLY ? [liveWebServer] : [mockServerWebServer, mockPreviewWebServer]
});
