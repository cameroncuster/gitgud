import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { formatDuration } from '../src/lib/contests/formatDuration.ts';
import { ProblemCollection } from '../src/lib/collections/problemCollection.ts';
import { ContestCollection } from '../src/lib/collections/contestCollection.ts';
import { createProviderAdapters, providerOrder } from '../src/lib/submit/providers/index.ts';
import { problemEngagementGateway } from '../src/lib/problems/problemEngagementGateway.supabase.ts';
import { contestEngagementGateway } from '../src/lib/contests/contestEngagementGateway.supabase.ts';
import { fetchProblemFeedback, fetchSolvedProblems } from '../src/lib/queries/problemQueries.ts';
import {
  fetchContestFeedback,
  fetchContestParticipation
} from '../src/lib/queries/contestQueries.ts';
import { fetchUserPreferences, updateUserPreferences } from '../src/lib/services/user.ts';
import { _createContestsLoad } from '../src/routes/contests/+page.server.ts';
import { _createLeaderboardLoad } from '../src/routes/leaderboard/+page.server.ts';
import { load as codeforcesLoad } from '../src/routes/submit/codeforces/+page.ts';
import { load as kattisLoad } from '../src/routes/submit/kattis/+page.ts';
import { load as userLoad } from '../src/routes/user/[userId]/+page.ts';
import type { Contest } from '../src/lib/queries/contestQueries.ts';
import type { LeaderboardEntry } from '../src/lib/queries/leaderboardQueries.ts';
import type { Problem } from '../src/lib/queries/problemQueries.ts';

const problem = (id: string, likes: number): Problem => ({
  id,
  name: id,
  url: `https://codeforces.com/contest/1/problem/${id}`,
  addedBy: 'actor',
  addedByUrl: '',
  likes,
  dislikes: 0,
  source: 'codeforces'
});

const contest = (id: string, likes: number): Contest => ({
  id,
  name: id,
  url: `https://codeforces.com/contest/${id}`,
  durationSeconds: 3600,
  dateAdded: '',
  addedBy: 'actor',
  addedByUrl: '',
  likes,
  dislikes: 0
});

test('formatDuration preserves minute and hour boundaries', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(59), '0m');
  assert.equal(formatDuration(60), '1m');
  assert.equal(formatDuration(3599), '59m');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(3660), '1h 1m');
  assert.equal(formatDuration(7200), '2h');
});

test('route load factories return fetched data once', async () => {
  const contests = [contest('1', 1)];
  const entries: LeaderboardEntry[] = [
    {
      userId: 'u1',
      username: 'actor',
      avatarUrl: '',
      githubUrl: '',
      problemsSolved: 1,
      earliestSolvesSum: 1,
      rank: 1
    }
  ];
  const loadContests = mock.fn(async () => contests);
  const loadLeaderboard = mock.fn(async () => entries);
  let contestHeaders: Record<string, string> = {};
  assert.deepEqual(
    await _createContestsLoad(loadContests)({
      setHeaders: (headers) => (contestHeaders = headers)
    }),
    { contests }
  );
  assert.equal(contestHeaders['cache-control'], 'no-store');
  assert.deepEqual(await _createLeaderboardLoad(loadLeaderboard)(), { entries });
  assert.equal(loadContests.mock.callCount(), 1);
  assert.equal(loadLeaderboard.mock.callCount(), 1);
});

test('legacy provider routes redirect and user route preserves its parameter', () => {
  for (const [routeLoad, provider] of [
    [codeforcesLoad, 'codeforces'],
    [kattisLoad, 'kattis']
  ] as const) {
    assert.throws(
      () => routeLoad({} as never),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 307 &&
        'location' in error &&
        error.location === `/submit?provider=${provider}`
    );
  }
  assert.deepEqual(userLoad({ params: { userId: 'actor-1' } } as never), {
    userId: 'actor-1'
  });
});

test('provider composition exposes concrete adapters in stable display order', () => {
  const adapters = createProviderAdapters();
  assert.deepEqual(providerOrder, ['codeforces', 'kattis', 'dmoj']);
  assert.equal(adapters.codeforces.id, 'codeforces');
  assert.equal(adapters.kattis.id, 'kattis');
  assert.equal(adapters.dmoj.id, 'dmoj');
  assert.match(adapters.codeforces.placeholder, /codeforces\.com/);
  assert.match(adapters.kattis.placeholder, /kattis/);
  assert.match(adapters.dmoj.placeholder, /dmoj\.ca/);
  assert.equal(adapters.codeforces.extract('https://codeforces.com/contest/1/problem/A').length, 1);
  assert.equal(adapters.kattis.extract('open.kattis.com/problems/hello').length, 1);
  assert.equal(adapters.dmoj.extract('https://dmoj.ca/problem/ciw26p2').length, 1);
});

test('composed singleton services preserve anonymous read and write guards', async () => {
  assert.deepEqual(await fetchProblemFeedback(), {});
  assert.deepEqual([...(await fetchSolvedProblems())], []);
  assert.deepEqual(await fetchContestFeedback(), {});
  assert.deepEqual([...(await fetchContestParticipation())], []);
  assert.equal(await fetchUserPreferences(), null);
  assert.equal(await updateUserPreferences({ hideFromLeaderboard: false, theme: 'dark' }), false);
  assert.deepEqual(await problemEngagementGateway.loadFeedback(), {});
  assert.deepEqual([...(await problemEngagementGateway.loadSolvedProblemIds())], []);
  assert.deepEqual(await contestEngagementGateway.loadFeedback(), {});
  assert.deepEqual([...(await contestEngagementGateway.loadParticipatedContestIds())], []);
  assert.equal(await problemEngagementGateway.setSolved('p', true), false);
  assert.equal(
    await problemEngagementGateway.updateFeedback('p', true, {
      userId: 'actor',
      accessToken: 'token'
    }),
    null
  );
  assert.equal(await contestEngagementGateway.setParticipation('c', true), false);
  assert.equal(await contestEngagementGateway.updateFeedback('c', true), null);
});

test('collection source replacement sorts new rows and preserves active filters', () => {
  const problems = new ProblemCollection({
    items: [problem('old', 1)],
    selectedAuthor: 'actor',
    sourceFilter: 'codeforces'
  }).withSourceItems([problem('low', 1), problem('high', 5)]);
  assert.deepEqual(
    problems.rows.map((row) => row.id),
    ['high', 'low']
  );
  assert.equal(problems.selectedAuthor, 'actor');
  assert.equal(problems.sourceFilter, 'codeforces');

  const contests = new ContestCollection({
    items: [contest('old', 1)],
    selectedAuthor: 'actor',
    typeFilter: 'codeforces'
  }).withSourceItems([contest('low', 1), contest('high', 5)]);
  assert.deepEqual(
    contests.rows.map((row) => row.id),
    ['high', 'low']
  );
  assert.equal(contests.selectedAuthor, 'actor');
  assert.equal(contests.typeFilter, 'codeforces');
});
