import type { ContestCollection } from '../collections/contestCollection.ts';
import { transitionReaction } from '../engagement/reactionTransition.ts';
import type { ContestEngagementGateway, ContestFeedback } from './contestEngagementGateway.ts';

type Actor = { user: { id: string } | null };
type ActorStore = { subscribe: (listener: (actor: Actor) => void) => () => void };

export type ContestEngagementState = Readonly<{
  isAuthenticated: boolean;
  feedback: ContestFeedback;
  participatedContestIds: Set<string>;
}>;

export type CreateContestEngagementControllerOptions = {
  actor: ActorStore;
  gateway: ContestEngagementGateway;
  getCollection: () => ContestCollection;
  setCollection: (collection: ContestCollection) => void;
};

export type ContestEngagementController = {
  readonly state: ContestEngagementState;
  subscribe: (listener: (state: ContestEngagementState) => void) => () => void;
  start: () => void;
  react: (contestId: string, isLike: boolean) => Promise<void>;
  setParticipation: (contestId: string, hasParticipated: boolean) => Promise<void>;
  dispose: () => void;
};

export function createContestEngagementController({
  actor,
  gateway,
  getCollection,
  setCollection
}: CreateContestEngagementControllerOptions): ContestEngagementController {
  let state: ContestEngagementState = {
    isAuthenticated: false,
    feedback: {},
    participatedContestIds: new Set()
  };
  let actorUserId: string | null = null;
  let actorSynchronized = false;
  let generation = 0;
  let unsubscribeActor: (() => void) | null = null;
  let disposed = false;
  const listeners = new Set<(state: ContestEngagementState) => void>();

  function publish(next: ContestEngagementState): void {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener(state);
  }

  function applyParticipation(ids: Set<string>): void {
    setCollection(getCollection().withParticipatedContestIds(ids));
  }

  function isCurrent(expectedGeneration: number, expectedUserId: string): boolean {
    return !disposed && generation === expectedGeneration && actorUserId === expectedUserId;
  }

  async function loadFeedback(expectedGeneration: number, expectedUserId: string): Promise<void> {
    try {
      const feedback = await gateway.loadFeedback();
      if (isCurrent(expectedGeneration, expectedUserId)) publish({ ...state, feedback });
    } catch (error) {
      console.error('Failed to load contest feedback:', error);
    }
  }

  async function loadParticipation(
    expectedGeneration: number,
    expectedUserId: string
  ): Promise<void> {
    try {
      const participatedContestIds = await gateway.loadParticipatedContestIds();
      if (!isCurrent(expectedGeneration, expectedUserId)) return;
      publish({ ...state, participatedContestIds });
      applyParticipation(participatedContestIds);
    } catch (error) {
      console.error('Failed to load contest participation:', error);
    }
  }

  function synchronizeActor(nextActor: Actor): void {
    const nextUserId = nextActor.user?.id ?? null;
    if (actorSynchronized && nextUserId === actorUserId) {
      if (state.isAuthenticated !== Boolean(nextUserId)) {
        publish({ ...state, isAuthenticated: Boolean(nextUserId) });
      }
      return;
    }

    actorSynchronized = true;
    actorUserId = nextUserId;
    const expectedGeneration = ++generation;
    if (!nextUserId) {
      const participatedContestIds = new Set<string>();
      publish({ isAuthenticated: false, feedback: {}, participatedContestIds });
      applyParticipation(participatedContestIds);
      return;
    }

    publish({ ...state, isAuthenticated: true });
    void loadFeedback(expectedGeneration, nextUserId);
    void loadParticipation(expectedGeneration, nextUserId);
  }

  async function react(contestId: string, isLike: boolean): Promise<void> {
    if (disposed || !state.isAuthenticated || !actorUserId) return;

    const expectedGeneration = generation;
    const expectedUserId = actorUserId;
    const contest = getCollection().sourceItems.find((item) => item.id === contestId);
    if (!contest) return;
    const transition = transitionReaction(
      {
        likes: contest.likes,
        dislikes: contest.dislikes,
        reaction: state.feedback[contestId] ?? null
      },
      isLike ? 'like' : 'dislike'
    );

    try {
      const updatedContest = await gateway.updateFeedback(contestId, isLike);
      if (!updatedContest || !isCurrent(expectedGeneration, expectedUserId)) return;
      setCollection(getCollection().replaceSourceItem(updatedContest));
      const feedback = { ...state.feedback };
      if (transition.reaction) feedback[contestId] = transition.reaction;
      else delete feedback[contestId];
      publish({ ...state, feedback });
    } catch (error) {
      console.error('Error updating contest feedback:', error);
    }
  }

  async function setParticipation(contestId: string, hasParticipated: boolean): Promise<void> {
    if (disposed || !state.isAuthenticated || !actorUserId) return;

    const expectedGeneration = generation;
    const expectedUserId = actorUserId;
    try {
      if (!(await gateway.setParticipation(contestId, hasParticipated))) return;
      if (!isCurrent(expectedGeneration, expectedUserId)) return;
      const participatedContestIds = new Set(state.participatedContestIds);
      if (hasParticipated) participatedContestIds.add(contestId);
      else participatedContestIds.delete(contestId);
      publish({ ...state, participatedContestIds });
      applyParticipation(participatedContestIds);
    } catch (error) {
      console.error('Error toggling participation:', error);
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
    setParticipation,
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
