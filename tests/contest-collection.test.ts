import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Contest } from '../src/lib/queries/contestQueries.ts';
import { ContestCollection } from '../src/lib/collections/contestCollection.ts';

const contests: Contest[] = [
  contest('b', 'cf-bob', 'bob', 'Codeforces', 4, 1, 3),
  contest('a', 'cf-alice', 'alice', 'Codeforces', 4, 1, 1),
  contest('c', 'icpc-alice', 'alice', 'ICPC', 2, 0, undefined),
  contest('d', 'other-carol', 'carol', undefined, 0, 1, 5)
];

function contest(
  id: string,
  name: string,
  addedBy: string,
  type: string | undefined,
  likes: number,
  dislikes: number,
  difficulty: number | undefined
): Contest {
  return {
    id,
    name,
    url: `https://example.com/${id}`,
    durationSeconds: 7200,
    difficulty,
    dateAdded: '',
    addedBy,
    addedByUrl: '',
    likes,
    dislikes,
    type
  };
}

function ids(collection: ContestCollection): string[] {
  return collection.rows.map((item) => item.id ?? '');
}

test('contest collection applies every current filter together', () => {
  const participatedContestIds = new Set(['a', 'c']);
  const participationFilters = ['all', 'participated', 'not-participated'] as const;
  const typeFilters = ['all', 'icpc', 'codeforces'] as const;
  const authors = [null, 'alice', 'bob'] as const;

  for (const participationFilter of participationFilters) {
    for (const typeFilter of typeFilters) {
      for (const selectedAuthor of authors) {
        const collection = new ContestCollection({
          items: contests,
          participatedContestIds,
          participationFilter,
          typeFilter,
          selectedAuthor
        });
        const expected = contests
          .filter((contest) => {
            const participated = !!contest.id && participatedContestIds.has(contest.id);
            const participationMatches =
              participationFilter === 'all' ||
              !contest.id ||
              (participationFilter === 'participated' ? participated : !participated);
            const typeMatches =
              typeFilter === 'all' ||
              (typeFilter === 'icpc' ? contest.type === 'ICPC' : contest.type !== 'ICPC');
            return participationMatches && typeMatches;
          })
          .filter((contest) => !selectedAuthor || contest.addedBy === selectedAuthor)
          .sort((left, right) => {
            const score = right.likes - right.dislikes - (left.likes - left.dislikes);
            return score || (left.id ?? '').localeCompare(right.id ?? '');
          })
          .map((contest) => contest.id);

        assert.deepEqual(ids(collection), expected);
      }
    }
  }
});

test('contest type semantics classify every non-ICPC row as Codeforces', () => {
  let collection = new ContestCollection({ items: contests });
  collection = collection.cycleTypeFilter();
  assert.deepEqual(ids(collection), ['c']);
  collection = collection.cycleTypeFilter();
  assert.deepEqual(ids(collection), ['a', 'b', 'd']);
});

test('contest author options derive after participation and type filters but ignore author', () => {
  let collection = new ContestCollection({
    items: contests,
    participatedContestIds: new Set(['a', 'c'])
  });
  collection = collection.cycleParticipationFilter().cycleTypeFilter();
  assert.deepEqual(collection.availableAuthors, ['alice']);

  collection = collection.selectAuthor('bob');
  assert.deepEqual(collection.availableAuthors, ['alice']);
  assert.deepEqual(collection.rows, []);
});

test('contest participation filter cycles in the existing order', () => {
  let collection = new ContestCollection({
    items: contests,
    participatedContestIds: new Set(['a', 'c'])
  });
  collection = collection.cycleParticipationFilter();
  assert.deepEqual(ids(collection), ['a', 'c']);
  collection = collection.cycleParticipationFilter();
  assert.deepEqual(ids(collection), ['b', 'd']);
  collection = collection.cycleParticipationFilter();
  assert.equal(collection.participationFilter, 'all');
});

test('contest difficulty sorting cycles asc, desc, then stable default score order', () => {
  const tiedDifficulty = contests.map((contest) =>
    contest.id === 'a' || contest.id === 'b' ? { ...contest, difficulty: 2 } : contest
  );
  assert.deepEqual(
    ids(new ContestCollection({ items: tiedDifficulty }).cycleDifficultySort()).slice(1, 3),
    ['a', 'b']
  );

  let collection = new ContestCollection({ items: contests });
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

test('contest filter reset restores all filters and default ordering', () => {
  let collection = new ContestCollection({ items: contests });
  collection = collection.cycleParticipationFilter().cycleTypeFilter().selectAuthor('alice');
  collection = collection.cycleDifficultySort().resetFilters();

  assert.equal(collection.selectedAuthor, null);
  assert.equal(collection.participationFilter, 'all');
  assert.equal(collection.typeFilter, 'all');
  assert.equal(collection.difficultySortDirection, null);
  assert.deepEqual(ids(collection), ['a', 'b', 'c', 'd']);
});

test('contest collection handles empty input and never mutates supplied source data', () => {
  const source = contests.map((contest) => ({ ...contest }));
  const originalOrder = source.map((item) => item.id);
  const originalLikes = source[0].likes;
  const collection = new ContestCollection({ items: source });
  const updated = collection.replaceSourceItem({ ...source[0], likes: originalLikes + 1 });

  assert.deepEqual(new ContestCollection().rows, []);
  assert.deepEqual(new ContestCollection().availableAuthors, []);
  assert.notEqual(collection.sourceItems, source);
  collection.cycleTypeFilter().cycleDifficultySort();
  assert.deepEqual(
    source.map((item) => item.id),
    originalOrder
  );
  assert.equal(source[0].likes, originalLikes);
  assert.equal(updated.sourceItems.find((item) => item.id === 'b')?.likes, originalLikes + 1);
  assert.deepEqual(ids(updated), ['a', 'b', 'c', 'd']);
});
