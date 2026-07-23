<script lang="ts">
import { page } from '$app/state';
import { resolve } from '$app/paths';

const status = page.status;
const isNotFound = status === 404;
const title = isNotFound ? 'Page not found' : 'Something went wrong';
</script>

<svelte:head>
  <title>{status} · {title}</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-[600px] flex-col items-center px-4 py-16 text-center">
  <h1 class="mb-4 text-3xl font-semibold text-[var(--color-heading)]">
    {status} · {title}
  </h1>
  <p class="mb-8 text-[var(--color-text)]">
    {#if isNotFound}
      The page you're looking for doesn't exist or has moved.
    {:else}
      {page.error?.message ?? 'An unexpected error occurred.'}
    {/if}
  </p>
  <a
    href={resolve('/')}
    class="rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 font-bold text-[var(--color-on-accent)] no-underline transition-colors hover:brightness-110"
  >
    Back to Problems
  </a>
</div>
