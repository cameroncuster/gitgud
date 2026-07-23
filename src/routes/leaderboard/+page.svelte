<script lang="ts">
import { browser } from '$app/environment';
import { fetchLeaderboard } from '$lib/services/leaderboard';
import type { LeaderboardEntry } from '$lib/services/leaderboard';
import type { PageData } from './$types';
import LeaderboardTable from '$lib/components/LeaderboardTable.svelte';

// Entries provided by the server-side load so the initial render (including
// SSR) ships with rows instead of waiting for a client-side fetch.
export let data: PageData;

let leaderboardEntries: LeaderboardEntry[] = data.entries ?? [];
let loading: boolean = false;
let error: string | null = null;

// Load leaderboard data. Used for the client-side retry path; the initial list
// is seeded from the server-side load above.
async function loadLeaderboard(): Promise<void> {
  if (!browser) return;

  loading = true;
  error = null;

  try {
    leaderboardEntries = await fetchLeaderboard();
  } catch (err) {
    console.error('Error loading leaderboard:', err);
    error = 'Failed to load leaderboard data. Please try again later.';
  } finally {
    loading = false;
  }
}
</script>

<svelte:head>
  <title>Leaderboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
</svelte:head>

<div class="mx-auto w-full max-w-[1200px] px-0">
  {#if loading}
    <div class="flex h-[calc(100vh-4rem)] items-center justify-center py-2 text-center">
      <div>
        <svg
          class="mx-auto h-10 w-10 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
          ></circle>
          <path
            class="opacity-75"
            fill="var(--color-primary)"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <p class="mt-2 text-gray-600">Loading leaderboard...</p>
      </div>
    </div>
  {:else if error}
    <div class="py-2 text-center text-red-500">
      <p>{error}</p>
      <button
        class="hover:bg-opacity-90 mt-2 rounded bg-[var(--color-primary)] px-4 py-2 text-white transition-colors"
        on:click={() => loadLeaderboard()}>Try Again</button
      >
    </div>
  {:else}
    <div class="relative min-h-[calc(100vh-2rem)]">
      <!-- Main content -->
      <div class="flex w-full flex-1">
        <div class="w-full min-w-0 px-0 py-2 pb-6">
          <div class="leaderboard-container w-full">
            <LeaderboardTable leaderboardEntries={leaderboardEntries} />
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
@media (max-width: 767px) {
  :global(body) {
    overflow-x: hidden;
  }
}

/* Remove excess margin from table container */
.leaderboard-container {
  width: 100%;
  margin: 0;
}
</style>
