import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleTableState,
  getDifficultyAriaSort,
  getDifficultySortLabel,
  getSortedAuthors,
  nextSortDirection,
  sortByDifficulty,
  sortByScore
} from '../src/lib/utils/table.ts';

type Item = {
  id?: string;
  likes: number;
  dislikes: number;
  difficulty?: number;
  addedBy: string;
};

const items: Item[] = [
  { id: 'z', likes: 5, dislikes: 2, difficulty: 3, addedBy: 'zoe' },
  { id: 'b', likes: 4, dislikes: 1, difficulty: undefined, addedBy: 'amy' },
  { id: 'a', likes: 3, dislikes: 0, difficulty: 1, addedBy: 'amy' },
  { id: 'low', likes: 1, dislikes: 2, difficulty: 5, addedBy: 'max' }
];

test('sortByScore orders by net score and breaks equal-score ties by ID', () => {
  assert.deepEqual(
    sortByScore(items, 'desc').map((item) => item.id),
    ['a', 'b', 'z', 'low']
  );
  assert.deepEqual(
    sortByScore(items, 'asc').map((item) => item.id),
    ['low', 'a', 'b', 'z']
  );
});

test('sortByScore preserves insertion order for tied items without two IDs', () => {
  const tied = [
    { ...items[0], id: undefined },
    { ...items[1], id: 'b' }
  ];

  assert.deepEqual(
    sortByScore(tied, 'desc').map((item) => item.id),
    [undefined, 'b']
  );
});

test('sorting returns a new array without mutating the input', () => {
  const originalOrder = items.map((item) => item.id);
  assert.notEqual(sortByScore(items, 'desc'), items);
  assert.deepEqual(
    items.map((item) => item.id),
    originalOrder
  );
});

test('sortByDifficulty treats missing difficulty as zero and supports reset sorting', () => {
  const resetCalls: (readonly Item[])[] = [];
  const reset = (values: readonly Item[]) => {
    resetCalls.push(values);
    return [...values].reverse();
  };

  assert.deepEqual(
    sortByDifficulty(items, 'asc', reset).map((item) => item.id),
    ['b', 'a', 'z', 'low']
  );
  assert.deepEqual(
    sortByDifficulty(items, 'desc', reset).map((item) => item.id),
    ['low', 'z', 'a', 'b']
  );
  assert.deepEqual(
    sortByDifficulty(items, null, reset).map((item) => item.id),
    ['low', 'a', 'b', 'z']
  );
  assert.equal(resetCalls.length, 1);
});

test('table state cycles through each value and wraps', () => {
  const states = ['all', 'included', 'excluded'] as const;
  assert.equal(cycleTableState('all', states), 'included');
  assert.equal(cycleTableState('included', states), 'excluded');
  assert.equal(cycleTableState('excluded', states), 'all');

  assert.equal(nextSortDirection(null), 'asc');
  assert.equal(nextSortDirection('asc'), 'desc');
  assert.equal(nextSortDirection('desc'), null);
});

test('difficulty sort accessibility state matches the next interaction', () => {
  assert.equal(getDifficultyAriaSort(null), 'none');
  assert.equal(getDifficultyAriaSort('asc'), 'ascending');
  assert.equal(getDifficultyAriaSort('desc'), 'descending');
  assert.match(getDifficultySortLabel(null), /not sorted.*sort ascending/i);
  assert.match(getDifficultySortLabel('asc'), /sorted ascending.*sort descending/i);
  assert.match(getDifficultySortLabel('desc'), /sorted descending.*clear sorting/i);
});

test('getSortedAuthors deduplicates derived authors and prefers provided options', () => {
  assert.deepEqual(getSortedAuthors(items), ['amy', 'max', 'zoe']);
  assert.deepEqual(getSortedAuthors(items, ['zoe', 'amy']), ['amy', 'zoe']);
  assert.deepEqual(getSortedAuthors(items, []), ['amy', 'max', 'zoe']);
});
