/**
 * Regression tests for previously-undefined CSS utilities/tokens that silently
 * produced no styling ("no-op" classes). Run with: `node --test tests/`
 *
 * Two classes of bug are guarded here:
 *
 *   1. Bare semantic color utilities (e.g. `text-accent`). This project runs
 *      Tailwind v4 with `@import 'tailwindcss'` and defines its palette as plain
 *      CSS custom properties *outside* `@theme`, so Tailwind never registers an
 *      `accent` color and `text-accent` compiles to nothing. The whole codebase
 *      instead uses the arbitrary-value form `text-[var(--color-accent)]`. The
 *      /about headings had regressed to the bare form and rendered with no
 *      accent color; this locks in the working arbitrary-value form.
 *
 *   2. References to a custom property that was never defined
 *      (`--color-accent-muted`, used by RecommendersFilter's select hover
 *      border). `var(--color-accent-muted)` with no definition resolves to
 *      nothing, so the hover border was a no-op. This asserts the token is now
 *      defined in *both* palettes.
 *
 * The first two groups assert against the *generated production CSS* (a real
 * `vite build`), because a source string can look right yet still fail to emit
 * a rule; only the built stylesheet proves the selector actually applies. The
 * contrast group is pure and reads token values straight from `src/app.css`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const APP_CSS = readFileSync(join(ROOT, 'src/app.css'), 'utf8');

// --- build once, then read the concatenated generated CSS ---------------------
// Invoke vite directly through node (not `pnpm build`) so the build does not
// depend on the package-manager wrapper. Fails loudly if no CSS is emitted.
let BUILT_CSS = '';
before(() => {
  const outDir = join(ROOT, '.svelte-kit/output');
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: ROOT,
    stdio: 'ignore'
  });
  const assetsDir = join(ROOT, '.svelte-kit/output/client/_app/immutable/assets');
  const cssFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.css'));
  assert.ok(cssFiles.length > 0, 'build produced no CSS assets');
  BUILT_CSS = cssFiles.map((f) => readFileSync(join(assetsDir, f), 'utf8')).join('\n');
});

// --- group 1: /about accent headings resolve to a real color ------------------
test('generated CSS emits the arbitrary-value accent text utility (not a no-op)', () => {
  // The exact rule Tailwind emits for `text-[var(--color-accent)]`. The class
  // selector is CSS-escaped in the output, hence the backslashes.
  assert.ok(
    BUILT_CSS.includes('.text-\\[var\\(--color-accent\\)\\]{color:var(--color-accent)}'),
    'the arbitrary-value accent text utility did not compile to a rule'
  );
});

test('the bare `text-accent` utility is absent from generated CSS (proves why it was a no-op)', () => {
  // A bare `.text-accent{...}` rule never existed; if it ever appears the token
  // model changed and the /about headings could be reverted to the bare form.
  assert.ok(
    !BUILT_CSS.includes('.text-accent{'),
    'a bare .text-accent rule now exists — revisit the /about heading classes'
  );
});

// --- group 2: --color-accent-muted is defined in both palettes ----------------
test('generated CSS defines --color-accent-muted in the light palette', () => {
  const light = BUILT_CSS.match(/:root\{[^}]*--color-accent:[^}]*\}/);
  assert.ok(light, 'could not locate the light :root palette in generated CSS');
  assert.match(
    light[0],
    /--color-accent-muted:oklch\(/,
    '--color-accent-muted missing from the light palette'
  );
});

test('generated CSS defines --color-accent-muted in the dark palette', () => {
  const dark = BUILT_CSS.match(/html\[data-theme=['"]?dark['"]?\]\{[^}]*\}/);
  assert.ok(dark, 'could not locate the dark palette in generated CSS');
  assert.match(
    dark[0],
    /--color-accent-muted:oklch\(/,
    '--color-accent-muted missing from the dark palette'
  );
});

test('the RecommendersFilter hover border references --color-accent-muted, now defined', () => {
  // The hover utility must both emit a rule AND point at a token the build
  // actually defines (asserted above), so it is no longer a dangling var().
  assert.match(
    BUILT_CSS,
    /border-color:var\(--color-accent-muted\)/,
    'the accent-muted hover border rule did not compile'
  );
});

// --- group 3: contrast of the new muted-accent border (both themes) -----------
// Reuses the oklch -> sRGB -> luminance -> WCAG pipeline from the submit-contrast
// suite. The muted-accent border is a non-text UI indicator over the select's
// rest fill (--color-tertiary), so the applicable threshold is 3:1.
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

const AA_NON_TEXT = 3.0;
for (const theme of ['light', 'dark'] as const) {
  test(`[${theme}] muted-accent hover border over the select fill meets non-text AA`, () => {
    const mutedAccent = tokenLum(theme, 'color-accent-muted');
    const tertiary = tokenLum(theme, 'color-tertiary'); // select rest fill
    const ratio = contrast(mutedAccent, tertiary);
    assert.ok(
      ratio >= AA_NON_TEXT,
      `accent-muted vs tertiary was ${ratio.toFixed(2)}:1, need >= ${AA_NON_TEXT}`
    );
  });
}
