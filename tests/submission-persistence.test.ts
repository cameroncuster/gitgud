import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSubmissionPersistence,
  type SubmissionClient
} from '../src/lib/submit/submissionPersistence.ts';
import type { ContestDraft, ProblemDraft } from '../src/lib/submit/types.ts';

type Response = { data: unknown; error: { message: string } | null };

function client(responses: Response[]) {
  const calls: Array<{ table: string; operation: string; value: unknown }> = [];
  const next = () => responses.shift() as Response;
  const mock: SubmissionClient = {
    from: (table) => ({
      select: () => ({
        eq: async (_column, value) => {
          calls.push({ table, operation: 'select', value });
          return next() as { data: { id?: string }[] | null; error: { message: string } | null };
        }
      }),
      insert: (draft) => {
        calls.push({ table, operation: 'insert', value: draft });
        return {
          select: () => ({
            single: async () =>
              next() as { data: { id?: string } | null; error: { message: string } | null }
          })
        };
      }
    })
  };
  return { mock, calls };
}

const problem: ProblemDraft = {
  name: 'Two Stones',
  tags: ['math'],
  difficulty: 800,
  url: 'https://codeforces.com/contest/1/problem/A',
  solved: 0,
  dateAdded: '2026-01-01T00:00:00.000Z',
  addedBy: 'tourist',
  addedByUrl: 'https://codeforces.com/profile/tourist',
  likes: 0,
  dislikes: 0
};

const contest: ContestDraft = {
  name: 'Round',
  url: 'https://codeforces.com/contest/1',
  durationSeconds: 7200,
  difficulty: 3,
  addedBy: 'tourist',
  addedByUrl: 'https://codeforces.com/profile/tourist',
  likes: 0,
  dislikes: 0,
  type: 'Codeforces'
};

test('equivalent problem URL checks preserve canonical and alternate duplicate messages', async () => {
  const canonical = client([{ data: [{ id: 'p' }], error: null }]);
  assert.deepEqual(
    await createSubmissionPersistence(canonical.mock).checkEquivalentProblemUrls('canonical', [
      'alternate'
    ]),
    { duplicate: true, message: 'Problem already exists in database' }
  );

  const alternate = client([
    { data: [], error: null },
    { data: [{ id: 'p' }], error: null }
  ]);
  assert.deepEqual(
    await createSubmissionPersistence(alternate.mock).checkEquivalentProblemUrls('canonical', [
      'alternate'
    ]),
    { duplicate: true, message: 'Problem already exists in database (with alternate URL)' }
  );
});

test('contest duplicate and database errors retain current result shapes', async () => {
  const duplicate = client([{ data: [{ id: 'c' }], error: null }]);
  assert.deepEqual(await createSubmissionPersistence(duplicate.mock).checkContest('contest'), {
    duplicate: true,
    message: 'Contest already exists in database'
  });

  const failed = client([{ data: null, error: { message: 'denied' } }]);
  assert.deepEqual(await createSubmissionPersistence(failed.mock).checkContest('contest'), {
    duplicate: false,
    error: 'Error checking if contest exists: denied',
    message: 'Error checking if contest exists: denied'
  });
});

test('problem insert maps snake case, includes optional difficulty, and returns id', async () => {
  const mock = client([
    { data: [], error: null },
    { data: { id: 'problem-id' }, error: null }
  ]);
  assert.deepEqual(await createSubmissionPersistence(mock.mock).insertProblem(problem), {
    success: true,
    id: 'problem-id'
  });
  assert.deepEqual(mock.calls[1], {
    table: 'problems',
    operation: 'insert',
    value: {
      name: 'Two Stones',
      tags: ['math'],
      difficulty: 800,
      url: problem.url,
      solved: 0,
      date_added: problem.dateAdded,
      added_by: 'tourist',
      added_by_url: problem.addedByUrl,
      likes: 0,
      dislikes: 0,
      type: undefined
    }
  });
});

test('optional difficulty is omitted and insert database errors are surfaced', async () => {
  const mock = client([
    { data: [], error: null },
    { data: null, error: { message: 'write denied' } }
  ]);
  const result = await createSubmissionPersistence(mock.mock).insertProblem({
    ...problem,
    difficulty: undefined
  });
  assert.deepEqual(result, { success: false, message: 'Database error: write denied' });
  assert.equal(
    Object.prototype.hasOwnProperty.call(mock.calls[1].value as object, 'difficulty'),
    false
  );
});

test('contest insert maps snake case and returns id', async () => {
  const mock = client([
    { data: [], error: null },
    { data: { id: 'contest-id' }, error: null }
  ]);
  assert.deepEqual(await createSubmissionPersistence(mock.mock).insertContest(contest), {
    success: true,
    id: 'contest-id'
  });
  assert.deepEqual(mock.calls[1].value, {
    name: 'Round',
    url: contest.url,
    type: 'Codeforces',
    duration_seconds: 7200,
    difficulty: 3,
    added_by: 'tourist',
    added_by_url: contest.addedByUrl,
    likes: 0,
    dislikes: 0
  });
});

test('contest insert omits undefined difficulty', async () => {
  const mock = client([
    { data: [], error: null },
    { data: { id: 'contest-id' }, error: null }
  ]);
  await createSubmissionPersistence(mock.mock).insertContest({
    ...contest,
    difficulty: undefined
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(mock.calls[1].value as object, 'difficulty'),
    false
  );
});

test('duplicate checks run again on insert and prevent writes', async () => {
  const mock = client([{ data: [{ id: 'existing' }], error: null }]);
  assert.deepEqual(await createSubmissionPersistence(mock.mock).insertProblem(problem), {
    success: false,
    message: 'Problem already exists in database'
  });
  assert.equal(
    mock.calls.some((call) => call.operation === 'insert'),
    false
  );
});

test('problem query errors and thrown database failures preserve messages', async () => {
  const queryFailure = client([{ data: null, error: { message: 'read denied' } }]);
  assert.deepEqual(
    await createSubmissionPersistence(queryFailure.mock).checkEquivalentProblemUrls('problem'),
    {
      duplicate: false,
      error: 'Database query error: read denied',
      message: 'Database query error: read denied'
    }
  );

  const throwing: SubmissionClient = {
    from: () => {
      throw new Error('client unavailable');
    }
  };
  assert.deepEqual(await createSubmissionPersistence(throwing).insertContest(contest), {
    success: false,
    message: 'client unavailable'
  });
});
