/**
 * Static markup-regression tests for the public data tables (ProblemTable,
 * ContestTable). Run with: `node --test tests/`
 *
 * Dependency-free like the other tests in this dir: they read the component
 * source with readFileSync and assert on the markup, never rendering a
 * component, hitting a browser, or touching Supabase. They lock out two bugs
 * that were live in production:
 *
 *   1. Row highlight/hover was written as a `${...}` interpolation inside a
 *      plain double-quoted `class="..."` attribute. Svelte only evaluates
 *      `${...}` inside a `class={`...`}` template-literal expression, so the
 *      conditional was emitted as a LITERAL string and the solved/participated
 *      highlight and the ordinary row hover never applied. These tests fail if
 *      any element reintroduces a `${` inside a static `class="..."`.
 *   2. The like/dislike buttons announced only a bare count to assistive tech
 *      (the glyph was an unlabelled <svg>, the only text was the number). These
 *      tests require each such button to carry an aria-label and aria-pressed,
 *      and its decorative <svg> to be aria-hidden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = {
  ProblemTable: readFileSync(join(__dirname, '../src/lib/components/ProblemTable.svelte'), 'utf8'),
  ContestTable: readFileSync(join(__dirname, '../src/lib/components/ContestTable.svelte'), 'utf8')
};

for (const [name, src] of Object.entries(COMPONENTS)) {
  // Bug #1 guard: a `${` must never appear inside a static double-quoted class
  // attribute, because Svelte will not interpolate it there. Match
  // `class="..."` spans (double-quoted, no nested double quote) and assert none
  // contains `${`. Template-literal `class={`...`}` bindings are unaffected —
  // they use braces + backticks, not this pattern.
  test(`[${name}] no static class="..." contains an un-evaluated \${ interpolation`, () => {
    const offenders = [...src.matchAll(/class="([^"]*)"/g)]
      .filter((m) => m[1].includes('${'))
      .map((m) => m[1].slice(0, 80));
    assert.deepEqual(
      offenders,
      [],
      `found \${...} inside a plain class="..." (must be class={\`...\`}): ${offenders.join(' | ')}`
    );
  });

  // The row highlight is conditional and MUST therefore be delivered via a
  // template-literal class expression (the fix). Assert the highlight token the
  // solved/participated row uses is reachable from a `class={`` binding.
  test(`[${name}] row highlight uses a class={\`...\`} template-literal binding`, () => {
    assert.match(
      src,
      /class=\{`relative border-b/,
      'the row <tr> should bind class with a template literal so its ${...} highlight evaluates'
    );
    assert.match(
      src,
      /border-l-\[var\(--color-solved\)\] bg-\[var\(--color-solved-row\)\]/,
      'the solved/participated highlight classes should be present in the row binding'
    );
  });

  // Bug #2 guard: every like/dislike button carries an aria-label and
  // aria-pressed. Both tables render exactly two such buttons (like + dislike).
  test(`[${name}] like/dislike buttons expose aria-label + aria-pressed`, () => {
    const likeLabels = [...src.matchAll(/aria-label=\{`Like/g)].length;
    const dislikeLabels = [...src.matchAll(/aria-label=\{`Dislike/g)].length;
    const pressed = [...src.matchAll(/aria-pressed=\{has(Liked|Disliked)\}/g)].length;
    assert.equal(likeLabels, 1, 'expected one like button with an aria-label');
    assert.equal(dislikeLabels, 1, 'expected one dislike button with an aria-label');
    assert.equal(pressed, 2, 'expected aria-pressed on both the like and dislike buttons');
  });

  // The aria-label must include the count so screen-reader users hear e.g.
  // "Like, 5 likes" rather than a bare "5".
  test(`[${name}] like/dislike aria-labels include the count`, () => {
    assert.match(src, /aria-label=\{`Like[^`]*,\s*\$\{[^}]*\.likes\}/);
    assert.match(src, /aria-label=\{`Dislike[^`]*,\s*\$\{[^}]*\.dislikes\}/);
  });

  // The decorative thumb glyphs must be hidden from assistive tech so the
  // aria-label is the sole accessible name. Both buttons use an <svg>; require
  // at least the two like/dislike glyphs to be aria-hidden.
  test(`[${name}] decorative like/dislike glyphs are aria-hidden`, () => {
    const hidden = [...src.matchAll(/class="stroke-2"\s+aria-hidden="true"/g)].length;
    assert.ok(hidden >= 2, `expected >= 2 aria-hidden thumb glyphs, found ${hidden}`);
  });
}
