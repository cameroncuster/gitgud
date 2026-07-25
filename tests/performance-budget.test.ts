import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  budgetFailures,
  collectImmutableAssets,
  measureHomepageFixture,
  renderHomepageTableFixture,
  summarizeAssets
} from '../scripts/performance-budget.mjs';

test('asset collection includes only immutable JavaScript and CSS in stable order', async (t) => {
  const root = join(process.cwd(), '.performance-budget-test');
  const immutable = join(root, '_app/immutable');
  await mkdir(join(immutable, 'chunks'), { recursive: true });
  t.after(async () =>
    (await import('node:fs/promises')).rm(root, { recursive: true, force: true })
  );
  await Promise.all([
    writeFile(join(immutable, 'chunks/b.js'), 'export const b = 2;'),
    writeFile(join(immutable, 'a.css'), 'body { color: black; }'),
    writeFile(join(immutable, 'ignored.map'), '{}')
  ]);

  const assets = await collectImmutableAssets(root);
  assert.deepEqual(
    assets.map((asset) => asset.path),
    ['_app/immutable/a.css', '_app/immutable/chunks/b.js']
  );
  assert.ok(assets.every((asset) => asset.gzipBytes > 0));
  assert.equal(summarizeAssets(assets).assetCount, 2);
});

test('homepage fixture models the deterministic initial 50-row batch', () => {
  const html = renderHomepageTableFixture();
  assert.equal((html.match(/data-problem-id=/g) ?? []).length, 50);
  assert.match(html, /Fixture Problem 1 &lt;quality&gt;/);
  assert.match(html, /aria-controls="problem-table-body"/);
  assert.match(html, />50 of 280 problems shown</);
  assert.deepEqual(measureHomepageFixture(), measureHomepageFixture());
});

test('budget failures name only exceeded limits', () => {
  const summary = {
    totalGzipBytes: 101,
    largestJavaScript: { gzipBytes: 50 },
    largestCss: { gzipBytes: 20 }
  };
  const fixture = { htmlBytes: 300, gzipBytes: 30 };
  assert.deepEqual(
    budgetFailures(
      summary,
      fixture,
      { totalGzipBytes: 100, largestJavaScriptGzipBytes: 50, largestCssGzipBytes: 21 },
      { htmlBytes: 300, gzipBytes: 29 }
    ),
    ['total immutable JS/CSS gzip: 101 > 100 bytes', 'initial homepage fixture gzip: 30 > 29 bytes']
  );
});
