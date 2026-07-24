export type Reaction = 'like' | 'dislike' | null;

export type ReactionState = Readonly<{
  likes: number;
  dislikes: number;
  reaction: Reaction;
}>;

export function transitionReaction(
  state: ReactionState,
  requestedReaction: Exclude<Reaction, null>
): ReactionState {
  if (state.reaction === requestedReaction) {
    return {
      likes: Math.max(0, requestedReaction === 'like' ? state.likes - 1 : state.likes),
      dislikes: Math.max(0, requestedReaction === 'dislike' ? state.dislikes - 1 : state.dislikes),
      reaction: null
    };
  }

  const likes =
    requestedReaction === 'like'
      ? state.likes + 1
      : state.reaction === 'like'
        ? state.likes - 1
        : state.likes;
  const dislikes =
    requestedReaction === 'dislike'
      ? state.dislikes + 1
      : state.reaction === 'dislike'
        ? state.dislikes - 1
        : state.dislikes;
  return {
    likes: Math.max(0, likes),
    dislikes: Math.max(0, dislikes),
    reaction: requestedReaction
  };
}
