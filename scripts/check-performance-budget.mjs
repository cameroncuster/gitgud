#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HOMEPAGE_FIXTURE_BUDGETS,
  STATIC_BUDGETS,
  budgetFailures,
  collectImmutableAssets,
  measureHomepageFixture,
  summarizeAssets
} from './performance-budget.mjs';

const root = resolve(import.meta.dirname, '..');
const staticDirectory = resolve(root, '.vercel/output/static');

try {
  await access(staticDirectory);
} catch {
  console.error('Missing .vercel/output/static; run pnpm build before this check.');
  process.exitCode = 1;
  process.exit();
}

const summary = summarizeAssets(await collectImmutableAssets(staticDirectory));
const fixture = measureHomepageFixture();
const format = (bytes) => `${bytes.toLocaleString('en-US')} B`;

console.log(
  `Immutable JS/CSS: ${summary.assetCount} assets, ${format(summary.totalBytes)} raw, ${format(summary.totalGzipBytes)} gzip`
);
console.log(
  `Largest JS: ${summary.largestJavaScript?.path ?? 'none'} (${format(summary.largestJavaScript?.gzipBytes ?? 0)} gzip)`
);
console.log(
  `Largest CSS: ${summary.largestCss?.path ?? 'none'} (${format(summary.largestCss?.gzipBytes ?? 0)} gzip)`
);
console.log('Largest assets by gzip size:');
for (const asset of summary.largestAssets)
  console.log(`  ${format(asset.gzipBytes).padStart(12)}  ${asset.path}`);
console.log(
  `Homepage HTML fixture: ${fixture.rows} rows, ${format(fixture.htmlBytes)} raw, ${format(fixture.gzipBytes)} gzip`
);

const failures = budgetFailures(summary, fixture, STATIC_BUDGETS, HOMEPAGE_FIXTURE_BUDGETS);
if (failures.length > 0) {
  console.error('Performance budget exceeded:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Performance budgets passed.');
}
