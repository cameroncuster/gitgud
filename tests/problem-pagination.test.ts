import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  initialProblemVisibleCount,
  nextProblemBatchCount,
  nextProblemVisibleCount
} from '../src/lib/components/problemPagination.ts';

test('problem pagination advances in bounded batches', () => {
  assert.equal(initialProblemVisibleCount(50), 50);
  assert.equal(initialProblemVisibleCount(null), Number.POSITIVE_INFINITY);
  assert.equal(nextProblemVisibleCount(50, 121, 50), 100);
  assert.equal(nextProblemVisibleCount(100, 121, 50), 121);
  assert.equal(nextProblemBatchCount(50, 121, 50), 50);
  assert.equal(nextProblemBatchCount(100, 121, 50), 21);
  assert.equal(nextProblemBatchCount(121, 121, 50), 0);
});

test('ProblemDisplay slices derived rows and resets only from filter and sort handlers', () => {
  const source = readFileSync('src/lib/components/ProblemDisplay.svelte', 'utf8');
  assert.match(source, /\$: fullRows = collection\.rows;/);
  assert.match(source, /\$: visibleRows = fullRows\.slice\(0, visibleRowCount\);/);

  for (const handler of [
    'handleTopicSelect',
    'handleDifficultySort',
    'handleSolvedFilter',
    'handleAuthorFilter',
    'handleSourceFilter'
  ]) {
    assert.match(source, new RegExp(`function ${handler}\\([\\s\\S]*?resetVisibleRows\\(\\);`));
  }

  for (const handler of ['handleLike', 'handleToggleSolved']) {
    const body = source.match(new RegExp(`function ${handler}\\([\\s\\S]*?\\n}`))?.[0] ?? '';
    assert.doesNotMatch(body, /resetVisibleRows/);
  }
});

test('homepage opts into batches while profile pages retain the unlimited default', () => {
  const homepage = readFileSync('src/routes/+page.svelte', 'utf8');
  const profile = readFileSync('src/routes/user/[userId]/+page.svelte', 'utf8');
  assert.match(homepage, /rowBatchSize=\{50\}/);
  assert.doesNotMatch(profile, /rowBatchSize/);
});

test('show-more markup links a real button to the problem tbody and announces progress', () => {
  const display = readFileSync('src/lib/components/ProblemDisplay.svelte', 'utf8');
  const table = readFileSync('src/lib/components/ProblemTable.svelte', 'utf8');
  assert.match(table, /<tbody id=\{bodyId\}>/);
  assert.match(display, /type="button"/);
  assert.match(display, /aria-controls=\{problemTableBodyId\}/);
  assert.match(display, /`Show \$\{nextBatchCount\} more problems`/);
  assert.match(display, /role="status"/);
  assert.match(display, /aria-live="polite"/);
  assert.match(display, /aria-disabled=\{nextBatchCount === 0\}/);
});
