<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { currentActor } from '$lib/auth/currentActor';
import {
  fetchLeaderboard,
  type LeaderboardEntry
} from '$lib/queries/leaderboardQueries';
import {
  fetchProblems,
  fetchSolvedProblemsForUser,
  type Problem
} from '$lib/queries/problemQueries';
import { createProblemEngagementController } from '$lib/problems/problemEngagementController';
import { problemEngagementGateway } from '$lib/problems/problemEngagementGateway.supabase';
import ProblemTable from '$lib/components/ProblemTable.svelte';
import TopicSidebar from '$lib/components/TopicSidebar.svelte';
import {
  NEW_PROBLEM_TOPIC,
  ProblemCollection,
  type ProblemTopic
} from '$lib/collections/problemCollection';

// Props
export let pageTitle = 'Problems';
export let targetUserId: string | null = null;
export let defaultSolvedFilterState: 'all' | 'solved' | 'unsolved' = 'all';
// Problems provided by a server-side load (e.g. the homepage). When present, the
// initial list renders without a client-side round-trip after hydration.
export let initialProblems: Problem[] | null = null;

// State variables
let collection = new ProblemCollection({ defaultSolvedFilter: defaultSolvedFilterState });
let loading: boolean = false;
let error: string | null = null;
let userFeedback: Record<string, 'like' | 'dislike' | null> = {};
let userSolvedProblems: Set<string> = new Set();
let sidebarOpen = false; // Default closed on mobile
let isMobile = false;
let isAuthenticated = false;
let leaderboardEntries: LeaderboardEntry[] = [];
let targetUserSolvedProblems: Set<string> = new Set();
let targetUser: LeaderboardEntry | null = null;

const engagement = createProblemEngagementController({
  actor: currentActor,
  gateway: problemEngagementGateway,
  getCollection: () => collection,
  setCollection: (nextCollection) => (collection = nextCollection),
  applySolvedToCollection: !targetUserId,
  reportError: (message) => (error = message)
});

function handleTopicSelect(topic: string | null): void {
  collection = collection.selectTopic(topic as ProblemTopic | null);
  if (isMobile) sidebarOpen = false;
}

// Function to toggle sidebar visibility
function toggleSidebar(): void {
  sidebarOpen = !sidebarOpen;
}

// Check if mobile
function checkMobile(): void {
  if (!browser) return;
  isMobile = window.innerWidth < 768;
}

async function handleLike(problemId: string, isLike: boolean): Promise<void> {
  await engagement.react(problemId, isLike);
}

async function handleToggleSolved(problemId: string, isSolved: boolean): Promise<void> {
  await engagement.setSolved(problemId, isSolved);
}

// Function to load problems
async function loadProblems() {
  // Skip the loading spinner when the list is already seeded from a server-side
  // load; the initial render is already showing data.
  const alreadySeeded = collection.sourceItems.length > 0;
  loading = !alreadySeeded;
  error = null;

  try {
    if (!alreadySeeded) {
      // Use problems from the server-side load when available; otherwise fetch them.
      const fetchedProblems = initialProblems ?? (await fetchProblems());

      collection = collection.withSourceItems(fetchedProblems);
    }

    // If we're viewing a specific user's page
    if (targetUserId) {
      // Fetch leaderboard data
      leaderboardEntries = await fetchLeaderboard();

      // Find the target user in the leaderboard
      targetUser = leaderboardEntries.find((entry) => entry.userId === targetUserId) || null;

      if (!targetUser) {
        error = 'User not found or is hidden from the leaderboard';
        loading = false;
        return;
      }

      // Fetch the target user's solved problems
      targetUserSolvedProblems = await fetchSolvedProblemsForUser(targetUserId);
      collection = collection.withSolvedProblemIds(targetUserSolvedProblems);
    }

  } catch (e) {
    console.error('Error loading problems:', e);
    error = 'Failed to load problems. Please try again later.';
  } finally {
    loading = false;
  }
}

// Seed the initial list from server-provided problems so the first render
// (including SSR) shows data without waiting for a client-side fetch.
if (initialProblems && collection.sourceItems.length === 0) {
  collection = collection.withSourceItems(initialProblems);
}

// Initialize component
onMount(() => {
  const unsubscribeEngagement = engagement.subscribe((state) => {
    isAuthenticated = state.isAuthenticated;
    userFeedback = state.feedback;
    userSolvedProblems = state.solvedProblemIds;
  });
  engagement.start();
  loadProblems();

  // Check if mobile
  checkMobile();

  // Add resize event listener
  window.addEventListener('resize', checkMobile);

  // Cleanup function
  return () => {
    unsubscribeEngagement();
    engagement.dispose();
    window.removeEventListener('resize', checkMobile);
  };
});
</script>

<svelte:head>
  <title>{targetUser ? `${targetUser.username}'s Solved Problems` : pageTitle}</title>
</svelte:head>

<div class="mx-auto w-full max-w-[1200px] px-0">
  <h1 class="sr-only">{targetUser ? `${targetUser.username}'s Solved Problems` : pageTitle}</h1>
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
        <p class="mt-2 text-gray-600">Loading problems...</p>
      </div>
    </div>
  {:else if error}
    <div class="flex h-[calc(100vh-4rem)] items-center justify-center py-2 text-center">
      <p class="text-lg text-red-500">{error}</p>
    </div>
  {:else}
    <div class="relative flex min-h-[calc(100vh-2rem)]">
      <!-- Topic Sidebar Component -->
      <TopicSidebar
        topics={[...collection.topicOptions]}
        newTopic={NEW_PROBLEM_TOPIC}
        selectedTopic={collection.selectedTopic}
        onSelectTopic={handleTopicSelect}
        isMobile={isMobile}
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
      />

      <!-- Main content -->
      <div class="flex w-full flex-1 md:pl-[14rem]">
        <div class="w-full min-w-0 px-0 py-2 pb-6">
          <div class="problem-table-container w-full">
            <ProblemTable
              problems={collection.rows}
              userFeedback={userFeedback}
              userSolvedProblems={userSolvedProblems}
              {isAuthenticated}
              allAuthors={collection.availableAuthors}
              difficultySortDirection={collection.difficultySortDirection}
              solvedFilterState={collection.solvedFilter}
              authorFilterValue={collection.selectedAuthor}
              sourceFilterValue={collection.sourceFilter}
              onLike={handleLike}
              onToggleSolved={handleToggleSolved}
              onDifficultySort={() => (collection = collection.cycleDifficultySort())}
              onSolvedFilter={() => (collection = collection.cycleSolvedFilter())}
              onAuthorFilter={(author) => (collection = collection.selectAuthor(author))}
              onSourceFilter={() => (collection = collection.cycleSourceFilter())}
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
.problem-table-container {
  width: 100%;
  margin: 0;
}

@media (min-width: 768px) {
  .problem-table-container {
    margin: 0;
  }
}
</style>
