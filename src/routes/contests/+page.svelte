<script lang="ts">
import { onMount } from 'svelte';
import ContestTable from '$lib/components/ContestTable.svelte';
import {
  fetchContests,
  fetchUserParticipation,
  toggleContestParticipation,
  fetchUserFeedback,
  updateContestFeedback
} from '$lib/services/contest';
import type { Contest } from '$lib/services/contest';
import type { PageData } from './$types';
import { user } from '$lib/services/auth';
import { SvelteSet } from 'svelte/reactivity';
import {
  getSortedAuthors,
  sortByDifficulty,
  sortByScore,
  type SortDirection
} from '$lib/utils/table';

// Contests provided by the server-side load so the initial render (including
// SSR) ships with data instead of waiting for a client-side fetch.
export let data: PageData;

// State
let contests: Contest[] = [];
let filteredContests: Contest[] = [];
let userParticipation: SvelteSet<string> = new SvelteSet();
let userFeedback: Record<string, 'like' | 'dislike' | null> = {};
// Starts false so a server-seeded list renders rows on the initial (SSR) render
// instead of a spinner. The unseeded fallback path in loadContests sets it true
// on mount before fetching.
let loading = false;
let error: string | null = null;
let isAuthenticated = false;
let availableAuthors: string[] = [];
let authorFilter: string | null = null;

// Filter states
let participatedFilterState: 'participated' | 'not-participated' | 'all' = 'all';
let typeFilterState: 'all' | 'icpc' | 'codeforces' = 'all';

// Function to get contests filtered by everything except author
function getContestsWithoutAuthorFilter(): Contest[] {
  return contests.filter((contest) => {
    // Filter by participation status
    if (
      participatedFilterState === 'participated' &&
      contest.id &&
      !userParticipation.has(contest.id)
    ) {
      return false;
    }
    if (
      participatedFilterState === 'not-participated' &&
      contest.id &&
      userParticipation.has(contest.id)
    ) {
      return false;
    }

    // Filter by contest type
    if (typeFilterState === 'icpc' && contest.type !== 'ICPC') {
      return false;
    }
    if (typeFilterState === 'codeforces' && contest.type === 'ICPC') {
      return false;
    }

    return true;
  });
}

// Function to update available authors based on current filters
function updateAvailableAuthors(): void {
  // Get contests filtered by everything except author
  const contestsWithoutAuthorFilter = getContestsWithoutAuthorFilter();

  // Update available authors based on current filters
  availableAuthors = getSortedAuthors(contestsWithoutAuthorFilter);
}

// Function to handle participation filter
function handleParticipatedFilter({
  detail
}: CustomEvent<{ state: 'all' | 'participated' | 'not-participated' }>): void {
  participatedFilterState = detail.state;
  updateFilters();
}

// Function to handle type filter
function handleTypeFilter({ detail }: CustomEvent<{ type: 'all' | 'icpc' | 'codeforces' }>): void {
  typeFilterState = detail.type;
  updateFilters();
}

// Function to handle author filter
function handleAuthorFilter({ detail }: CustomEvent<{ author: string | null }>): void {
  authorFilter = detail.author;
  updateFilters();
}

// Function to update filters and filtered contests
function updateFilters(): void {
  // Update available authors based on current filters
  updateAvailableAuthors();

  // Apply filters to get updated contests list
  let filtered = getContestsWithoutAuthorFilter();

  // Apply author filter if selected
  if (authorFilter) {
    filtered = filtered.filter((contest) => contest.addedBy === authorFilter);
  }

  // Update filtered contests
  filteredContests = sortContestsByLikes(filtered, 'desc');
}

// Function to load contests
async function loadContests() {
  // Skip the loading spinner and public fetch when the list is already seeded
  // from the server-side load; the initial render is already showing data.
  const alreadySeeded = contests.length > 0;
  loading = !alreadySeeded;
  error = null;

  try {
    if (!alreadySeeded) {
      // Fetch contests
      contests = await fetchContests();

      // Apply default sorting by likes (most likes first)
      filteredContests = sortContestsByLikes([...contests], 'desc');

      // Initialize available authors with all authors
      updateAvailableAuthors();
    }

    // Participation and feedback for the authenticated user are loaded by the
    // auth subscription in onMount, which fires immediately with the current
    // user and again on every auth change. Fetching here as well would issue a
    // duplicate request on load, so it is intentionally omitted.
  } catch (e) {
    console.error('Error loading contests:', e);
    error = 'Failed to load contests. Please try again later.';
  } finally {
    loading = false;
  }
}

function sortContestsByDifficulty(
  contestsToSort: readonly Contest[],
  direction: SortDirection
): Contest[] {
  return sortByDifficulty(contestsToSort, direction, (contestsToReset) =>
    sortContestsByLikes(contestsToReset, 'desc')
  );
}

function sortContestsByLikes(
  contestsToSort: readonly Contest[],
  direction: SortDirection
): Contest[] {
  if (direction === null) return [...contests];
  return sortByScore(contestsToSort, direction);
}

// Handle difficulty sort event
function handleDifficultySort(event: CustomEvent<{ direction: 'asc' | 'desc' | null }>) {
  filteredContests = sortContestsByDifficulty(filteredContests, event.detail.direction);
}

// Handle user participation toggle
async function handleToggleParticipation(contestId: string, hasParticipated: boolean) {
  if (!isAuthenticated) {
    // Don't allow participation toggle if not authenticated
    return;
  }

  try {
    const success = await toggleContestParticipation(contestId, hasParticipated);

    if (success) {
      // Update local state
      if (hasParticipated) {
        userParticipation.add(contestId);
      } else {
        userParticipation.delete(contestId);
      }
      userParticipation = new SvelteSet(userParticipation); // Trigger reactivity
    }
  } catch (err) {
    console.error('Error toggling participation:', err);
  }
}

// Handle like/dislike
async function handleLike(contestId: string, isLike: boolean) {
  if (!isAuthenticated) {
    // Don't allow likes/dislikes if not authenticated
    return;
  }

  try {
    const currentFeedback = userFeedback[contestId];
    let isUndo = false;

    // Determine if this is an undo operation
    if ((isLike && currentFeedback === 'like') || (!isLike && currentFeedback === 'dislike')) {
      isUndo = true;
    }

    // Call the service to update feedback. The server derives the identity and
    // the new/switch/undo transition from the actual stored feedback; isUndo is
    // used only for the local optimistic UI update below.
    const updatedContest = await updateContestFeedback(contestId, isLike);

    if (updatedContest) {
      // Update the contest in the list
      const index = filteredContests.findIndex((c) => c.id === contestId);
      if (index !== -1) {
        filteredContests[index] = updatedContest;
        filteredContests = [...filteredContests]; // Trigger reactivity
      }

      // Update the user feedback state
      if (isUndo) {
        delete userFeedback[contestId];
      } else {
        userFeedback[contestId] = isLike ? 'like' : 'dislike';
      }
      userFeedback = { ...userFeedback }; // Trigger reactivity
    }
  } catch (err) {
    console.error('Error updating contest feedback:', err);
  }
}

// Seed the initial list from the server-provided contests so the first render
// (including SSR) shows data without waiting for a client-side fetch.
if (data?.contests && contests.length === 0) {
  contests = data.contests;
  filteredContests = sortContestsByLikes([...contests], 'desc');
  updateAvailableAuthors();
}

// Load contests on mount
onMount(() => {
  // Subscribe to auth state changes
  const unsubscribe = user.subscribe((value) => {
    isAuthenticated = !!value;

    // Reload user participation and feedback when auth state changes
    if (isAuthenticated) {
      fetchUserParticipation().then((participation) => {
        userParticipation = new SvelteSet(participation);
      });
      fetchUserFeedback().then((feedback) => {
        userFeedback = feedback;
      });
    } else {
      userParticipation = new SvelteSet();
      userFeedback = {};
    }
  });

  // Load contests
  loadContests();

  // Cleanup function
  return () => {
    unsubscribe();
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
              contests={filteredContests}
              userParticipation={userParticipation}
              userFeedback={userFeedback}
              allAuthors={availableAuthors}
              onToggleParticipation={handleToggleParticipation}
              onLike={handleLike}
              on:sortDifficulty={handleDifficultySort}
              on:filterAuthor={handleAuthorFilter}
              on:filterParticipated={handleParticipatedFilter}
              on:filterType={handleTypeFilter}
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
