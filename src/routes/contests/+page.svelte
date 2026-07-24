<script lang="ts">
import { onMount } from 'svelte';
import ContestTable from '$lib/components/ContestTable.svelte';
import { currentActor } from '$lib/auth/currentActor';
import { fetchContests } from '$lib/queries/contestQueries';
import { ContestCollection } from '$lib/collections/contestCollection';
import { createContestEngagementController } from '$lib/contests/contestEngagementController';
import { contestEngagementGateway } from '$lib/contests/contestEngagementGateway.supabase';
import type { PageData } from './$types';

// Contests provided by the server-side load so the initial render (including
// SSR) ships with data instead of waiting for a client-side fetch.
export let data: PageData;

// State
let collection = new ContestCollection();
let userParticipation: Set<string> = new Set();
let userFeedback: Record<string, 'like' | 'dislike' | null> = {};
// Starts false so a server-seeded list renders rows on the initial (SSR) render
// instead of a spinner. The unseeded fallback path in loadContests sets it true
// on mount before fetching.
let loading = false;
let error: string | null = null;
let isAuthenticated = false;

const engagement = createContestEngagementController({
  actor: currentActor,
  gateway: contestEngagementGateway,
  getCollection: () => collection,
  setCollection: (nextCollection) => (collection = nextCollection)
});

// Function to load contests
async function loadContests() {
  // Skip the loading spinner and public fetch when the list is already seeded
  // from the server-side load; the initial render is already showing data.
  const alreadySeeded = collection.sourceItems.length > 0;
  loading = !alreadySeeded;
  error = null;

  try {
    if (!alreadySeeded) {
      collection = collection.withSourceItems(await fetchContests());
    }

    // The engagement controller owns authenticated participation and feedback
    // loading, so it is intentionally omitted here.
  } catch (e) {
    console.error('Error loading contests:', e);
    error = 'Failed to load contests. Please try again later.';
  } finally {
    loading = false;
  }
}

async function handleToggleParticipation(
  contestId: string,
  hasParticipated: boolean
): Promise<void> {
  await engagement.setParticipation(contestId, hasParticipated);
}

async function handleLike(contestId: string, isLike: boolean): Promise<void> {
  await engagement.react(contestId, isLike);
}

// Seed the initial list from the server-provided contests so the first render
// (including SSR) shows data without waiting for a client-side fetch.
if (data?.contests && collection.sourceItems.length === 0) {
  collection = collection.withSourceItems(data.contests);
}

// Load contests on mount
onMount(() => {
  const unsubscribeEngagement = engagement.subscribe((state) => {
    isAuthenticated = state.isAuthenticated;
    userParticipation = state.participatedContestIds;
    userFeedback = state.feedback;
  });
  engagement.start();

  // Load contests
  loadContests();

  // Cleanup function
  return () => {
    unsubscribeEngagement();
    engagement.dispose();
  };
});
</script>

<svelte:head>
  <title>Contests</title>
  <meta name="description" content="Browse and track programming contests from various platforms" />
</svelte:head>

<div class="mx-auto w-full max-w-[1200px] bg-[var(--color-primary)] px-0">
  <h1 class="sr-only">Contests</h1>
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
        <p class="mt-2 text-gray-600">Loading contests...</p>
      </div>
    </div>
  {:else if error}
    <div class="rounded-lg bg-red-100 p-4 text-red-700">
      <p>{error}</p>
    </div>
  {:else}
    <div class="relative flex min-h-[calc(100vh-2rem)]">
      <!-- Main content -->
      <div class="flex w-full flex-1">
        <div class="w-full min-w-0 px-0 py-2 pb-6">
          <div class="contest-table-container w-full">
            <ContestTable
              contests={collection.rows}
              userParticipation={userParticipation}
              userFeedback={userFeedback}
              {isAuthenticated}
              allAuthors={collection.availableAuthors}
              difficultySortDirection={collection.difficultySortDirection}
              participatedFilterState={collection.participationFilter}
              authorFilter={collection.selectedAuthor}
              typeFilterState={collection.typeFilter}
              onToggleParticipation={handleToggleParticipation}
              onLike={handleLike}
              onDifficultySort={() => (collection = collection.cycleDifficultySort())}
              onAuthorFilter={(author) => (collection = collection.selectAuthor(author))}
              onParticipatedFilter={() => (collection = collection.cycleParticipationFilter())}
              onTypeFilter={() => (collection = collection.cycleTypeFilter())}
            />
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
.contest-table-container {
  width: 100%;
  margin: 0;
}

@media (min-width: 768px) {
  .contest-table-container {
    margin: 0;
  }
}
</style>
