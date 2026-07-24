import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionReaction } from '../src/lib/engagement/reactionTransition.ts';

test('reaction transition handles new likes and dislikes', () => {
  assert.deepEqual(transitionReaction({ likes: 2, dislikes: 3, reaction: null }, 'like'), {
    likes: 3,
    dislikes: 3,
    reaction: 'like'
  });
  assert.deepEqual(transitionReaction({ likes: 2, dislikes: 3, reaction: null }, 'dislike'), {
    likes: 2,
    dislikes: 4,
    reaction: 'dislike'
  });
});

test('reaction transition handles switches and undo', () => {
  assert.deepEqual(transitionReaction({ likes: 2, dislikes: 3, reaction: 'like' }, 'dislike'), {
    likes: 1,
    dislikes: 4,
    reaction: 'dislike'
  });
  assert.deepEqual(transitionReaction({ likes: 2, dislikes: 3, reaction: 'dislike' }, 'like'), {
    likes: 3,
    dislikes: 2,
    reaction: 'like'
  });
  assert.deepEqual(transitionReaction({ likes: 2, dislikes: 3, reaction: 'like' }, 'like'), {
    likes: 1,
    dislikes: 3,
    reaction: null
  });
  assert.deepEqual(transitionReaction({ likes: 2, dislikes: 3, reaction: 'dislike' }, 'dislike'), {
    likes: 2,
    dislikes: 2,
    reaction: null
  });
});

test('reaction transition floors counts and leaves input immutable', () => {
  const input = Object.freeze({ likes: 0, dislikes: 0, reaction: 'like' as const });
  const result = transitionReaction(input, 'dislike');
  assert.deepEqual(result, { likes: 0, dislikes: 1, reaction: 'dislike' });
  assert.deepEqual(transitionReaction({ likes: -2, dislikes: -3, reaction: null }, 'like'), {
    likes: 0,
    dislikes: 0,
    reaction: 'like'
  });
  assert.deepEqual(input, { likes: 0, dislikes: 0, reaction: 'like' });
  assert.notEqual(result, input);
});
