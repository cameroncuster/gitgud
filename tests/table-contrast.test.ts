/**
 * Static WCAG-contrast regression tests for the public data tables (Problems,
 * Contests, Leaderboard). Run with: `node --test tests/`
 *
 * Like tests/submit-contrast.test.ts these are pure and dependency-free: they
 * read the theme token values straight out of `src/app.css` and compute
 * contrast ratios in JS. They never hit the network, a browser, Supabase, or
 * any production data. Their purpose is to lock in the color pairings the
 * tables rely on so a future token change cannot silently reintroduce an
 * unreadable control (e.g. the light-theme `#22c55e` solved/like green at
 * 2.28:1, or the white-on-fill difficulty/rank badges that failed AA).
 *
 * WCAG 2.1 AA thresholds asserted here:
 *   - normal text:            >= 4.5:1  (state text, badge digit — text-sm bold
 *                                        is NOT "large text")
 *   - large text / non-text:  >= 3:1    (contest stars are text-2xl bold)
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

// Pure white — the foreground on every rating/rank badge fill.
const WHITE = relativeLuminance(1, 0, 0);

/**
 * Extract a `--token: oklch(L C H);` value and return its luminance. `block`
 * selects which palette to read from:
 *   - 'theme' → the `@layer theme` `:root` (fonts + rating tier colors)
 *   - 'light' → the unlayered `:root` palette (contains --color-accent)
 *   - 'dark'  → the `html[data-theme='dark']` palette
 * Fails loudly if the token is missing so a renamed/removed token surfaces as a
 * test failure rather than a silent skip.
 */
function tokenLum(block: 'theme' | 'light' | 'dark', name: string): number {
  let scope: string;
  if (block === 'dark') {
    const m = APP_CSS.match(/html\[data-theme='dark'\]\s*\{([\s\S]*?)\}/);
    assert.ok(m, "could not locate html[data-theme='dark'] palette block");
    scope = m[1];
  } else if (block === 'theme') {
    // The rating tier colors live in the FIRST `:root`, inside `@layer theme`,
    // identified by containing the tier tokens rather than --color-accent.
    const roots = [...APP_CSS.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map((r) => r[1]);
    const themeRoot = roots.find((r) => r.includes('--color-legendary-grandmaster:'));
    assert.ok(themeRoot, 'could not locate the @layer theme :root block');
    scope = themeRoot;
  } else {
    const roots = [...APP_CSS.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map((r) => r[1]);
    const palette = roots.find((r) => r.includes('--color-accent:'));
    assert.ok(palette, 'could not locate the light :root palette block');
    scope = palette;
  }
  const re = new RegExp(`--${name}:\\s*oklch\\(([-0-9.]+)\\s+([-0-9.]+)\\s+([-0-9.]+)\\)`);
  const m = scope.match(re);
  assert.ok(m, `token --${name} not found (as a plain oklch) in ${block} block`);
  return relativeLuminance(Number(m[1]), Number(m[2]), Number(m[3]));
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3.0; // also the large-text threshold

// The state colors (solved/like/dislike) and star scale are theme-scoped and
// sit on the row backgrounds: secondary (card / raised paper) and primary
// (page ground). Both must clear the bar so the color is readable on any row.
for (const theme of ['light', 'dark'] as const) {
  const secondary = tokenLum(theme, 'color-secondary');
  const primary = tokenLum(theme, 'color-primary');
  const worstBg = (fg: number) => Math.min(contrast(fg, secondary), contrast(fg, primary));

  // Solved / like / dislike are rendered as TEXT and border (e.g. the like
  // count, the solved-row left border). Normal-text AA.
  for (const name of ['color-solved', 'color-like', 'color-dislike'] as const) {
    test(`[${theme}] ${name} as table text meets AA`, () => {
      const ratio = worstBg(tokenLum(theme, name));
      assert.ok(
        ratio >= AA_TEXT,
        `${name} vs row background was ${ratio.toFixed(2)}:1, need >= ${AA_TEXT}`
      );
    });
  }

  // Contest difficulty stars: text-2xl bold => large text => 3:1.
  for (let i = 1; i <= 5; i++) {
    test(`[${theme}] color-star-${i} (large star glyph) meets non-text AA`, () => {
      const ratio = worstBg(tokenLum(theme, `color-star-${i}`));
      assert.ok(
        ratio >= AA_NON_TEXT,
        `color-star-${i} vs row background was ${ratio.toFixed(2)}:1, need >= ${AA_NON_TEXT}`
      );
    });
  }
}

// Rating tier colors are used as BADGE FILLS behind white text (the difficulty
// badge digit in ProblemTable, the rank bubble digit in LeaderboardTable).
// These tokens are theme-independent (defined once in @layer theme) and the
// digit is text-sm bold (not large text), so white must clear normal-text AA.
const TIER_TOKENS = [
  'color-legendary-grandmaster',
  'color-international-grandmaster',
  'color-grandmaster',
  'color-international-master',
  'color-master',
  'color-candidate-master',
  'color-expert',
  'color-specialist',
  'color-pupil',
  'color-newbie'
];
for (const name of TIER_TOKENS) {
  test(`white badge text on ${name} fill meets AA`, () => {
    const ratio = contrast(WHITE, tokenLum('theme', name));
    assert.ok(ratio >= AA_TEXT, `white vs ${name} was ${ratio.toFixed(2)}:1, need >= ${AA_TEXT}`);
  });
}
