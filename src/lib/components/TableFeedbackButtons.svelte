<script lang="ts">
export let likes: number;
export let dislikes: number;
export let feedback: 'like' | 'dislike' | null | undefined = null;
export let isAuthenticated: boolean;
export let subject: 'problem' | 'contest';
export let iconSize: 16 | 18;
export let onFeedback: (isLike: boolean) => Promise<void>;

$: hasLiked = feedback === 'like';
$: hasDisliked = feedback === 'dislike';
</script>

<button
    class={`flex cursor-pointer items-center gap-1 rounded border-2 px-2 py-1 transition-colors duration-200
      ${hasLiked
        ? 'border-[color-mix(in_oklab,var(--color-like)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-like)_10%,transparent)] text-[var(--color-like)]'
        : 'border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[color-mix(in_oklab,var(--color-like)_50%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-like)_10%,transparent)] hover:text-[var(--color-like)]'}
      ${!isAuthenticated ? 'cursor-not-allowed opacity-50' : ''}`}
    on:click={() => isAuthenticated && onFeedback(true)}
    title={!isAuthenticated
      ? `Sign in to like ${subject}s`
      : hasLiked
        ? 'Undo like'
        : `Like this ${subject}`}
    aria-pressed={hasLiked}
    aria-label={`Like${hasLiked ? ' (liked)' : ''}, ${likes} ${likes === 1 ? 'like' : 'likes'}`}
    disabled={!isAuthenticated}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="stroke-2"
      aria-hidden="true"
    >
      <path
        d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"
      ></path>
    </svg>
    <span>{likes}</span>
  </button>

  <button
    class={`flex cursor-pointer items-center gap-1 rounded border-2 px-2 py-1 transition-colors duration-200
      ${hasDisliked
        ? 'border-[color-mix(in_oklab,var(--color-dislike)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-dislike)_10%,transparent)] text-[var(--color-dislike)]'
        : 'border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[color-mix(in_oklab,var(--color-dislike)_50%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-dislike)_10%,transparent)] hover:text-[var(--color-dislike)]'}
      ${!isAuthenticated ? 'cursor-not-allowed opacity-50' : ''}`}
    on:click={() => isAuthenticated && onFeedback(false)}
    title={!isAuthenticated
      ? `Sign in to dislike ${subject}s`
      : hasDisliked
        ? 'Undo dislike'
        : `Dislike this ${subject}`}
    aria-pressed={hasDisliked}
    aria-label={`Dislike${hasDisliked ? ' (disliked)' : ''}, ${dislikes} ${dislikes === 1 ? 'dislike' : 'dislikes'}`}
    disabled={!isAuthenticated}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="stroke-2"
      aria-hidden="true"
    >
      <path
        d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"
      ></path>
    </svg>
    <span>{dislikes}</span>
</button>

<style>
button {
  transition: all 0.2s ease;
}

button:hover {
  transform: translateY(1px);
}
</style>
