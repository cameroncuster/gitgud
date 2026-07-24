import test from 'node:test';
import assert from 'node:assert/strict';
import { ProblemCollection } from '../src/lib/collections/problemCollection.ts';
import { createProblemEngagementController } from '../src/lib/problems/problemEngagementController.ts';
import type {
  ProblemEngagementGateway,
  ProblemFeedback
} from '../src/lib/problems/problemEngagementGateway.ts';
import type { Problem } from '../src/lib/queries/problemQueries.ts';

type Actor = { user: { id: string } | null };

function actorStore(initial: Actor) {
  let actor = initial;
  const listeners = new Set<(value: Actor) => void>();
  return {
    subscribe(listener: (value: Actor) => void) {
      listeners.add(listener);
      listener(actor);
      return () => listeners.delete(listener);
    },
    set(next: Actor) {
      actor = next;
      for (const listener of listeners) listener(actor);
    },
    get listenerCount() {
      return listeners.size;
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function problem(likes = 2, dislikes = 1): Problem {
  return {
    id: 'p',
    name: 'Problem',
    tags: [],
    url: 'https://example.com/p',
    solved: 0,
    dateAdded: '',
    addedBy: 'author',
    addedByUrl: '',
    likes,
    dislikes,
    source: 'codeforces'
  };
}

function setup(
  options: Partial<ProblemEngagementGateway> = {},
  initialActor: Actor = { user: null }
) {
  const actor = actorStore(initialActor);
  let collection = new ProblemCollection({ items: [problem()] });
  const errors: string[] = [];
  const calls: string[] = [];
  const gateway: ProblemEngagementGateway = {
    loadFeedback: async () => ({}),
    loadSolvedProblemIds: async () => new Set(),
    updateFeedback: async () => null,
    setSolved: async () => true,
    ...options
  };
  const controller = createProblemEngagementController({
    actor,
    gateway,
    getCollection: () => collection,
    setCollection: (next) => {
      collection = next;
      calls.push('collection');
    },
    applySolvedToCollection: true,
    reportError: (message) => errors.push(message)
  });
  controller.subscribe(() => calls.push('state'));
  controller.start();
  return { actor, controller, errors, calls, collection: () => collection };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('problem controller preserves anonymous messages and performs no writes', async () => {
  let writes = 0;
  const context = setup({
    updateFeedback: async () => {
      writes++;
      return null;
    },
    setSolved: async () => {
      writes++;
      return true;
    }
  });
  await context.controller.react('p', true);
  await context.controller.setSolved('p', true);
  assert.equal(writes, 0);
  assert.deepEqual(context.errors, [
    'You must be signed in to like or dislike problems',
    'You must be signed in to mark problems as solved'
  ]);
});

test('problem controller loads, clears, and reloads on actor changes', async () => {
  let actorId = 'one';
  const context = setup({
    loadFeedback: async () => ({ p: actorId === 'one' ? 'like' : 'dislike' }),
    loadSolvedProblemIds: async () => new Set([actorId])
  });
  context.actor.set({ user: { id: 'one' } });
  await settle();
  assert.equal(context.controller.state.feedback.p, 'like');
  assert.deepEqual([...context.controller.state.solvedProblemIds], ['one']);

  context.actor.set({ user: null });
  assert.deepEqual(context.controller.state.feedback, {});
  assert.deepEqual([...context.controller.state.solvedProblemIds], []);
  assert.deepEqual([...context.collection().solvedProblemIds], []);

  actorId = 'two';
  context.actor.set({ user: { id: 'two' } });
  await settle();
  assert.equal(context.controller.state.feedback.p, 'dislike');
  assert.deepEqual([...context.controller.state.solvedProblemIds], ['two']);
});

test('problem reactions update before RPC and null preserves optimism', async () => {
  const pending = deferred<Problem | null>();
  const context = setup({ updateFeedback: () => pending.promise }, { user: { id: 'actor' } });
  await settle();
  context.calls.length = 0;
  const action = context.controller.react('p', true);
  assert.equal(context.collection().sourceItems[0].likes, 3);
  assert.equal(context.controller.state.feedback.p, 'like');
  assert.deepEqual(context.calls, ['collection', 'state']);
  pending.resolve(null);
  await action;
  assert.equal(context.collection().sourceItems[0].likes, 3);
  assert.equal(context.controller.state.feedback.p, 'like');
});

test('thrown problem reaction reloads actor feedback and solved state', async () => {
  let load = 0;
  const context = setup(
    {
      loadFeedback: async (): Promise<ProblemFeedback> => (++load === 1 ? {} : { p: 'dislike' }),
      loadSolvedProblemIds: async () => new Set(load > 1 ? ['server'] : []),
      updateFeedback: async () => {
        throw new Error('rpc threw');
      }
    },
    { user: { id: 'actor' } }
  );
  await settle();
  await context.controller.react('p', true);
  assert.equal(context.controller.state.feedback.p, 'dislike');
  assert.deepEqual([...context.controller.state.solvedProblemIds], ['server']);
});

test('problem solved successful add/remove keeps duplicate success optimistic', async () => {
  const writes: Array<{ problemId: string; isSolved: boolean }> = [];
  const context = setup(
    {
      setSolved: async (problemId, isSolved) => {
        writes.push({ problemId, isSolved });
        return true;
      }
    },
    { user: { id: 'actor' } }
  );
  await settle();
  await context.controller.setSolved('p', true);
  assert.equal(context.controller.state.solvedProblemIds.has('p'), true);
  await context.controller.setSolved('p', false);
  assert.equal(context.controller.state.solvedProblemIds.has('p'), false);
  assert.deepEqual(writes, [
    { problemId: 'p', isSolved: true },
    { problemId: 'p', isSolved: false }
  ]);
});

test('problem solved changes optimistically and failed writes reconcile', async () => {
  const pending = deferred<boolean>();
  let loads = 0;
  const context = setup(
    {
      loadSolvedProblemIds: async () => {
        loads++;
        return new Set();
      },
      setSolved: () => pending.promise
    },
    { user: { id: 'actor' } }
  );
  await settle();
  const action = context.controller.setSolved('p', true);
  assert.equal(context.controller.state.solvedProblemIds.has('p'), true);
  assert.equal(context.collection().solvedProblemIds.has('p'), true);
  pending.resolve(false);
  await action;
  assert.equal(loads, 2);
  assert.equal(context.controller.state.solvedProblemIds.has('p'), false);

  await context.controller.setSolved('p', false);
  assert.equal(context.controller.state.solvedProblemIds.has('p'), false);
});

test('problem controller ignores stale actor loads and all loads after dispose', async () => {
  const firstFeedback = deferred<ProblemFeedback>();
  const secondFeedback = deferred<ProblemFeedback>();
  const firstSolved = deferred<Set<string>>();
  const secondSolved = deferred<Set<string>>();
  const feedbackLoads = [firstFeedback, secondFeedback];
  const solvedLoads = [firstSolved, secondSolved];
  const context = setup({
    loadFeedback: () => feedbackLoads.shift()!.promise,
    loadSolvedProblemIds: () => solvedLoads.shift()!.promise
  });
  context.actor.set({ user: { id: 'one' } });
  context.actor.set({ user: { id: 'two' } });
  firstFeedback.resolve({ p: 'like' });
  firstSolved.resolve(new Set(['one']));
  await settle();
  assert.deepEqual(context.controller.state.feedback, {});

  context.controller.dispose();
  assert.equal(context.actor.listenerCount, 0);
  await context.controller.react('p', true);
  await context.controller.setSolved('p', true);
  secondFeedback.resolve({ p: 'dislike' });
  secondSolved.resolve(new Set(['two']));
  await settle();
  assert.deepEqual(context.controller.state.feedback, {});
  assert.deepEqual([...context.controller.state.solvedProblemIds], []);
});
