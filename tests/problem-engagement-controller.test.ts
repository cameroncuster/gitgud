import test from 'node:test';
import assert from 'node:assert/strict';
import { ProblemCollection } from '../src/lib/collections/problemCollection.ts';
import { createProblemEngagementController } from '../src/lib/problems/problemEngagementController.ts';
import type {
  ProblemEngagementGateway,
  ProblemFeedback
} from '../src/lib/problems/problemEngagementGateway.ts';
import type { Problem } from '../src/lib/queries/problemQueries.ts';

type Actor = {
  user: { id: string } | null;
  session?: { access_token: string } | null;
};

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
      actor =
        next.user && next.session === undefined
          ? { ...next, session: { access_token: `${next.user.id}-token` } }
          : next;
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

function problem(likes = 2, dislikes = 1, id = 'p'): Problem {
  return {
    id,
    name: `Problem ${id}`,
    url: `https://example.com/${id}`,
    addedBy: 'author',
    addedByUrl: '',
    likes,
    dislikes,
    source: 'codeforces'
  };
}

function setup(
  options: Partial<ProblemEngagementGateway> = {},
  initialActor: Actor = { user: null },
  problems: Problem[] = [problem()]
) {
  const actor = actorStore(
    initialActor.user && initialActor.session === undefined
      ? { ...initialActor, session: { access_token: `${initialActor.user.id}-token` } }
      : initialActor
  );
  let collection = new ProblemCollection({ items: problems });
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

test('problem controller start is idempotent and subscriptions can unsubscribe', () => {
  const context = setup();
  context.controller.start();
  assert.equal(context.actor.listenerCount, 1);
  const unsubscribe = context.controller.subscribe(() => {});
  unsubscribe();
  context.controller.dispose();
  context.controller.dispose();
  context.controller.start();
  assert.equal(context.actor.listenerCount, 0);
});

test('problem load failures are contained without changing empty state', async () => {
  const context = setup({
    loadFeedback: async () => Promise.reject(new Error('feedback failed')),
    loadSolvedProblemIds: async () => Promise.reject(new Error('solved failed'))
  });
  context.actor.set({ user: { id: 'actor' } });
  await settle();
  assert.deepEqual(context.controller.state.feedback, {});
  assert.deepEqual([...context.controller.state.solvedProblemIds], []);
});

test('problem reactions ignore unknown IDs without writes', async () => {
  let writes = 0;
  const context = setup(
    { updateFeedback: async () => ((writes += 1), null) },
    { user: { id: 'actor' } }
  );
  await settle();
  await context.controller.react('missing', true);
  assert.equal(writes, 0);
});

test('problem reactions keep counts unchanged until the authoritative RPC row arrives', async () => {
  const pending = deferred<Problem | null>();
  let feedbackLoads = 0;
  const context = setup(
    {
      loadFeedback: async (): Promise<ProblemFeedback> =>
        ++feedbackLoads === 1 ? {} : { p: 'like' },
      updateFeedback: () => pending.promise
    },
    { user: { id: 'actor' } }
  );
  await settle();
  const action = context.controller.react('p', true);
  assert.equal(context.collection().sourceItems[0].likes, 2);
  assert.equal(context.controller.state.feedback.p, undefined);
  assert.equal(context.controller.state.pendingReactionIds.has('p'), true);

  pending.resolve(problem(7, 4));
  await action;
  assert.equal(context.collection().sourceItems[0].likes, 7);
  assert.equal(context.collection().sourceItems[0].dislikes, 4);
  assert.equal(context.controller.state.feedback.p, 'like');
  assert.equal(context.controller.state.pendingReactionIds.has('p'), false);
});

test('failed problem reactions leave counts untouched and show a visible error', async () => {
  for (const updateFeedback of [
    async () => null,
    async () => Promise.reject(new Error('rpc threw'))
  ]) {
    const context = setup({ updateFeedback }, { user: { id: 'actor' } });
    await settle();
    await context.controller.react('p', true);
    assert.equal(context.collection().sourceItems[0].likes, 2);
    assert.equal(context.collection().sourceItems[0].dislikes, 1);
    assert.equal(context.controller.state.feedback.p, undefined);
    assert.equal(context.controller.state.pendingReactionIds.has('p'), false);
    assert.deepEqual(context.errors, ['Couldn’t save reaction. Try again.']);
  }
});

test('problem reactions ignore repeated clicks while a row write is pending', async () => {
  const pending = deferred<Problem | null>();
  let calls = 0;
  let feedbackLoads = 0;
  const context = setup(
    {
      loadFeedback: async (): Promise<ProblemFeedback> =>
        ++feedbackLoads === 1 ? {} : { p: 'like' },
      updateFeedback: () => ((calls += 1), pending.promise)
    },
    { user: { id: 'actor' } }
  );
  await settle();
  const first = context.controller.react('p', true);
  await context.controller.react('p', false);
  assert.equal(calls, 1);
  pending.resolve(problem(3, 1));
  await first;
  assert.equal(context.collection().sourceItems[0].likes, 3);
  assert.equal(context.controller.state.feedback.p, 'like');
});

test('problem reactions serialize writes across different rows', async () => {
  const pending = deferred<Problem | null>();
  let writes = 0;
  let feedbackLoads = 0;
  const context = setup(
    {
      loadFeedback: async (): Promise<ProblemFeedback> =>
        ++feedbackLoads === 1 ? {} : { p: 'like' },
      updateFeedback: () => ((writes += 1), pending.promise)
    },
    { user: { id: 'actor' } },
    [problem(), problem(4, 2, 'q')]
  );
  await settle();

  const first = context.controller.react('p', true);
  await context.controller.react('q', true);
  assert.equal(writes, 1);
  assert.equal(context.controller.state.pendingReactionIds.has('p'), true);
  assert.equal(context.collection().sourceItems.find((item) => item.id === 'q')?.likes, 4);

  pending.resolve(problem(3, 1));
  await first;
  assert.equal(context.controller.state.pendingReactionIds.size, 0);
});

test('problem reactions wait for feedback hydration before writing', async () => {
  const feedback = deferred<ProblemFeedback>();
  let writes = 0;
  const context = setup({
    loadFeedback: () => feedback.promise,
    updateFeedback: async () => ((writes += 1), problem(3, 1))
  });
  context.actor.set({ user: { id: 'actor' } });
  assert.equal(context.controller.state.feedbackReady, false);
  await context.controller.react('p', true);
  assert.equal(writes, 0);
  feedback.resolve({});
  await settle();
  assert.equal(context.controller.state.feedbackReady, true);
  await context.controller.react('p', true);
  assert.equal(writes, 1);
});

test('actor changes cannot redirect a pending reaction write to the next account', async () => {
  const pending = deferred<Problem | null>();
  const actors: Array<{ userId: string; accessToken: string }> = [];
  const context = setup(
    {
      updateFeedback: (_problemId, _isLike, actor) => {
        actors.push(actor);
        return pending.promise;
      }
    },
    { user: { id: 'one' } }
  );
  await settle();
  const write = context.controller.react('p', true);
  context.actor.set({ user: { id: 'two' } });
  pending.resolve(problem(3, 1));
  await write;
  assert.deepEqual(actors, [{ userId: 'one', accessToken: 'one-token' }]);
  assert.equal(context.collection().sourceItems[0].likes, 2);
  assert.equal(context.controller.state.feedback.p, undefined);
  assert.equal(context.controller.state.pendingReactionIds.size, 0);
});

test('direct actor switches clear solved state before the new hydration resolves', async () => {
  let actorId = 'one';
  const secondSolved = deferred<Set<string>>();
  const context = setup(
    {
      loadSolvedProblemIds: async () => (actorId === 'one' ? new Set(['p']) : secondSolved.promise)
    },
    { user: { id: actorId } }
  );
  await settle();
  assert.equal(context.controller.state.solvedProblemIds.has('p'), true);
  assert.equal(context.collection().solvedProblemIds.has('p'), true);

  actorId = 'two';
  context.actor.set({ user: { id: actorId } });
  assert.equal(context.controller.state.solvedProblemIds.size, 0);
  assert.equal(context.collection().solvedProblemIds.size, 0);
  secondSolved.resolve(new Set(['q']));
  await settle();
  assert.deepEqual([...context.controller.state.solvedProblemIds], ['q']);
});

test('successful problem reactions reload cross-tab feedback authoritatively', async () => {
  let feedbackLoads = 0;
  const context = setup(
    {
      loadFeedback: async () => (++feedbackLoads === 1 ? {} : {}),
      updateFeedback: async () => problem(1, 1)
    },
    { user: { id: 'actor' } }
  );
  await settle();
  await context.controller.react('p', true);
  assert.equal(context.collection().sourceItems[0].likes, 1);
  assert.equal(context.controller.state.feedback.p, undefined);
  assert.equal(feedbackLoads, 2);
});

test('problem feedback load failures block writes until another actor hydrates', async () => {
  let writes = 0;
  let actorId = 'one';
  const context = setup({
    loadFeedback: async () => {
      if (actorId === 'one') throw new Error('offline');
      return { p: 'dislike' };
    },
    updateFeedback: async () => ((writes += 1), problem(3, 1))
  });
  context.actor.set({ user: { id: actorId } });
  await settle();
  assert.equal(context.controller.state.feedbackReady, false);
  await context.controller.react('p', true);
  assert.equal(writes, 0);
  assert.deepEqual(context.errors, ['Couldn’t load reactions. Reload to try again.']);

  actorId = 'two';
  context.actor.set({ user: { id: actorId } });
  await settle();
  assert.equal(context.controller.state.feedbackReady, true);
  assert.equal(context.controller.state.feedback.p, 'dislike');
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

test('problem solved thrown writes reconcile unless the actor changed', async () => {
  let loads = 0;
  const context = setup(
    {
      loadSolvedProblemIds: async () => (++loads === 1 ? new Set() : new Set(['server'])),
      setSolved: async () => Promise.reject(new Error('write failed'))
    },
    { user: { id: 'actor' } }
  );
  await settle();
  await context.controller.setSolved('p', true);
  assert.deepEqual([...context.controller.state.solvedProblemIds], ['server']);

  const pending = deferred<boolean>();
  let reloads = 0;
  const stale = setup(
    {
      loadSolvedProblemIds: async () => ((reloads += 1), new Set()),
      setSolved: () => pending.promise
    },
    { user: { id: 'one' } }
  );
  await settle();
  const write = stale.controller.setSolved('p', true);
  stale.actor.set({ user: { id: 'two' } });
  pending.resolve(false);
  await write;
  assert.equal(reloads, 2);
});

test('problem solved reconciliation is abandoned when the actor changes mid-reload', async () => {
  let loads = 0;
  const reload = deferred<Set<string>>();
  const context = setup(
    {
      loadSolvedProblemIds: async () => {
        loads++;
        return loads === 2 ? reload.promise : new Set();
      },
      setSolved: async () => false
    },
    { user: { id: 'one' } }
  );
  await settle();
  assert.equal(loads, 1);
  const write = context.controller.setSolved('p', true);
  assert.equal(context.controller.state.solvedProblemIds.has('p'), true);
  await settle();
  assert.equal(loads, 2);
  context.actor.set({ user: { id: 'two' } });
  await settle();
  reload.resolve(new Set(['stale-one']));
  await write;
  assert.equal(context.controller.state.solvedProblemIds.has('stale-one'), false);
});

test('problem controller refreshes the access token when the same user re-syncs', async () => {
  let feedbackLoads = 0;
  let solvedLoads = 0;
  const context = setup(
    {
      loadFeedback: async () => ((feedbackLoads += 1), {}),
      loadSolvedProblemIds: async () => ((solvedLoads += 1), new Set()),
      updateFeedback: async () => problem(3, 1)
    },
    { user: { id: 'actor' }, session: { access_token: 'first-token' } }
  );
  await settle();
  assert.equal(feedbackLoads, 1);
  assert.equal(solvedLoads, 1);

  const actors: Array<{ userId: string; accessToken: string }> = [];
  context.actor.set({ user: { id: 'actor' }, session: { access_token: 'refreshed-token' } });
  await settle();
  assert.equal(feedbackLoads, 1);
  assert.equal(solvedLoads, 1);

  const withCapture = setup(
    {
      updateFeedback: async (_id, _isLike, reactionActor) => {
        actors.push(reactionActor);
        return problem(3, 1);
      }
    },
    { user: { id: 'actor' }, session: { access_token: 'first-token' } }
  );
  await settle();
  withCapture.actor.set({ user: { id: 'actor' }, session: { access_token: 'refreshed-token' } });
  await settle();
  await withCapture.controller.react('p', true);
  assert.deepEqual(actors, [{ userId: 'actor', accessToken: 'refreshed-token' }]);
});

test('problem controller blocks state and collection publications during unsubscribe', () => {
  let listener: ((actor: Actor) => void) | null = null;
  const actor = {
    subscribe(next: (actor: Actor) => void) {
      listener = next;
      next({ user: { id: 'actor' }, session: { access_token: 'token' } });
      return () => listener?.({ user: null });
    }
  };
  let collection = new ProblemCollection({ items: [problem()] });
  let collectionWrites = 0;
  const controller = createProblemEngagementController({
    actor,
    gateway: {
      loadFeedback: async () => ({}),
      loadSolvedProblemIds: async () => new Set(),
      updateFeedback: async () => null,
      setSolved: async () => true
    },
    getCollection: () => collection,
    setCollection: (next) => {
      collection = next;
      collectionWrites++;
    },
    applySolvedToCollection: true,
    reportError: () => {}
  });
  controller.start();
  const writesBeforeDispose = collectionWrites;
  controller.dispose();
  assert.equal(controller.state.isAuthenticated, true);
  assert.equal(collectionWrites, writesBeforeDispose);
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
