import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createProblemQueries, type ProblemRecord } from '../src/lib/queries/problemQueries.ts';
import { createContestQueries, type ContestRecord } from '../src/lib/queries/contestQueries.ts';
import { createLeaderboardQueries } from '../src/lib/queries/leaderboardQueries.ts';

type DatabaseResult = { data: unknown; error: { code?: string } | null };
type Operation = { table: string; column?: string; value?: unknown };

function queryClient(results: DatabaseResult[]) {
  const calls: Operation[] = [];
  const next = () => results.shift() as DatabaseResult;
  const client = {
    from: (table: string) => ({
      select: (columns: string) => {
        calls.push({ table, value: columns });
        const result = {
          eq: (column: string, value: unknown) => {
            calls.push({ table, column, value });
            return {
              single: async () => next(),
              then: <T>(resolve: (value: DatabaseResult) => T | PromiseLike<T>) =>
                Promise.resolve(next()).then(resolve)
            };
          },
          then: <T>(resolve: (value: DatabaseResult) => T | PromiseLike<T>) =>
            Promise.resolve(next()).then(resolve)
        };
        return result;
      }
    }),
    rpc: async (name: string, parameters?: unknown) => {
      calls.push({ table: `rpc:${name}`, value: parameters });
      return next();
    }
  } as unknown as SupabaseClient;
  return { client, calls };
}

const problemRecord: ProblemRecord = {
  id: 'p1',
  name: 'Problem',
  difficulty: 1200,
  url: 'https://open.kattis.com/problems/hello',
  added_by: 'alice',
  added_by_url: 'https://example.test/alice',
  likes: 0,
  dislikes: 0,
  type: 'Kattis'
};

const contestRecord: ContestRecord = {
  id: 'c1',
  name: 'Round',
  url: 'https://codeforces.com/contest/1',
  duration_seconds: 7200,
  difficulty: 3,
  date_added: '2026-01-01',
  added_by: 'alice',
  added_by_url: 'https://example.test/alice',
  likes: 0,
  dislikes: 0,
  type: 'Codeforces'
};

test('problem queries map records, bind actor IDs, and preserve set semantics', async () => {
  const database = queryClient([
    { data: [problemRecord], error: null },
    { data: problemRecord, error: null },
    { data: [{ problem_id: 'p1', feedback_type: 'like' }], error: null },
    { data: [{ problem_id: 'p1' }, { problem_id: 'p1' }, { problem_id: 'p2' }], error: null },
    { data: [{ problem_id: 'p3' }], error: null }
  ]);
  const queries = createProblemQueries({
    client: database.client,
    getCurrentUser: () => ({ id: 'actor' }),
    resolveProblemSource: () => 'kattis'
  });

  const result = await queries.fetchProblemsResult();
  assert.equal(result.successful, true);
  const problems = result.problems;
  assert.deepEqual(problems[0], {
    id: 'p1',
    name: 'Problem',
    difficulty: 1200,
    url: problemRecord.url,
    addedBy: 'alice',
    addedByUrl: 'https://example.test/alice',
    likes: 0,
    dislikes: 0,
    source: 'kattis',
    type: 'Kattis'
  });
  assert.equal((await queries.fetchProblemById('p1'))?.id, 'p1');
  assert.equal(database.calls[0].value, database.calls[1].value);
  assert.doesNotMatch(String(database.calls[0].value), /tags|solved|date_added/);
  assert.deepEqual(await queries.fetchProblemFeedback(), { p1: 'like' });
  assert.deepEqual([...(await queries.fetchSolvedProblems())], ['p1', 'p2']);
  assert.deepEqual([...(await queries.fetchSolvedProblemsForUser('other'))], ['p3']);
  assert.ok(database.calls.some((call) => call.column === 'user_id' && call.value === 'actor'));
  assert.deepEqual(database.calls.at(-1), {
    table: 'rpc:get_user_solved_problems',
    value: { p_user_id: 'other' }
  });
});

test('problem list mapping normalizes nullable optional fields', async () => {
  const database = queryClient([
    { data: [{ ...problemRecord, difficulty: null, type: null }], error: null }
  ]);
  const result = await createProblemQueries({
    client: database.client,
    getCurrentUser: () => null,
    resolveProblemSource: () => 'kattis'
  }).fetchProblems();
  assert.equal(result[0].difficulty, undefined);
  assert.equal(result[0].type, undefined);
});

test('problem list results distinguish successful empty reads and preserve the array API', async () => {
  const database = queryClient([
    { data: [], error: null },
    { data: [problemRecord], error: null }
  ]);
  const queries = createProblemQueries({
    client: database.client,
    getCurrentUser: () => null,
    resolveProblemSource: () => 'codeforces'
  });
  assert.deepEqual(await queries.fetchProblemsResult(), { successful: true, problems: [] });
  assert.deepEqual(await queries.fetchProblems(), [
    {
      id: 'p1',
      name: 'Problem',
      difficulty: 1200,
      url: problemRecord.url,
      addedBy: 'alice',
      addedByUrl: 'https://example.test/alice',
      likes: 0,
      dislikes: 0,
      source: 'codeforces',
      type: 'Kattis'
    }
  ]);
});

test('problem by ID preserves an undefined no-data result', async () => {
  const database = queryClient([{ data: null, error: null }]);
  const queries = createProblemQueries({
    client: database.client,
    getCurrentUser: () => ({ id: 'actor' }),
    resolveProblemSource: () => 'codeforces'
  });
  assert.equal(await queries.fetchProblemById('missing'), undefined);
});

test('problem queries short-circuit anonymous and empty-user reads', async () => {
  const database = queryClient([]);
  const queries = createProblemQueries({
    client: database.client,
    getCurrentUser: () => null,
    resolveProblemSource: () => 'codeforces'
  });
  assert.deepEqual(await queries.fetchProblemFeedback(), {});
  assert.deepEqual([...(await queries.fetchSolvedProblems())], []);
  assert.deepEqual([...(await queries.fetchSolvedProblemsForUser(''))], []);
  assert.equal(database.calls.length, 0);
});

test('problem queries return safe empty values for database and thrown failures', async () => {
  const failed = queryClient([
    { data: null, error: { code: 'read-failed' } },
    { data: null, error: { code: 'read-failed' } },
    { data: null, error: { code: 'read-failed' } },
    { data: null, error: { code: 'read-failed' } },
    { data: null, error: { code: 'read-failed' } }
  ]);
  const queries = createProblemQueries({
    client: failed.client,
    getCurrentUser: () => ({ id: 'actor' }),
    resolveProblemSource: () => 'codeforces'
  });
  assert.deepEqual(await queries.fetchProblemsResult(), { successful: false, problems: [] });
  assert.equal(await queries.fetchProblemById('p'), undefined);
  await assert.rejects(() => queries.fetchProblemFeedback(), /Failed to load problem feedback/);
  assert.deepEqual([...(await queries.fetchSolvedProblems())], []);
  assert.deepEqual([...(await queries.fetchSolvedProblemsForUser('other'))], []);

  const throwing = createProblemQueries({
    client: {
      from: () => {
        throw new Error('offline');
      },
      rpc: () => {
        throw new Error('offline');
      }
    } as unknown as SupabaseClient,
    getCurrentUser: () => ({ id: 'actor' }),
    resolveProblemSource: () => 'codeforces'
  });
  assert.deepEqual(await throwing.fetchProblemsResult(), { successful: false, problems: [] });
  assert.equal(await throwing.fetchProblemById('p'), undefined);
  await assert.rejects(() => throwing.fetchProblemFeedback(), /offline/);
  assert.deepEqual([...(await throwing.fetchSolvedProblems())], []);
  assert.deepEqual([...(await throwing.fetchSolvedProblemsForUser('other'))], []);
});

test('contest queries map catalog, participation, and feedback data', async () => {
  const database = queryClient([
    { data: [contestRecord], error: null },
    { data: [{ contest_id: 'c1' }, { contest_id: 'c1' }, { contest_id: 'c2' }], error: null },
    { data: [{ contest_id: 'c1', feedback_type: 'dislike' }], error: null }
  ]);
  const queries = createContestQueries({
    client: database.client,
    getCurrentUser: () => ({ id: 'actor' })
  });
  assert.deepEqual((await queries.fetchContests())[0], {
    id: 'c1',
    name: 'Round',
    url: contestRecord.url,
    durationSeconds: 7200,
    difficulty: 3,
    dateAdded: '2026-01-01',
    addedBy: 'alice',
    addedByUrl: 'https://example.test/alice',
    likes: 0,
    dislikes: 0,
    type: 'Codeforces'
  });
  assert.deepEqual([...(await queries.fetchContestParticipation())], ['c1', 'c2']);
  assert.deepEqual(await queries.fetchContestFeedback(), { c1: 'dislike' });
});

test('contest queries protect anonymous users and database failures', async () => {
  const anonymousDatabase = queryClient([]);
  const anonymous = createContestQueries({
    client: anonymousDatabase.client,
    getCurrentUser: () => null
  });
  assert.deepEqual([...(await anonymous.fetchContestParticipation())], []);
  assert.deepEqual(await anonymous.fetchContestFeedback(), {});
  assert.equal(anonymousDatabase.calls.length, 0);

  const failed = queryClient([
    { data: null, error: { code: 'failed' } },
    { data: null, error: { code: 'failed' } },
    { data: null, error: { code: 'failed' } }
  ]);
  const queries = createContestQueries({
    client: failed.client,
    getCurrentUser: () => ({ id: 'a' })
  });
  assert.deepEqual(await queries.fetchContests(), []);
  assert.deepEqual([...(await queries.fetchContestParticipation())], []);
  assert.deepEqual(await queries.fetchContestFeedback(), {});

  const throwing = createContestQueries({
    client: {
      from: () => {
        throw new Error('offline');
      }
    } as unknown as SupabaseClient,
    getCurrentUser: () => ({ id: 'actor' })
  });
  assert.deepEqual(await throwing.fetchContests(), []);
  assert.deepEqual([...(await throwing.fetchContestParticipation())], []);
  assert.deepEqual(await throwing.fetchContestFeedback(), {});
});

test('leaderboard query maps RPC fields and contains database failures', async () => {
  const success = queryClient([
    {
      data: [
        {
          user_id: 'u1',
          username: 'alice',
          avatar_url: 'avatar',
          github_url: 'github',
          problems_solved: 5,
          earliest_solves_sum: 10,
          rank: 1
        }
      ],
      error: null
    }
  ]);
  assert.deepEqual(await createLeaderboardQueries(success.client).fetchLeaderboard(), [
    {
      userId: 'u1',
      username: 'alice',
      avatarUrl: 'avatar',
      githubUrl: 'github',
      problemsSolved: 5,
      earliestSolvesSum: 10,
      rank: 1
    }
  ]);

  const failed = queryClient([{ data: null, error: { code: 'denied' } }]);
  assert.deepEqual(await createLeaderboardQueries(failed.client).fetchLeaderboard(), []);
  const throwing = createLeaderboardQueries({
    rpc: () => {
      throw new Error('offline');
    }
  } as unknown as SupabaseClient);
  assert.deepEqual(await throwing.fetchLeaderboard(), []);
});
