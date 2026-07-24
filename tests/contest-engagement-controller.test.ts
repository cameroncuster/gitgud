import test from 'node:test';
import assert from 'node:assert/strict';
import { ContestCollection } from '../src/lib/collections/contestCollection.ts';
import { createContestEngagementController } from '../src/lib/contests/contestEngagementController.ts';
import type {
  ContestEngagementGateway,
  ContestFeedback
} from '../src/lib/contests/contestEngagementGateway.ts';
import type { Contest } from '../src/lib/queries/contestQueries.ts';

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
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function contest(likes = 2, dislikes = 1): Contest {
  return {
    id: 'c',
    name: 'Contest',
    url: 'https://example.com/c',
    durationSeconds: 7200,
    dateAdded: '',
    addedBy: 'author',
    addedByUrl: '',
    likes,
    dislikes
  };
}

function setup(
  options: Partial<ContestEngagementGateway> = {},
  initialActor: Actor = { user: null }
) {
  const actor = actorStore(initialActor);
  let collection = new ContestCollection({ items: [contest()] });
  const gateway: ContestEngagementGateway = {
    loadFeedback: async () => ({}),
    loadParticipatedContestIds: async () => new Set(),
    updateFeedback: async () => null,
    setParticipation: async () => true,
    ...options
  };
  const controller = createContestEngagementController({
    actor,
    gateway,
    getCollection: () => collection,
    setCollection: (next) => (collection = next)
  });
  controller.start();
  return { actor, controller, collection: () => collection };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('contest controller anonymous actions are exact no-ops', async () => {
  let writes = 0;
  const context = setup({
    updateFeedback: async () => {
      writes++;
      return contest(3, 1);
    },
    setParticipation: async () => {
      writes++;
      return true;
    }
  });
  await context.controller.react('c', true);
  await context.controller.setParticipation('c', true);
  assert.equal(writes, 0);
  assert.equal(context.collection().sourceItems[0].likes, 2);
  assert.deepEqual(context.controller.state.feedback, {});
  assert.deepEqual([...context.controller.state.participatedContestIds], []);
});

test('contest controller loads, clears, and reloads on actor changes', async () => {
  let actorId = 'one';
  const context = setup({
    loadFeedback: async () => ({ c: actorId === 'one' ? 'like' : 'dislike' }),
    loadParticipatedContestIds: async () => new Set([actorId])
  });
  context.actor.set({ user: { id: 'one' } });
  await settle();
  assert.equal(context.controller.state.feedback.c, 'like');
  assert.deepEqual([...context.controller.state.participatedContestIds], ['one']);
  context.actor.set({ user: null });
  assert.deepEqual(context.controller.state.feedback, {});
  assert.deepEqual([...context.collection().participatedContestIds], []);
  actorId = 'two';
  context.actor.set({ user: { id: 'two' } });
  await settle();
  assert.equal(context.controller.state.feedback.c, 'dislike');
});

test('contest reaction waits for success and null or rejection changes nothing', async () => {
  const pending = deferred<Contest | null>();
  const context = setup({ updateFeedback: () => pending.promise }, { user: { id: 'actor' } });
  await settle();
  const action = context.controller.react('c', true);
  assert.equal(context.collection().sourceItems[0].likes, 2);
  assert.deepEqual(context.controller.state.feedback, {});
  pending.resolve(contest(3, 1));
  await action;
  assert.equal(context.collection().sourceItems[0].likes, 3);
  assert.equal(context.controller.state.feedback.c, 'like');

  const nullContext = setup({ updateFeedback: async () => null }, { user: { id: 'actor' } });
  await settle();
  await nullContext.controller.react('c', true);
  assert.equal(nullContext.collection().sourceItems[0].likes, 2);
  assert.deepEqual(nullContext.controller.state.feedback, {});

  const failureContext = setup(
    { updateFeedback: async () => Promise.reject(new Error('failed')) },
    { user: { id: 'actor' } }
  );
  await settle();
  await failureContext.controller.react('c', true);
  assert.equal(failureContext.collection().sourceItems[0].likes, 2);
});

test('contest participation waits for persistence success', async () => {
  const pending = deferred<boolean>();
  const context = setup({ setParticipation: () => pending.promise }, { user: { id: 'actor' } });
  await settle();
  const action = context.controller.setParticipation('c', true);
  assert.equal(context.controller.state.participatedContestIds.has('c'), false);
  pending.resolve(true);
  await action;
  assert.equal(context.controller.state.participatedContestIds.has('c'), true);
  assert.equal(context.collection().participatedContestIds.has('c'), true);

  const failed = setup({ setParticipation: async () => false }, { user: { id: 'actor' } });
  await settle();
  await failed.controller.setParticipation('c', true);
  assert.equal(failed.controller.state.participatedContestIds.has('c'), false);
});

test('contest controller ignores stale loads and disposed completions', async () => {
  const firstFeedback = deferred<ContestFeedback>();
  const secondFeedback = deferred<ContestFeedback>();
  const firstParticipation = deferred<Set<string>>();
  const secondParticipation = deferred<Set<string>>();
  const feedbackLoads = [firstFeedback, secondFeedback];
  const participationLoads = [firstParticipation, secondParticipation];
  const context = setup({
    loadFeedback: () => feedbackLoads.shift()!.promise,
    loadParticipatedContestIds: () => participationLoads.shift()!.promise
  });
  context.actor.set({ user: { id: 'one' } });
  context.actor.set({ user: { id: 'two' } });
  firstFeedback.resolve({ c: 'like' });
  firstParticipation.resolve(new Set(['one']));
  await settle();
  assert.deepEqual(context.controller.state.feedback, {});
  context.controller.dispose();
  assert.equal(context.actor.listenerCount, 0);
  await context.controller.react('c', true);
  await context.controller.setParticipation('c', true);
  secondFeedback.resolve({ c: 'dislike' });
  secondParticipation.resolve(new Set(['two']));
  await settle();
  assert.deepEqual(context.controller.state.feedback, {});
  assert.deepEqual([...context.controller.state.participatedContestIds], []);
});
