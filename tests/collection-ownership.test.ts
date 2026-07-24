import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const readSource = (path: string) => readFileSync(join(directory, '..', path), 'utf8');

const problemTable = readSource('src/lib/components/ProblemTable.svelte');
const contestTable = readSource('src/lib/components/ContestTable.svelte');
const problemDisplay = readSource('src/lib/components/ProblemDisplay.svelte');
const contestPage = readSource('src/routes/contests/+page.svelte');

test('catalog tables are controlled renderers without collection decisions', () => {
  for (const source of [problemTable, contestTable]) {
    assert.doesNotMatch(source, /createEventDispatcher/);
    assert.doesNotMatch(source, /\.filter\(\(problem|\.filter\(\(contest/);
    assert.doesNotMatch(source, /cycleTableState|nextSortDirection|sortByDifficulty|sortByScore/);
  }
  assert.doesNotMatch(contestTable, /filteredContests/);
});

test('catalog callers delegate collection decisions to domain owners', () => {
  assert.match(problemDisplay, /new ProblemCollection/);
  assert.match(contestPage, /new ContestCollection/);
  assert.doesNotMatch(problemDisplay, /getProblemsWithoutAuthorFilter|filterProblems\(/);
  assert.doesNotMatch(contestPage, /getContestsWithoutAuthorFilter|updateFilters\(/);
});
