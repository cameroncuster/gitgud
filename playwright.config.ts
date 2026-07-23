import { defineConfig, devices } from '@playwright/test';

// Anonymous smoke suite. Runs against a locally started production build served
// by `vite preview` (no external URLs). Supabase credentials are intentionally
// placeholders: the app's data services swallow fetch failures and render an
// empty content shell, so the suite exercises real production output without
// touching or mutating any remote data.
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  // Fail the CI build if a `test.only` is left in the source.
  forbidOnly: !!process.env.CI,
  // A single retry absorbs rare cold-start flakiness without masking real
  // failures; the first-attempt result is still reported.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    // Isolate storage per test so no state leaks between anonymous sessions.
    storageState: undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] }
    }
  ],
  webServer: {
    // Build then serve the production output, so the suite exercises the real
    // build rather than dev-only behavior. Standalone-safe: does not assume a
    // prior build step.
    command: `pnpm exec vite build && pnpm exec vite preview --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Placeholder credentials — see the note at the top of this file.
      PUBLIC_SUPABASE_URL: 'http://localhost',
      PUBLIC_SUPABASE_ANON_KEY: 'placeholder'
    }
  }
});
