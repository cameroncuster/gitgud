import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

/** @typedef {{ path: string, type: string, bytes: number, gzipBytes: number }} Asset */
/** @typedef {{ totalGzipBytes: number, largestJavaScriptGzipBytes: number, largestCssGzipBytes: number }} StaticBudgets */
/** @typedef {{ rows?: number, totalProblems?: number, htmlBytes: number, gzipBytes: number }} FixtureBudgets */
/** @typedef {{ totalGzipBytes: number, largestJavaScript: { gzipBytes: number } | null, largestCss: { gzipBytes: number } | null }} AssetSummary */
/** @typedef {{ htmlBytes: number, gzipBytes: number }} FixtureSummary */

/** @type {Readonly<StaticBudgets>} */
export const STATIC_BUDGETS = Object.freeze({
  totalGzipBytes: 155_000,
  largestJavaScriptGzipBytes: 58_000,
  largestCssGzipBytes: 10_000
});
/** @type {Readonly<Required<FixtureBudgets>>} */
export const HOMEPAGE_FIXTURE_BUDGETS = Object.freeze({
  rows: 50,
  totalProblems: 280,
  htmlBytes: 24_000,
  gzipBytes: 2_000
});

/**
 * @param {string} staticDirectory
 * @returns {Promise<Asset[]>}
 */
export async function collectImmutableAssets(staticDirectory) {
  const immutableDirectory = resolve(staticDirectory, '_app/immutable');
  /** @type {Asset[]} */
  const assets = [];

  /** @param {string} directory */
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && ['.js', '.css'].includes(extname(entry.name))) {
        const bytes = await readFile(path);
        assets.push({
          path: relative(staticDirectory, path).split(sep).join('/'),
          type: extname(entry.name).slice(1),
          bytes: bytes.byteLength,
          gzipBytes: gzipSync(bytes, { level: 9 }).byteLength
        });
      }
    }
  }

  await visit(immutableDirectory);
  return assets.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * @param {Asset[]} assets
 * @returns {AssetSummary & { assetCount: number, totalBytes: number, largestAssets: Asset[] }}
 */
export function summarizeAssets(assets) {
  const byGzipSize = [...assets].sort(
    (left, right) => right.gzipBytes - left.gzipBytes || left.path.localeCompare(right.path)
  );
  return {
    assetCount: assets.length,
    totalBytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    totalGzipBytes: assets.reduce((total, asset) => total + asset.gzipBytes, 0),
    largestJavaScript: byGzipSize.find((asset) => asset.type === 'js') ?? null,
    largestCss: byGzipSize.find((asset) => asset.type === 'css') ?? null,
    largestAssets: byGzipSize.slice(0, 10)
  };
}

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderHomepageTableFixture(rowCount = HOMEPAGE_FIXTURE_BUDGETS.rows) {
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const id = index + 1;
    const source = index % 2 === 0 ? 'codeforces' : 'kattis';
    const name = escapeHtml(`Fixture Problem ${id} <quality>`);
    return `<tr data-problem-id="fixture-${id}"><td><button aria-label="Mark as solved">✓</button></td><td>${source}</td><td><a href="https://example.test/problems/${id}">${name}</a></td><td>${800 + (index % 28) * 100}</td><td>dynamic programming</td><td><a href="https://example.test/users/author-${index % 20}">@author-${index % 20}</a></td><td><button aria-label="Like, ${index % 17} likes">${index % 17}</button><button aria-label="Dislike, ${index % 5} dislikes">${index % 5}</button></td></tr>`;
  });
  const remaining = Math.max(HOMEPAGE_FIXTURE_BUDGETS.totalProblems - rowCount, 0);
  const nextCount = Math.min(rowCount, remaining);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Problems fixture</title></head><body><main><h1>Problems</h1><table><thead><tr><th>Solved</th><th>Source</th><th>Problem</th><th>Difficulty</th><th>Topic</th><th>Recommender</th><th>Feedback</th></tr></thead><tbody id="problem-table-body">${rows.join('')}</tbody></table><button type="button" aria-controls="problem-table-body" aria-label="Show ${nextCount} more problems">Show ${nextCount} more</button><p role="status" aria-live="polite">${rowCount} of ${HOMEPAGE_FIXTURE_BUDGETS.totalProblems} problems shown</p></main></body></html>`;
}

export function measureHomepageFixture(rowCount = HOMEPAGE_FIXTURE_BUDGETS.rows) {
  const html = renderHomepageTableFixture(rowCount);
  return {
    rows: rowCount,
    htmlBytes: Buffer.byteLength(html),
    gzipBytes: gzipSync(html, { level: 9 }).byteLength
  };
}

/**
 * @param {AssetSummary} summary
 * @param {FixtureSummary} fixture
 * @param {StaticBudgets} budgets
 * @param {FixtureBudgets} fixtureBudgets
 * @returns {string[]}
 */
export function budgetFailures(
  summary,
  fixture,
  budgets = STATIC_BUDGETS,
  fixtureBudgets = HOMEPAGE_FIXTURE_BUDGETS
) {
  const checks = [
    ['total immutable JS/CSS gzip', summary.totalGzipBytes, budgets.totalGzipBytes],
    [
      'largest immutable JavaScript gzip',
      summary.largestJavaScript?.gzipBytes ?? 0,
      budgets.largestJavaScriptGzipBytes
    ],
    ['largest immutable CSS gzip', summary.largestCss?.gzipBytes ?? 0, budgets.largestCssGzipBytes],
    ['initial homepage fixture HTML', fixture.htmlBytes, fixtureBudgets.htmlBytes],
    ['initial homepage fixture gzip', fixture.gzipBytes, fixtureBudgets.gzipBytes]
  ];
  return checks
    .filter(([, actual, budget]) => actual > budget)
    .map(([name, actual, budget]) => `${name}: ${actual} > ${budget} bytes`);
}
