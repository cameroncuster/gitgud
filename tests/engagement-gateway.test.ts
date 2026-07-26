import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProblemEngagementGateway,
  type ProblemEngagementClient
} from '../src/lib/problems/problemEngagementGateway.ts';
import {
  createContestEngagementGateway,
  type ContestEngagementClient
} from '../src/lib/contests/contestEngagementGateway.ts';
type Call = { name: string; value: unknown };
type DeleteResponse = { data: null; error: { code?: string } | null };
type DeleteResult = PromiseLike<DeleteResponse> & {
  eq: (column: string, value: string) => DeleteResult;
};

function deleteQuery(calls: Call[], error: { code?: string } | null = null): DeleteResult {
  const promise = Promise.resolve({ data: null, error });
  const result: DeleteResult = {
    eq(column: string, value: string): DeleteResult {
      calls.push({ name: `eq:${column}`, value });
      return result;
    },
    then: promise.then.bind(promise)
  };
  return result;
}

test('problem gateway preserves RPC params and solved persistence', async () => {
  const calls: Call[] = [];
  const feedbackTokens: string[] = [];
  let insertError: { code?: string } | null = null;
  const client: ProblemEngagementClient = {
    from: (table) => ({
      insert: async (value) => {
        calls.push({ name: `insert:${table}`, value });
        return { data: null, error: insertError };
      },
      delete: () => {
        calls.push({ name: `delete:${table}`, value: null });
        return deleteQuery(calls);
      }
    }),
    rpc: async (name, value) => {
      calls.push({ name, value });
      return { data: [{ id: 'p' }], error: null };
    }
  };
  const gateway = createProblemEngagementGateway({
    client,
    getCurrentUser: () => ({ id: 'actor' }),
    loadFeedback: async () => ({}),
    loadSolvedProblemIds: async () => new Set(),
    createFeedbackClient: (accessToken) => {
      feedbackTokens.push(accessToken);
      return client;
    },
    mapProblemRecord: (record) => ({
      id: record.id,
      name: 'mapped',
      url: '',
      addedBy: '',
      addedByUrl: '',
      likes: 0,
      dislikes: 0,
      source: 'codeforces'
    })
  });
  assert.equal(
    (
      await gateway.updateFeedback('p', true, {
        userId: 'actor',
        accessToken: 'initiating-token'
      })
    )?.name,
    'mapped'
  );
  assert.deepEqual(feedbackTokens, ['initiating-token']);
  assert.deepEqual(calls[0], {
    name: 'update_problem_feedback',
    value: { p_problem_id: 'p', p_is_like: true }
  });
  assert.equal(await gateway.setSolved('p', true), true);
  assert.deepEqual(calls[1].value, { user_id: 'actor', problem_id: 'p' });
  assert.equal(await gateway.setSolved('p', false), true);
  assert.deepEqual(calls.slice(3, 5), [
    { name: 'eq:user_id', value: 'actor' },
    { name: 'eq:problem_id', value: 'p' }
  ]);
  insertError = { code: '23505' };
  assert.equal(await gateway.setSolved('p', true), true);
  insertError = { code: 'write-failed' };
  assert.equal(await gateway.setSolved('p', true), false);
});

test('problem gateway rejects anonymous writes before touching the client', async () => {
  let calls = 0;
  const client: ProblemEngagementClient = {
    from: () => {
      calls++;
      throw new Error('must not query');
    },
    rpc: async () => {
      calls++;
      return { data: [], error: null };
    }
  };
  const gateway = createProblemEngagementGateway({
    client,
    getCurrentUser: () => null,
    loadFeedback: async () => ({}),
    loadSolvedProblemIds: async () => new Set(),
    createFeedbackClient: () => {
      calls++;
      return client;
    },
    mapProblemRecord: () => {
      throw new Error('must not map');
    }
  });
  assert.equal(await gateway.setSolved('p', true), false);
  assert.equal(
    await gateway.updateFeedback('p', true, { userId: 'actor', accessToken: 'token' }),
    null
  );
  assert.equal(calls, 0);
});

test('problem gateway contains delete, RPC, and thrown client failures', async () => {
  let mode: 'delete' | 'rpc' | 'throw' = 'delete';
  const client: ProblemEngagementClient = {
    from: () => {
      if (mode === 'throw') throw new Error('offline');
      return {
        insert: async () => ({ data: null, error: null }),
        delete: () => deleteQuery([], { code: 'delete-failed' })
      };
    },
    rpc: async () => {
      if (mode === 'throw') throw new Error('offline');
      return { data: [{ id: 'p' }], error: mode === 'rpc' ? { code: 'rpc-failed' } : null };
    }
  };
  const gateway = createProblemEngagementGateway({
    client,
    getCurrentUser: () => ({ id: 'actor' }),
    loadFeedback: async () => ({}),
    loadSolvedProblemIds: async () => new Set(),
    createFeedbackClient: () => client,
    mapProblemRecord: () => {
      throw new Error('mapping failed');
    }
  });
  const actor = { userId: 'actor', accessToken: 'token' };
  assert.equal(await gateway.setSolved('p', false), false);
  mode = 'rpc';
  assert.equal(await gateway.updateFeedback('p', true, actor), null);
  mode = 'throw';
  assert.equal(await gateway.setSolved('p', true), false);
  assert.equal(await gateway.updateFeedback('p', true, actor), null);
});

test('problem gateway maps null/error RPC to null', async () => {
  let rpcError: { code?: string } | null = null;
  const client: ProblemEngagementClient = {
    from: () => ({
      insert: async () => ({ data: null, error: null }),
      delete: () => deleteQuery([])
    }),
    rpc: async () => ({ data: null, error: rpcError })
  };
  const gateway = createProblemEngagementGateway({
    client,
    getCurrentUser: () => ({ id: 'actor' }),
    loadFeedback: async () => ({}),
    loadSolvedProblemIds: async () => new Set(),
    createFeedbackClient: () => client,
    mapProblemRecord: () => {
      throw new Error('must not map');
    }
  });
  const actor = { userId: 'actor', accessToken: 'token' };
  assert.equal(await gateway.updateFeedback('p', true, actor), null);
  rpcError = { code: 'rpc-failed' };
  assert.equal(await gateway.updateFeedback('p', true, actor), null);
});

test('contest gateway preserves RPC params and participation persistence', async () => {
  const calls: Call[] = [];
  let insertError: { code?: string } | null = null;
  const client: ContestEngagementClient = {
    from: (table) => ({
      insert: async (value) => {
        calls.push({ name: `insert:${table}`, value });
        return { data: null, error: insertError };
      },
      delete: () => {
        calls.push({ name: `delete:${table}`, value: null });
        return deleteQuery(calls);
      }
    }),
    rpc: async (name, value) => {
      calls.push({ name, value });
      return { data: [{ id: 'c' }], error: null };
    }
  };
  const gateway = createContestEngagementGateway({
    client,
    getCurrentUser: () => ({ id: 'actor' }),
    loadFeedback: async () => ({}),
    loadParticipatedContestIds: async () => new Set(),
    mapContestRecord: (record) => ({
      id: record.id,
      name: 'mapped',
      url: '',
      durationSeconds: 0,
      dateAdded: '',
      addedBy: '',
      addedByUrl: '',
      likes: 0,
      dislikes: 0
    })
  });
  assert.equal((await gateway.updateFeedback('c', false))?.name, 'mapped');
  assert.deepEqual(calls[0], {
    name: 'update_contest_feedback',
    value: { p_contest_id: 'c', p_is_like: false }
  });
  assert.equal(await gateway.setParticipation('c', true), true);
  assert.deepEqual(calls[1].value, { user_id: 'actor', contest_id: 'c' });
  assert.equal(await gateway.setParticipation('c', false), true);
  assert.deepEqual(calls.slice(3, 5), [
    { name: 'eq:user_id', value: 'actor' },
    { name: 'eq:contest_id', value: 'c' }
  ]);
  insertError = { code: '23505' };
  assert.equal(await gateway.setParticipation('c', true), true);
  insertError = { code: 'write-failed' };
  assert.equal(await gateway.setParticipation('c', true), false);
});

test('contest gateway rejects anonymous writes and contains all persistence failures', async () => {
  let currentUser: { id: string } | null = null;
  let mode: 'delete' | 'rpc' | 'empty' | 'throw' = 'delete';
  let calls = 0;
  const client: ContestEngagementClient = {
    from: () => {
      calls++;
      if (mode === 'throw') throw new Error('offline');
      return {
        insert: async () => ({ data: null, error: null }),
        delete: () => deleteQuery([], { code: 'delete-failed' })
      };
    },
    rpc: async () => {
      calls++;
      if (mode === 'throw') throw new Error('offline');
      if (mode === 'empty') return { data: [], error: null };
      return { data: [{ id: 'c' }], error: mode === 'rpc' ? { code: 'rpc-failed' } : null };
    }
  };
  const gateway = createContestEngagementGateway({
    client,
    getCurrentUser: () => currentUser,
    loadFeedback: async () => ({}),
    loadParticipatedContestIds: async () => new Set(),
    mapContestRecord: () => {
      throw new Error('mapping failed');
    }
  });
  assert.equal(await gateway.setParticipation('c', true), false);
  assert.equal(await gateway.updateFeedback('c', true), null);
  assert.equal(calls, 0);

  currentUser = { id: 'actor' };
  assert.equal(await gateway.setParticipation('c', false), false);
  mode = 'rpc';
  assert.equal(await gateway.updateFeedback('c', true), null);
  mode = 'empty';
  assert.equal(await gateway.updateFeedback('c', true), null);
  mode = 'throw';
  assert.equal(await gateway.setParticipation('c', true), false);
  assert.equal(await gateway.updateFeedback('c', true), null);
});
