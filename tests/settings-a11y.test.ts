/**
 * Static accessibility/correctness regression tests for the authenticated
 * settings surface (`/settings`). Run with: `node --test tests/`
 *
 * Like `submit-contrast.test.ts`, these tests are pure and dependency-free:
 * they read the theme token values out of `src/app.css` and the settings
 * component source out of `src/routes/settings/+page.svelte`, then compute
 * contrast ratios and assert markup invariants in JS. They never hit the
 * network, a browser, Supabase, or any production data.
 *
 * They lock in the three things the settings fix corrected so a future token
 * or markup change cannot silently reintroduce them:
 *   1. the "Saved" confirmation must use a semantic success color that is
 *      readable in both Paper (light) and Dark, not `--color-primary` (which
 *      equals the surface background and rendered the text invisible);
 *   2. the toggle focus indicator must use a color that meets non-text
 *      contrast and be keyboard-visible, not the invisible `--color-primary`;
 *   3. the auth/preference load must gate on the resolved session, with no
 *      artificial fixed delay (the removed 500ms timeout).
 *
 * WCAG 2.1 AA thresholds asserted here:
 *   - normal text:            >= 4.5:1  (the "Saved"/error status text)
 *   - non-text UI indicator:  >= 3:1    (the toggle focus ring)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_CSS = readFileSync(join(__dirname, '../src/app.css'), 'utf8');
const SETTINGS = readFileSync(join(__dirname, '../src/routes/settings/+page.svelte'), 'utf8');

// --- oklch -> sRGB -> relative luminance -> WCAG contrast ---------------------
// Uses the standard oklab matrices; sufficient precision for pass/fail checks.
function oklchToLinearSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

function relativeLuminance(L: number, C: number, hDeg: number): number {
  const [r, g, b] = oklchToLinearSrgb(L, C, hDeg).map((v) => Math.max(0, Math.min(1, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: number, bg: number): number {
  const hi = Math.max(fg, bg);
  const lo = Math.min(fg, bg);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Extract a `--token: oklch(L C H);` value from the given theme block of
 * app.css. `block` is 'light' for the unlayered `:root` palette or 'dark' for
 * the `html[data-theme='dark']` palette. Fails loudly if the token is missing
 * so a renamed/removed token surfaces as a test failure rather than a silent
 * skip.
 */
function tokenLum(block: 'light' | 'dark', name: string): number {
  let scope: string;
  if (block === 'dark') {
    const m = APP_CSS.match(/html\[data-theme='dark'\]\s*\{([\s\S]*?)\}/);
    assert.ok(m, "could not locate html[data-theme='dark'] palette block");
    scope = m[1];
  } else {
    const roots = [...APP_CSS.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
    const palette = roots.find((r) => r.includes('--color-accent:'));
    assert.ok(palette, 'could not locate the light :root palette block');
    scope = palette;
  }
  const re = new RegExp(`--${name}:\\s*oklch\\(([-0-9.]+)\\s+([-0-9.]+)\\s+([-0-9.]+)\\)`);
  const m = scope.match(re);
  assert.ok(m, `token --${name} not found (as a plain oklch) in ${block} palette`);
  return relativeLuminance(Number(m[1]), Number(m[2]), Number(m[3]));
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3.0;

// --- contrast: both themes ----------------------------------------------------
for (const theme of ['light', 'dark'] as const) {
  const success = tokenLum(theme, 'color-success');
  const error = tokenLum(theme, 'color-error');
  const accent = tokenLum(theme, 'color-accent');
  const secondary = tokenLum(theme, 'color-secondary'); // card fill
  const primary = tokenLum(theme, 'color-primary'); // page background

  // The "Saved" confirmation renders as `text-success` on the settings card
  // (`bg-secondary`). This is the exact pairing the fix introduced (previously
  // `text-primary`, which equals the surface and was invisible).
  test(`[${theme}] saved-status success text on card meets AA`, () => {
    const ratio = contrast(success, secondary);
    assert.ok(
      ratio >= AA_TEXT,
      `success vs secondary was ${ratio.toFixed(2)}:1, need >= ${AA_TEXT}`
    );
  });

  // The error status sits in the same region and must be equally readable.
  test(`[${theme}] error status text on card meets AA`, () => {
    const ratio = contrast(error, secondary);
    assert.ok(ratio >= AA_TEXT, `error vs secondary was ${ratio.toFixed(2)}:1, need >= ${AA_TEXT}`);
  });

  // The toggle focus ring is `focus-visible:ring-accent` drawn over the card
  // fill (`bg-secondary`), with a ring offset onto the same surface. As a
  // non-text UI indicator it must clear 3:1 in both themes.
  test(`[${theme}] toggle focus ring (accent / card) meets non-text AA`, () => {
    const ratio = contrast(accent, secondary);
    assert.ok(
      ratio >= AA_NON_TEXT,
      `accent vs secondary was ${ratio.toFixed(2)}:1, need >= ${AA_NON_TEXT}`
    );
  });

  // Guard against reverting to the old ring color: `--color-primary` equals the
  // page background, so a focus ring drawn in it is effectively invisible. This
  // documents *why* the ring uses accent, not primary.
  test(`[${theme}] primary is NOT a usable focus indicator over the page (documents the fix)`, () => {
    const ratio = contrast(primary, secondary);
    assert.ok(
      ratio < AA_NON_TEXT,
      `primary vs secondary is ${ratio.toFixed(2)}:1 — if this now passes, the ` +
        `token model changed; revisit why the settings focus ring avoids primary`
    );
  });
}

// --- markup semantics ---------------------------------------------------------

test('saved-status region is an assertive-free live region (role=status + aria-live)', () => {
  // The status container must announce the transient "Saved"/error text to
  // assistive tech. `role="status"` implies a polite live region; the explicit
  // aria-live pairs with it so the announcement is not lost.
  const region = SETTINGS.match(/<div class="mb-4 flex min-h-6 justify-end"[^>]*>/);
  assert.ok(region, 'could not locate the status region container');
  assert.match(region[0], /role="status"/, 'status region must have role="status"');
  assert.match(region[0], /aria-live="polite"/, 'status region must be aria-live="polite"');
});

test('saved status uses the semantic success color, not primary or accent', () => {
  // The success line must be `--color-success`; the old invisible `--color-primary`
  // (and the semantically-wrong `--color-accent`) must not carry status text.
  assert.match(
    SETTINGS,
    /\{#if success\}<p class="text-sm text-\[var\(--color-success\)\]">\{success\}<\/p>\{\/if\}/,
    'success status must use text-[var(--color-success)]'
  );
});

test('error status uses the semantic error color', () => {
  assert.match(
    SETTINGS,
    /\{#if error\}<p class="text-sm text-\[var\(--color-error\)\]">\{error\}<\/p>\{\/if\}/,
    'error status must use text-[var(--color-error)]'
  );
});

test('the loading state renders the shared spinner, not a plain loading-page line', () => {
  // #108 replaced the spinner with a bare `Loading settings…` line; the fix
  // restores the canonical animate-spin treatment used across the app so the
  // interim state matches the other loading surfaces instead of looking janky.
  const loadingBlock = SETTINGS.match(/\{#if loading\}([\s\S]*?)\{:else\}/);
  assert.ok(loadingBlock, 'could not locate the {#if loading} block');
  assert.match(
    loadingBlock[1],
    /class="mx-auto h-10 w-10 animate-spin"/,
    'the settings loading state must render the shared animate-spin spinner'
  );
  assert.match(loadingBlock[1], /role="status"/, 'the loading state must be a status region');
  assert.match(
    loadingBlock[1],
    /Loading settings\.\.\./,
    'spinner copy must match the sibling loading surfaces (Loading settings...)'
  );
  // The regressed plain page copy (curly-ellipsis, no spinner) must be gone.
  assert.doesNotMatch(
    SETTINGS,
    /<p class="text-\[var\(--color-text-muted\)\]">Loading settings\u2026<\/p>/,
    'the regressed spinner-less `Loading settings…` page copy must not return'
  );
});

const THEME_TOGGLE = readFileSync(
  join(__dirname, '../src/lib/components/ThemeToggle.svelte'),
  'utf8'
);

test('appearance uses the three-position theme toggle with the existing persistence path', () => {
  assert.match(SETTINGS, />\s*Appearance\s*</, 'settings must render an Appearance section');
  assert.match(
    SETTINGS,
    /<ThemeToggle\s+preference=\{\$currentThemePreference\}\s+onSelect=\{selectThemePreference\}\s*\/>/,
    'settings must wire ThemeToggle to selectThemePreference'
  );
  assert.match(
    SETTINGS,
    /Choose System, Light, or Dark/,
    'settings must explain the direct-selection interaction'
  );
});

test('the theme toggle exposes three directly selectable positions', () => {
  assert.match(THEME_TOGGLE, /role="radiogroup"/, 'theme control must be one radio group');
  assert.match(THEME_TOGGLE, /aria-label="Theme"/, 'theme group must have an accessible name');
  assert.match(THEME_TOGGLE, /role="radio"/, 'each theme position must be a radio');
  assert.match(
    THEME_TOGGLE,
    /aria-checked=\{preference === option\}/,
    'the selected position must be exposed to assistive technology'
  );
  assert.match(
    THEME_TOGGLE,
    /data-testid="theme-toggle-indicator"/,
    'the toggle must include one sliding active indicator'
  );
  assert.match(
    THEME_TOGGLE,
    /translateX\(\$\{selectedIndex \* 100\}%\)/,
    'the active indicator must move between left, middle, and right positions'
  );
});

test('the theme toggle supports arrow, Home, and End keys with focus-visible styling', () => {
  assert.match(
    THEME_TOGGLE,
    /event\.key === 'ArrowLeft'/,
    'left arrow must select the prior theme'
  );
  assert.match(
    THEME_TOGGLE,
    /event\.key === 'ArrowRight'/,
    'right arrow must select the next theme'
  );
  assert.match(THEME_TOGGLE, /event\.key === 'Home'/, 'Home must select System');
  assert.match(THEME_TOGGLE, /event\.key === 'End'/, 'End must select Dark');
  assert.match(
    THEME_TOGGLE,
    /focus-visible:outline-\[var\(--color-accent\)\]/,
    'each position must draw a focus-visible accent outline'
  );
});

test('each theme position meets the 44px minimum touch target', () => {
  assert.match(THEME_TOGGLE, /min-h-11/, 'each theme position must be at least 44px tall');
});

test('the settings page leaves deliberate space above the footer', () => {
  assert.match(
    SETTINGS,
    /<section class="[^"]*mb-16[^"]*md:mb-20[^"]*">\s*<h2[^>]*>\s*Import solved problems/,
    'the final settings card must retain responsive footer separation'
  );
});

test('the privacy toggle has a keyboard-visible accent ring, not invisible primary', () => {
  const toggles = [...SETTINGS.matchAll(/<button[^>]*role="switch"[\s\S]*?>/g)].map((m) => m[0]);
  assert.equal(toggles.length, 1, 'expected exactly one role="switch" toggle');
  for (const toggle of toggles) {
    assert.match(
      toggle,
      /focus-visible:ring-\[var\(--color-accent\)\]/,
      'each toggle must use a focus-visible accent ring'
    );
    // focus-visible (not bare focus) so a keyboard focus shows the ring without
    // painting it on pointer clicks.
    assert.match(toggle, /focus-visible:ring-2/, 'each toggle must use focus-visible:ring-2');
  }
  // No control anywhere may keep the old invisible primary focus ring.
  assert.doesNotMatch(
    SETTINGS,
    /focus:ring-\[var\(--color-primary\)\]/,
    'toggles must not keep the invisible primary focus ring'
  );
});

// --- no artificial delay / session-gated init --------------------------------

test('the settings init has no fixed timeout / artificial delay', () => {
  // The removed logic used a 500ms setTimeout to "wait for user state". No
  // setTimeout may remain in the component (the debounced save timeout is a
  // separate concern but also must not reappear as a load gate) — assert the
  // specific artificial delay is gone.
  assert.doesNotMatch(SETTINGS, /500\); \/\/ 500ms delay/, 'the 500ms load delay must be removed');
  assert.doesNotMatch(
    SETTINGS,
    /loadPreferencesWithDelay/,
    'the delayed-load helper must be removed'
  );
  assert.doesNotMatch(
    SETTINGS,
    /setTimeout\([^)]*\}\s*,\s*500\s*\)/,
    'no 500ms setTimeout may gate the preference load'
  );
});

test('the settings init redirects anonymous and signed-out visitors', () => {
  assert.match(
    SETTINGS,
    /import\s*\{[^}]*resolveCurrentActor[^}]*\}\s*from '\$lib\/auth\/currentActor';/,
    'init must resolve auth through the currentActor module'
  );
  assert.match(
    SETTINGS,
    /if \(!actor\.user\)\s*\{\s*await goto\(resolve\('\/'\), \{ replaceState: true \}\);\s*return;/,
    'anonymous direct navigation must replace Settings with home'
  );
  assert.match(
    SETTINGS,
    /actor\.user\?\.id !== authorizedUserId[\s\S]*?loading = true;[\s\S]*?preferences = \{ hideFromLeaderboard: false, theme: 'system' \};[\s\S]*?codeforcesPreview = null;[\s\S]*?kattisPreview = null;[\s\S]*?goto\(resolve\('\/'\), \{ replaceState: true \}\)/,
    'sign-out or account changes must hide and clear account data before redirecting home'
  );
  assert.match(
    SETTINGS,
    /authorizedUserId = actor\.user\.id;\s*const loaded = await fetchUserPreferences\(\);\s*if \(getCurrentActor\(\)\.user\?\.id !== authorizedUserId\) return;/,
    'preference loads must be discarded if the authenticated identity changes'
  );
});

test('all settings sections render only after the authenticated loading gate', () => {
  assert.match(
    SETTINGS,
    /\{#if loading\}[\s\S]*?\{:else\}[\s\S]*?Appearance/,
    'Appearance must wait for auth'
  );
  assert.doesNotMatch(
    SETTINGS,
    /\{#if user\}/,
    'authenticated Settings needs no per-section user fallback'
  );
  assert.match(
    SETTINGS,
    /Appearance[\s\S]*?Privacy[\s\S]*?Import solved problems/,
    'all sections remain present'
  );
});
