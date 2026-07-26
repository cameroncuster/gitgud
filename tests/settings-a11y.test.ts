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

test('appearance is an explicit three-state theme toggle, not a single cycle button', () => {
  // The theme control lives in Settings and now shows all three choices at once
  // instead of cycling through them behind one button.
  assert.match(SETTINGS, />\s*Appearance\s*</, 'settings must render an Appearance section');
  // Settings wires the three-state ThemeToggle to direct selection, not cycling.
  assert.match(
    SETTINGS,
    /<ThemeToggle\s+preference=\{\$currentThemePreference\}\s+onSelect=\{selectThemePreference\}\s*\/>/,
    'settings must use the three-state ThemeToggle wired to selectThemePreference'
  );
  // The single-button cycle helper must be gone from the settings page.
  assert.doesNotMatch(
    SETTINGS,
    /ThemeCycleButton|function cycleTheme/,
    'settings must not keep the old single-target cycle control'
  );
});

test('the theme toggle exposes an accessible single-choice radio group with all three options', () => {
  // A semantic radio group makes the three states a single-choice control for
  // assistive tech and keyboard users.
  assert.match(THEME_TOGGLE, /role="radiogroup"/, 'theme toggle must be a radiogroup');
  const radios = [...THEME_TOGGLE.matchAll(/role="radio"/g)];
  assert.equal(radios.length, 1, 'the toggle renders one templated role="radio" per option');
  // All three options must be enumerated so they are simultaneously discoverable.
  for (const value of ['system', 'light', 'dark']) {
    assert.match(
      THEME_TOGGLE,
      new RegExp(`value:\\s*'${value}'`),
      `theme toggle must offer the ${value} option`
    );
  }
  // Selected state is exposed via aria-checked, and each option keeps a stable
  // accessible name even when the visible label is hidden on narrow layouts.
  assert.match(THEME_TOGGLE, /aria-checked=\{selected\}/, 'selection must use aria-checked');
  assert.match(THEME_TOGGLE, /aria-label=\{option\.label\}/, 'each radio needs a stable name');
});

test('the theme toggle is keyboard operable with roving tabindex and focus-visible styling', () => {
  // Arrow/Home/End move selection; only the selected radio is in the tab order.
  assert.match(THEME_TOGGLE, /on:keydown=/, 'the toggle must handle keydown for arrow navigation');
  assert.match(THEME_TOGGLE, /ArrowRight/, 'arrow keys must move between options');
  assert.match(THEME_TOGGLE, /tabindex=\{/, 'the toggle must use roving tabindex');
  assert.match(
    THEME_TOGGLE,
    /focus-visible:outline-\[var\(--color-accent\)\]/,
    'the toggle must draw a focus-visible accent outline'
  );
});

test('each theme option meets the 44px minimum touch target', () => {
  // min-h-11 / min-w-11 are the 44px Tailwind targets used across the app.
  assert.match(THEME_TOGGLE, /min-h-11/, 'theme options must be at least 44px tall');
  assert.match(THEME_TOGGLE, /min-w-11/, 'theme options must be at least 44px wide');
});

test('the settings page leaves deliberate space above the footer', () => {
  // Signed-in: the Import card is last and carries the responsive bottom margin.
  assert.match(
    SETTINGS,
    /<section class="[^"]*mb-16[^"]*md:mb-20[^"]*">\s*<h2[^>]*>\s*Import solved problems/,
    'the final signed-in settings card must retain responsive footer separation'
  );
  // Anonymous: only Appearance renders, so it must pick up the same margin when
  // no user is present (the `user ? '' : 'mb-16 md:mb-20'` branch).
  assert.match(
    SETTINGS,
    /user\s*\?\s*''\s*:\s*'mb-16 md:mb-20'/,
    'the Appearance card must retain footer separation when it is the last card for anonymous visitors'
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

test('the settings init resolves the actor and loads preferences only for signed-in users', () => {
  assert.match(
    SETTINGS,
    /import\s*\{[^}]*resolveCurrentActor[^}]*\}\s*from '\$lib\/auth\/currentActor';/,
    'init must resolve auth through the currentActor module'
  );
  // Anonymous visitors are NOT redirected away — Settings is reachable so they
  // can change the localStorage theme. The old redirect must be gone.
  assert.doesNotMatch(
    SETTINGS,
    /goto\(resolve\('\/'\)\)/,
    'init must not redirect anonymous visitors away from Settings'
  );
  // The account query only runs when a session exists (no account read for
  // anonymous visitors).
  assert.match(
    SETTINGS,
    /const actor = await resolveCurrentActor\(\);[\s\S]*?if \(actor\.user\)\s*\{[\s\S]*?fetchUserPreferences\(\)/,
    'init must gate fetchUserPreferences behind a resolved session'
  );
});

test('account-only sections are gated behind a session; Appearance is always rendered', () => {
  // Appearance renders unconditionally (outside any {#if user}); the privacy
  // and import sections live inside the {#if user} account gate.
  const appearanceIdx = SETTINGS.search(/>\s*Appearance\s*</);
  const gateIdx = SETTINGS.indexOf('{#if user}');
  assert.ok(appearanceIdx !== -1, 'Appearance section must be present');
  assert.ok(gateIdx !== -1, 'account sections must be gated by {#if user}');
  assert.ok(
    appearanceIdx < gateIdx,
    'Appearance must render before (outside) the {#if user} account gate'
  );
  // The privacy toggle and import UI are account-only.
  assert.match(
    SETTINGS,
    /\{#if user\}[\s\S]*?Privacy[\s\S]*?Import solved problems[\s\S]*?\{\/if\}/,
    'Privacy and Import must be inside the {#if user} account gate'
  );
});
