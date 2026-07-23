/**
 * Static WCAG-contrast regression tests for the authenticated submit surfaces
 * (`/submit`, `/submit/codeforces`, `/submit/kattis`). Run with:
 * `node --test tests/`
 *
 * These tests are pure and dependency-free: they read the theme token values
 * straight out of `src/app.css` and compute contrast ratios in JS. They never
 * hit the network, a browser, Supabase, or any production data. Their purpose
 * is to lock in the color pairings the submit UI relies on so a future token
 * or class change cannot silently reintroduce an unreadable control (e.g. the
 * white-on-paper Submit button that motivated this work).
 *
 * WCAG 2.1 AA thresholds asserted here:
 *   - normal text:            >= 4.5:1
 *   - large text / non-text:  >= 3:1  (button labels are bold >= 18.66px; the
 *                                      focus border and result border-l-4 are
 *                                      non-text UI indicators)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_CSS = readFileSync(join(__dirname, '../src/app.css'), 'utf8');

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
  // Isolate the correct palette block. The light palette is the second, and
  // unlayered, `:root { ... }` (the first `:root` lives inside @layer theme and
  // holds fonts/rating colors, not the palette). The dark palette is the
  // `html[data-theme='dark'] { ... }` block.
  let scope: string;
  if (block === 'dark') {
    const m = APP_CSS.match(/html\[data-theme='dark'\]\s*\{([\s\S]*?)\}/);
    assert.ok(m, "could not locate html[data-theme='dark'] palette block");
    scope = m[1];
  } else {
    // Grab every `:root { ... }` and take the one that actually defines the
    // palette (contains --color-accent).
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
const AA_NON_TEXT = 3.0; // also the large-text threshold

for (const theme of ['light', 'dark'] as const) {
  const accent = tokenLum(theme, 'color-accent');
  const onAccent = tokenLum(theme, 'color-on-accent');
  const background = tokenLum(theme, 'color-background');
  const secondary = tokenLum(theme, 'color-secondary');
  const primary = tokenLum(theme, 'color-primary');
  const info = tokenLum(theme, 'color-info');
  const success = tokenLum(theme, 'color-success');
  const error = tokenLum(theme, 'color-error');

  // The Submit button: label is `text-on-accent` on a `bg-accent` fill. This is
  // the exact pair that regressed (white-on-paper) and is the primary guard.
  test(`[${theme}] Submit button label (on-accent / accent) meets AA`, () => {
    const ratio = contrast(onAccent, accent);
    assert.ok(
      ratio >= AA_TEXT,
      `on-accent vs accent was ${ratio.toFixed(2)}:1, need >= ${AA_TEXT}`
    );
  });

  // Focus indicator: inputs/textareas use `focus:border-accent` over the input
  // fill (`bg-background`). Non-text UI indicator -> 3:1.
  test(`[${theme}] input focus border (accent / background) meets non-text AA`, () => {
    const ratio = contrast(accent, background);
    assert.ok(
      ratio >= AA_NON_TEXT,
      `accent vs background was ${ratio.toFixed(2)}:1, need >= ${AA_NON_TEXT}`
    );
  });

  // Status text on the card (`bg-secondary`) and on the result-row fill
  // (`bg-background`): pending/info, success, and error are normal text.
  for (const [label, fg] of [
    ['info', info],
    ['success', success],
    ['error', error]
  ] as const) {
    test(`[${theme}] ${label} status text on card meets AA`, () => {
      const ratio = contrast(fg, secondary);
      assert.ok(
        ratio >= AA_TEXT,
        `${label} vs secondary was ${ratio.toFixed(2)}:1, need >= ${AA_TEXT}`
      );
    });
    test(`[${theme}] ${label} status text on result row meets AA`, () => {
      const ratio = contrast(fg, background);
      assert.ok(
        ratio >= AA_TEXT,
        `${label} vs background was ${ratio.toFixed(2)}:1, need >= ${AA_TEXT}`
      );
    });
  }

  // Result-row left border (`border-l-4` in success/error): non-text indicator.
  for (const [label, fg] of [
    ['success', success],
    ['error', error]
  ] as const) {
    test(`[${theme}] ${label} result border (on background) meets non-text AA`, () => {
      const ratio = contrast(fg, background);
      assert.ok(
        ratio >= AA_NON_TEXT,
        `${label} vs background was ${ratio.toFixed(2)}:1, need >= ${AA_NON_TEXT}`
      );
    });
  }

  // Guard against reusing --color-primary as a foreground/border on same-value
  // surfaces (the old bug: primary == background == input fill in both themes,
  // giving ~1:1). This documents *why* accent is used instead of primary.
  test(`[${theme}] primary is NOT a usable indicator over background (documents the fix)`, () => {
    const ratio = contrast(primary, background);
    assert.ok(
      ratio < AA_NON_TEXT,
      `primary vs background is ${ratio.toFixed(2)}:1 — if this now passes, ` +
        `the token model changed; revisit why submit surfaces avoid primary here`
    );
  });
}
