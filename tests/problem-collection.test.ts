import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Problem } from '../src/lib/queries/problemQueries.ts';
import {
  NEW_PROBLEM_TOPIC,
  PROBLEM_TOPICS,
  ProblemCollection
} from '../src/lib/collections/problemCollection.ts';

const problems: Problem[] = [
  problem('b', 'graph-cf-bob', 'bob', 'graph', 'codeforces', 4, 1, 2000),
  problem('a', 'graph-cf-alice', 'alice', 'graph', 'codeforces', 4, 1, 1000),
  problem('c', 'misc-kattis-alice', 'alice', 'misc', 'kattis', 2, 0, undefined),
  problem('d', 'new-kattis-carol', 'carol', undefined, 'kattis', 0, 1, 3000)
];

function problem(
  id: string,
  name: string,
  addedBy: string,
  type: string | undefined,
  source: Problem['source'],
  likes: number,
  dislikes: number,
  difficulty: number | undefined
): Problem {
  return {
    id,
    name,
    tags: type ? [type] : [],
    difficulty,
    url: `https://example.com/${id}`,
    solved: 0,
    dateAdded: '',
    addedBy,
    addedByUrl: '',
    likes,
    dislikes,
    source,
    type
  };
}

function ids(collection: ProblemCollection): string[] {
  return collection.rows.map((item) => item.id ?? '');
}

test('problem collection applies every current filter together', () => {
  const solvedProblemIds = new Set(['a', 'c']);
  const topics = [null, 'graph', 'misc', NEW_PROBLEM_TOPIC] as const;
  const solvedFilters = ['all', 'solved', 'unsolved'] as const;
  const sourceFilters = ['all', 'codeforces', 'kattis'] as const;
  const authors = [null, 'alice', 'bob'] as const;

  for (const selectedTopic of topics) {
    for (const solvedFilter of solvedFilters) {
      for (const sourceFilter of sourceFilters) {
        for (const selectedAuthor of authors) {
          const collection = new ProblemCollection({
            items: problems,
            solvedProblemIds,
            selectedTopic,
            solvedFilter,
            sourceFilter,
            selectedAuthor
          });
          const expected = problems
            .filter((problem) => {
              const topicMatches =
                selectedTopic === null ||
                (selectedTopic === NEW_PROBLEM_TOPIC
                  ? !problem.type
                  : selectedTopic === 'misc'
                    ? !problem.type || problem.type === 'misc'
                    : problem.type === selectedTopic);
              const solved = !!problem.id && solvedProblemIds.has(problem.id);
              const solvedMatches =
                solvedFilter === 'all' || (solvedFilter === 'solved' ? solved : !solved);
              const sourceMatches = sourceFilter === 'all' || problem.source === sourceFilter;
              return topicMatches && solvedMatches && sourceMatches;
            })
            .filter((problem) => !selectedAuthor || problem.addedBy === selectedAuthor)
            .sort((left, right) => {
              const score = right.likes - right.dislikes - (left.likes - left.dislikes);
              return score || (left.id ?? '').localeCompare(right.id ?? '');
            })
            .map((problem) => problem.id);

          assert.deepEqual(ids(collection), expected);
        }
      }
    }
  }
});

test('problem topic semantics distinguish NEW and include untyped rows in misc', () => {
  const collection = new ProblemCollection({ items: problems });
  assert.deepEqual(ids(collection.selectTopic(NEW_PROBLEM_TOPIC)), ['d']);
  assert.deepEqual(ids(collection.selectTopic('misc')), ['c', 'd']);
  assert.deepEqual(collection.topicOptions, PROBLEM_TOPICS);
});

test('problem author options derive after all non-author filters', () => {
  let collection = new ProblemCollection({
    items: problems,
    solvedProblemIds: new Set(['a', 'c'])
  });
  collection = collection.cycleSolvedFilter();
  collection = collection.cycleSourceFilter();
  assert.deepEqual(collection.availableAuthors, ['alice']);

  collection = collection.selectAuthor('bob');
  assert.deepEqual(collection.availableAuthors, ['alice']);
  assert.deepEqual(collection.rows, []);
});

test('problem solved and source filters cycle in the existing order', () => {
  let collection = new ProblemCollection({
    items: problems,
    solvedProblemIds: new Set(['a', 'c'])
  });
  collection = collection.cycleSolvedFilter();
  assert.deepEqual(ids(collection), ['a', 'c']);
  collection = collection.cycleSolvedFilter();
  assert.deepEqual(ids(collection), ['b', 'd']);
  collection = collection.cycleSolvedFilter();
  assert.equal(collection.solvedFilter, 'all');

  collection = collection.cycleSourceFilter();
  assert.deepEqual(ids(collection), ['a', 'b']);
  collection = collection.cycleSourceFilter();
  assert.deepEqual(ids(collection), ['c', 'd']);
  collection = collection.cycleSourceFilter();
  assert.equal(collection.sourceFilter, 'all');
});

test('problem difficulty sorting cycles asc, desc, then stable default score order', () => {
  const tiedDifficulty = problems.map((problem) =>
    problem.id === 'a' || problem.id === 'b' ? { ...problem, difficulty: 1500 } : problem
  );
  assert.deepEqual(
    ids(new ProblemCollection({ items: tiedDifficulty }).cycleDifficultySort()).slice(1, 3),
    ['a', 'b']
  );

  let collection = new ProblemCollection({ items: problems });
  assert.equal(collection.sortKey, 'score');
  assert.deepEqual(ids(collection), ['a', 'b', 'c', 'd']);
  collection = collection.cycleDifficultySort();
  assert.equal(collection.sortKey, 'difficulty');
  assert.deepEqual(ids(collection), ['c', 'a', 'b', 'd']);
  collection = collection.cycleDifficultySort();
  assert.deepEqual(ids(collection), ['d', 'b', 'a', 'c']);
  collection = collection.cycleDifficultySort();
  assert.equal(collection.sortKey, 'score');
  assert.deepEqual(ids(collection), ['a', 'b', 'c', 'd']);
});

test('problem filter reset restores its configured default and default ordering', () => {
  let collection = new ProblemCollection({
    items: problems,
    solvedProblemIds: new Set(['a', 'c']),
    defaultSolvedFilter: 'solved'
  });
  collection = collection.selectTopic('graph').selectAuthor('alice').cycleSourceFilter();
  collection = collection.cycleDifficultySort();
  collection = collection.resetFilters();

  assert.equal(collection.selectedTopic, null);
  assert.equal(collection.selectedAuthor, null);
  assert.equal(collection.sourceFilter, 'all');
  assert.equal(collection.solvedFilter, 'solved');
  assert.equal(collection.difficultySortDirection, null);
  assert.deepEqual(ids(collection), ['a', 'c']);
});

test('problem collection handles empty input and never mutates supplied source data', () => {
  const source = problems.map((problem) => ({ ...problem }));
  const originalOrder = source.map((item) => item.id);
  const originalLikes = source[0].likes;
  const collection = new ProblemCollection({ items: source });
  const updated = collection.updateSourceItem('b', (problem) => ({
    ...problem,
    likes: problem.likes + 1
  }));

  assert.deepEqual(new ProblemCollection().rows, []);
  assert.deepEqual(new ProblemCollection().availableAuthors, []);
  assert.notEqual(collection.sourceItems, source);
  collection.selectTopic('graph').cycleDifficultySort();
  assert.deepEqual(
    source.map((item) => item.id),
    originalOrder
  );
  assert.equal(source[0].likes, originalLikes);
  assert.equal(updated.sourceItems.find((item) => item.id === 'b')?.likes, originalLikes + 1);
  assert.deepEqual(ids(updated), ['a', 'b', 'c', 'd']);
});
