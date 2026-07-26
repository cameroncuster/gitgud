import type { ProblemCollection } from '../collections/problemCollection.ts';
import type { ProblemEngagementGateway, ProblemFeedback } from './problemEngagementGateway.ts';

type Actor = {
  user: { id: string } | null;
  session?: { access_token: string } | null;
};
type ActorStore = { subscribe: (listener: (actor: Actor) => void) => () => void };

export type ProblemEngagementState = Readonly<{
  isAuthenticated: boolean;
  feedback: ProblemFeedback;
  feedbackReady: boolean;
  pendingReactionIds: Set<string>;
  solvedProblemIds: Set<string>;
}>;

export type CreateProblemEngagementControllerOptions = {
  actor: ActorStore;
  gateway: ProblemEngagementGateway;
  getCollection: () => ProblemCollection;
  setCollection: (collection: ProblemCollection) => void;
  applySolvedToCollection: boolean;
  reportError: (message: string) => void;
};

export type ProblemEngagementController = {
  readonly state: ProblemEngagementState;
  subscribe: (listener: (state: ProblemEngagementState) => void) => () => void;
  start: () => void;
  react: (problemId: string, isLike: boolean) => Promise<void>;
  setSolved: (problemId: string, isSolved: boolean) => Promise<void>;
  dispose: () => void;
};

export function createProblemEngagementController({
  actor,
  gateway,
  getCollection,
  setCollection,
  applySolvedToCollection,
  reportError
}: CreateProblemEngagementControllerOptions): ProblemEngagementController {
  let state: ProblemEngagementState = {
    isAuthenticated: false,
    feedback: {},
    feedbackReady: true,
    pendingReactionIds: new Set(),
    solvedProblemIds: new Set()
  };
  let actorUserId: string | null = null;
  let actorAccessToken: string | null = null;
  let actorSynchronized = false;
  let generation = 0;
  let unsubscribeActor: (() => void) | null = null;
  let disposed = false;
  const listeners = new Set<(state: ProblemEngagementState) => void>();

  function publish(next: ProblemEngagementState): void {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener(state);
  }

  function applySolvedProblemIds(ids: Set<string>): void {
    if (disposed) return;
    if (applySolvedToCollection) {
      setCollection(getCollection().withSolvedProblemIds(ids));
    }
  }

  function isCurrent(expectedGeneration: number, expectedUserId: string): boolean {
    return !disposed && generation === expectedGeneration && actorUserId === expectedUserId;
  }

  async function loadFeedback(expectedGeneration: number, expectedUserId: string): Promise<void> {
    try {
      const feedback = await gateway.loadFeedback();
      if (isCurrent(expectedGeneration, expectedUserId)) {
        publish({ ...state, feedback, feedbackReady: true });
      }
    } catch (error) {
      console.error('Failed to load problem feedback:', error);
      if (isCurrent(expectedGeneration, expectedUserId)) {
        publish({ ...state, feedbackReady: false });
        reportError('Couldn’t load reactions. Reload to try again.');
      }
    }
  }

  async function loadSolved(expectedGeneration: number, expectedUserId: string): Promise<void> {
    try {
      const solvedProblemIds = await gateway.loadSolvedProblemIds();
      if (!isCurrent(expectedGeneration, expectedUserId)) return;
      publish({ ...state, solvedProblemIds });
      applySolvedProblemIds(solvedProblemIds);
    } catch (error) {
      console.error('Failed to load solved problems:', error);
    }
  }

  function synchronizeActor(nextActor: Actor): void {
    const nextUserId = nextActor.user?.id ?? null;
    const nextAccessToken = nextActor.session?.access_token ?? null;
    if (actorSynchronized && nextUserId === actorUserId) {
      // Same user: only the access token can change (token refresh);
      // isAuthenticated is always Boolean(actorUserId) and needs no update.
      actorAccessToken = nextAccessToken;
      return;
    }

    actorSynchronized = true;
    actorUserId = nextUserId;
    actorAccessToken = nextAccessToken;
    const expectedGeneration = ++generation;
    if (!nextUserId) {
      const solvedProblemIds = new Set<string>();
      publish({
        isAuthenticated: false,
        feedback: {},
        feedbackReady: true,
        pendingReactionIds: new Set(),
        solvedProblemIds
      });
      applySolvedProblemIds(solvedProblemIds);
      return;
    }

    const solvedProblemIds = new Set<string>();
    publish({
      isAuthenticated: true,
      feedback: {},
      feedbackReady: false,
      pendingReactionIds: new Set(),
      solvedProblemIds
    });
    applySolvedProblemIds(solvedProblemIds);
    void loadFeedback(expectedGeneration, nextUserId);
    void loadSolved(expectedGeneration, nextUserId);
  }

  async function react(problemId: string, isLike: boolean): Promise<void> {
    if (disposed) return;
    if (!state.isAuthenticated || !actorUserId || !actorAccessToken) {
      reportError('You must be signed in to like or dislike problems');
      return;
    }
    if (!state.feedbackReady || state.pendingReactionIds.size > 0) return;

    const problem = getCollection().sourceItems.find((item) => item.id === problemId);
    if (!problem) return;
    const expectedGeneration = generation;
    const expectedUserId = actorUserId;
    const reactionActor = { userId: actorUserId, accessToken: actorAccessToken };
    const pendingReactionIds = new Set(state.pendingReactionIds).add(problemId);
    publish({ ...state, pendingReactionIds });

    try {
      const updatedProblem = await gateway.updateFeedback(problemId, isLike, reactionActor);
      if (!isCurrent(expectedGeneration, expectedUserId)) return;
      if (!updatedProblem) {
        reportError('Couldn’t save reaction. Try again.');
        return;
      }
      setCollection(getCollection().updateSourceItem(problemId, () => updatedProblem));
      await loadFeedback(expectedGeneration, expectedUserId);
    } catch (error) {
      console.error('Error updating feedback:', error);
      if (isCurrent(expectedGeneration, expectedUserId)) {
        reportError('Couldn’t save reaction. Try again.');
      }
    } finally {
      if (isCurrent(expectedGeneration, expectedUserId)) {
        const nextPendingReactionIds = new Set(state.pendingReactionIds);
        nextPendingReactionIds.delete(problemId);
        publish({ ...state, pendingReactionIds: nextPendingReactionIds });
      }
    }
  }

  async function reloadSolved(expectedGeneration: number, expectedUserId: string): Promise<void> {
    const solvedProblemIds = await gateway.loadSolvedProblemIds();
    if (!isCurrent(expectedGeneration, expectedUserId)) return;
    publish({ ...state, solvedProblemIds });
    applySolvedProblemIds(solvedProblemIds);
  }

  async function setSolved(problemId: string, isSolved: boolean): Promise<void> {
    if (disposed) return;
    if (!state.isAuthenticated || !actorUserId) {
      reportError('You must be signed in to mark problems as solved');
      return;
    }

    const expectedGeneration = generation;
    const expectedUserId = actorUserId;
    const solvedProblemIds = new Set(state.solvedProblemIds);
    if (isSolved) solvedProblemIds.add(problemId);
    else solvedProblemIds.delete(problemId);
    publish({ ...state, solvedProblemIds });
    applySolvedProblemIds(solvedProblemIds);

    try {
      if (
        !(await gateway.setSolved(problemId, isSolved)) &&
        isCurrent(expectedGeneration, expectedUserId)
      ) {
        await reloadSolved(expectedGeneration, expectedUserId);
      }
    } catch (error) {
      console.error('Error updating solved status:', error);
      if (isCurrent(expectedGeneration, expectedUserId)) {
        await reloadSolved(expectedGeneration, expectedUserId);
      }
    }
  }

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    start() {
      if (!disposed && !unsubscribeActor) unsubscribeActor = actor.subscribe(synchronizeActor);
    },
    react,
    setSolved,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      unsubscribeActor?.();
      unsubscribeActor = null;
      listeners.clear();
    }
  };
}
