// Shared constants for the mocked Playwright layer, imported by both
// playwright.config.ts and the specs so the mock server URL/port, the seeded
// auth identities, and the derived Supabase storage key are defined once.
export const MOCK_PORT = 54321;

// The mock Supabase host. `*.localhost` resolves to 127.0.0.1 in Chromium and
// Node, so this is reachable without any /etc/hosts change, and its first label
// is STABLE — @supabase/supabase-js derives its localStorage auth key as
// `sb-<hostname-first-label>-auth-token`, so a stable first label yields a
// stable, deterministic storage key the auth-seeding init script can target
// regardless of port. (Using 127.0.0.1 directly would key it to `sb-127-…`.)
export const MOCK_HOST = 'gitgud-e2e.localhost';
export const MOCK_SUPABASE_URL = `http://${MOCK_HOST}:${MOCK_PORT}`;

// The Supabase browser session storage key for the mock URL, derived exactly as
// SupabaseClient does: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`.
export const SUPABASE_STORAGE_KEY = `sb-${MOCK_HOST.split('.')[0]}-auth-token`;

// The URL the control endpoint / scenario switcher talks to. It must reach the
// same process the app's SSR fetches hit; 127.0.0.1 and gitgud-e2e.localhost
// both resolve to the loopback interface the mock binds.
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

// Deterministic seeded identities. Each has a stable id, a bearer access token
// the mock recognizes (both for browser PostgREST reads and the server-side
// Bearer getUser/admin recheck), and an email. The admin owns an `admin` row in
// the mocked `user_roles` table; the member owns no admin row (or a non-admin
// one) so the admin-only gate denies it.
export const ADMIN_USER = {
  id: '00000000-0000-4000-8000-000000000adm',
  email: 'admin@gitgud.test',
  accessToken: 'e2e-admin-access-token',
  refreshToken: 'e2e-admin-refresh-token',
  role: 'admin' as const
};

export const MEMBER_USER = {
  id: '00000000-0000-4000-8000-00000000memb',
  email: 'member@gitgud.test',
  accessToken: 'e2e-member-access-token',
  refreshToken: 'e2e-member-refresh-token',
  role: 'member' as const
};
