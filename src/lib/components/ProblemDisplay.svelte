<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import {
  fetchProblems,
  updateProblemFeedback,
  fetchUserFeedback,
  fetchUserSolvedProblems,
  fetchUserSolvedProblemsByUserId,
  toggleProblemSolved
} from '$lib/services/problem';
import type { Problem } from '$lib/services/problem';
import { fetchLeaderboard } from '$lib/services/leaderboard';
import type { LeaderboardEntry } from '$lib/services/leaderboard';
import { user } from '$lib/services/auth';
import ProblemTable from '$lib/components/ProblemTable.svelte';
import TopicSidebar from '$lib/components/TopicSidebar.svelte';

// Props
export let pageTitle = 'Problems';
export let targetUserId: string | null = null;
export let defaultSolvedFilterState: 'all' | 'solved' | 'unsolved' = 'all';
// Problems provided by a server-side load (e.g. the homepage). When present, the
// initial list renders without a client-side round-trip after hydration.
export let initialProblems: Problem[] | null = null;

// State variables
let problems: Problem[] = [];
let filteredProblems: Problem[] = [];
let loading: boolean = false;
let error: string | null = null;
let userFeedback: Record<string, 'like' | 'dislike' | null> = {};
let userSolvedProblems: Set<string> = new Set();
let selectedTopic: string | null = null;
let selectedAuthor: string | null = null;
let selectedSource: 'codeforces' | 'kattis' | null = null;
let solvedFilterState: 'all' | 'solved' | 'unsolved' = defaultSolvedFilterState;
let sidebarOpen = false; // Default closed on mobile
let isMobile = false;
let isAuthenticated = false;
let availableAuthors: string[] = [];
let leaderboardEntries: LeaderboardEntry[] = [];
let targetUserSolvedProblems: Set<string> = new Set();
let targetUser: LeaderboardEntry | null = null;

// Problem types
const PROBLEM_TYPES = ['graph', 'array', 'string', 'math', 'tree', 'queries', 'geometry', 'misc'];

// Function to calculate problem score (likes - dislikes)
function calculateScore(problem: Problem): number {
  return problem.likes - problem.dislikes;
}

// Function to sort problems by score (likes - dislikes)
function sortProblemsByScore(problemsToSort: Problem[]): Problem[] {
  // Group problems by score
  const problemsByScore: Record<number, Problem[]> = {};

  // Calculate score for each problem and group them
  problemsToSort.forEach((problem) => {
    const score = calculateScore(problem);
    if (!problemsByScore[score]) {
      problemsByScore[score] = [];
    }
    problemsByScore[score].push(problem);
  });

  Object.values(problemsByScore).forEach((group) => {
    group.sort((a, b) => {
      if (a.id && b.id) {
        return a.id.localeCompare(b.id);
      }
      return 0;
    });
  });

  // Get all scores and sort them in descending order
  const scores = Object.keys(problemsByScore)
    .map(Number)
    .sort((a, b) => b - a);

  // Flatten the groups in order of score
  return scores.flatMap((score) => problemsByScore[score]);
}

// Function to sort problems by difficulty
function sortProblemsByDifficulty(
  problemsToSort: Problem[],
  direction: 'asc' | 'desc' | null
): Problem[] {
  if (direction === null) {
    // If no direction specified, return to default sort (by score)
    return sortProblemsByScore([...problemsToSort]);
  }

  return [...problemsToSort].sort((a, b) => {
    // Handle undefined difficulties
    const diffA = a.difficulty ?? 0;
    const diffB = b.difficulty ?? 0;

    // Sort based on direction
    return direction === 'asc' ? diffA - diffB : diffB - diffA;
  });
}

// Special topic value for NEW problems
const NEW_TOPIC = 'NEW';

// Function to get problems filtered by everything except author
function getProblemsWithoutAuthorFilter(): Problem[] {
  let filtered = [...problems];

  // Apply topic filter if selected
  if (selectedTopic) {
    if (selectedTopic === NEW_TOPIC) {
      // For NEW topic, filter problems with null or undefined type
      filtered = filtered.filter((problem) => !problem.type);
    } else {
      filtered = filtered.filter((problem) => {
        // If topic is "misc", include problems with no type or with "misc" type
        if (selectedTopic === 'misc') {
          return !problem.type || problem.type === 'misc';
        }
        return problem.type === selectedTopic;
      });
    }
  }

  // Apply solved filter based on the appropriate solved problems set
  if (solvedFilterState !== 'all') {
    filtered = filtered.filter((problem) => {
      // If we're viewing a specific user's page, use their solved problems
      // Otherwise use the current user's solved problems
      const solvedProblemsSet = targetUserId ? targetUserSolvedProblems : userSolvedProblems;
      const isSolved = problem.id && solvedProblemsSet.has(problem.id);
      return solvedFilterState === 'solved' ? isSolved : !isSolved;
    });
  }

  // Apply source filter if selected
  if (selectedSource) {
    filtered = filtered.filter((problem) => problem.source === selectedSource);
  }

  return filtered;
}

// Function to filter problems by topic, solved status, and author
function filterProblems(): void {
  // Get problems filtered by everything except author
  let filtered = getProblemsWithoutAuthorFilter();

  // Update available authors based on current filters (except author filter)
  availableAuthors = [...new Set(filtered.map((p) => p.addedBy))].sort();

  // Apply author filter if selected
  if (selectedAuthor) {
    filtered = filtered.filter((problem) => problem.addedBy === selectedAuthor);
  }

  // Update filtered problems
  filteredProblems = filtered;

  // Auto-close sidebar on mobile after selection
  if (isMobile) {
    sidebarOpen = false;
  }
}

// Function to filter problems by topic
function filterProblemsByTopic(topic: string | null): void {
  selectedTopic = topic;
  filterProblems();
}

// Function to handle topic selection
function handleTopicSelect(topic: string | null): void {
  filterProblemsByTopic(topic);
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

// Function to handle like/dislike actions
async function handleLike(problemId: string, isLike: boolean): Promise<void> {
  try {
    // Check if user is authenticated
    if (!isAuthenticated) {
      error = 'You must be signed in to like or dislike problems';
      return;
    }

    // Check if user has already provided feedback for this problem
    const currentFeedback = userFeedback[problemId];

    // If user already gave the same feedback, treat as an "undo"
    if ((isLike && currentFeedback === 'like') || (!isLike && currentFeedback === 'dislike')) {
      // Update UI optimistically
      problems = problems.map((problem) => {
        if (problem.id === problemId) {
          if (isLike) {
            return { ...problem, likes: problem.likes - 1 };
          } else {
            return { ...problem, dislikes: problem.dislikes - 1 };
          }
        }
        return problem;
      });

      // Remove the user's feedback
      userFeedback = {
        ...userFeedback,
        [problemId]: null
      };

      // Update the database (server derives the undo from actual state)
      await updateProblemFeedback(problemId, isLike);

      // Update filtered problems
      filterProblems();
      return;
    }

    // Handle switching feedback (like to dislike or vice versa)
    if (currentFeedback) {
      // Update UI optimistically
      problems = problems.map((problem) => {
        if (problem.id === problemId) {
          if (isLike) {
            // Switching from dislike to like
            return {
              ...problem,
              likes: problem.likes + 1,
              dislikes: problem.dislikes - 1
            };
          } else {
            // Switching from like to dislike
            return {
              ...problem,
              likes: problem.likes - 1,
              dislikes: problem.dislikes + 1
            };
          }
        }
        return problem;
      });

      // Update user feedback - create a new object to ensure reactivity
      userFeedback = {
        ...userFeedback,
        [problemId]: isLike ? 'like' : 'dislike'
      };

      // Update the database (server derives the switch from actual state)
      await updateProblemFeedback(problemId, isLike);

      // Update filtered problems
      filterProblems();
      return;
    }

    // Handle new feedback
    // Update UI optimistically
    problems = problems.map((problem) => {
      if (problem.id === problemId) {
        if (isLike) {
          return { ...problem, likes: problem.likes + 1 };
        } else {
          return { ...problem, dislikes: problem.dislikes + 1 };
        }
      }
      return problem;
    });

    // Update user feedback - create a new object to ensure reactivity
    userFeedback = {
      ...userFeedback,
      [problemId]: isLike ? 'like' : 'dislike'
    };

    // Update the database
    await updateProblemFeedback(problemId, isLike);

    // Update filtered problems
    filterProblems();
  } catch (err) {
    console.error('Error updating feedback:', err);
    // If there's an error, reload problems to ensure UI is in sync with server
    loadProblems();
  }
}

// Function to handle marking problems as solved/unsolved
async function handleToggleSolved(problemId: string, isSolved: boolean): Promise<void> {
  try {
    // Check if user is authenticated
    if (!isAuthenticated) {
      error = 'You must be signed in to mark problems as solved';
      return;
    }

    // Update UI optimistically
    if (isSolved) {
      userSolvedProblems = new Set([...userSolvedProblems, problemId]);
    } else {
      userSolvedProblems = new Set([...userSolvedProblems].filter((id) => id !== problemId));
    }

    // Update the database
    const success = await toggleProblemSolved(problemId, isSolved);

    if (!success) {
      // If there's an error, reload solved problems to ensure UI is in sync with server
      if (isAuthenticated) {
        userSolvedProblems = await fetchUserSolvedProblems();
      }
    }
  } catch (err) {
    console.error('Error updating solved status:', err);
    // If there's an error, reload solved problems to ensure UI is in sync with server
    if (isAuthenticated) {
      userSolvedProblems = await fetchUserSolvedProblems();
    }
  }
}

// Function to handle difficulty sorting
function handleDifficultySort({ detail }: CustomEvent<{ direction: 'asc' | 'desc' | null }>) {
  // Get problems with all filters except author
  const problemsWithoutAuthorFilter = getProblemsWithoutAuthorFilter();

  // Update available authors
  availableAuthors = [...new Set(problemsWithoutAuthorFilter.map((p) => p.addedBy))].sort();

  // Sort the problems by difficulty
  filteredProblems = sortProblemsByDifficulty(filteredProblems, detail.direction);
}

// Function to handle solved filter
function handleSolvedFilter({ detail }: CustomEvent<{ state: 'all' | 'solved' | 'unsolved' }>) {
  solvedFilterState = detail.state;
  filterProblems();
}

// Function to handle author filter
function handleAuthorFilter({ detail }: CustomEvent<{ author: string | null }>) {
  selectedAuthor = detail.author;
  filterProblems();
}

// Function to handle source filter
function handleSourceFilter({ detail }: CustomEvent<{ source: 'codeforces' | 'kattis' | null }>) {
  selectedSource = detail.source;
  filterProblems();
}

// Function to load problems
async function loadProblems() {
  // Skip the loading spinner when the list is already seeded from a server-side
  // load; the initial render is already showing data.
  const alreadySeeded = problems.length > 0;
  loading = !alreadySeeded;
  error = null;

  try {
    if (!alreadySeeded) {
      // Use problems from the server-side load when available; otherwise fetch them.
      const fetchedProblems = initialProblems ?? (await fetchProblems());

      // Sort by score only on initial load
      problems = sortProblemsByScore(fetchedProblems);
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
      targetUserSolvedProblems = await fetchUserSolvedProblemsByUserId(targetUserId);
    }

    // Initialize available authors with all authors
    availableAuthors = [...new Set(problems.map((p) => p.addedBy))].sort();

    // Initialize filtered problems using our filter function
    if (!alreadySeeded) {
      filterProblems();
    }

    // Load user feedback and solved problems from database if authenticated
    if (isAuthenticated) {
      userFeedback = await fetchUserFeedback();
      userSolvedProblems = await fetchUserSolvedProblems();
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
if (initialProblems && problems.length === 0) {
  problems = sortProblemsByScore(initialProblems);
  availableAuthors = [...new Set(problems.map((p) => p.addedBy))].sort();
  filterProblems();
}

// Initialize component
onMount(() => {
  // If we're viewing a specific user's page and targetUserId wasn't provided as a prop
  if (!targetUserId && window.location.pathname.includes('/user/')) {
    // Get the userId from the URL
    const pathParts = window.location.pathname.split('/');
    targetUserId = pathParts[pathParts.length - 1];
  }

  loadProblems();

  // Subscribe to auth state changes
  const unsubscribe = user.subscribe((value) => {
    isAuthenticated = !!value;

    // Reload user feedback and solved problems when auth state changes
    if (isAuthenticated) {
      fetchUserFeedback().then((feedback) => {
        userFeedback = feedback;
      });
      fetchUserSolvedProblems().then((solved) => {
        userSolvedProblems = solved;
      });
    } else {
      userFeedback = {};
      userSolvedProblems = new Set();
    }
  });

  // Check if mobile
  checkMobile();

  // Add resize event listener
  window.addEventListener('resize', checkMobile);

  // Cleanup function
  return () => {
    unsubscribe();
    window.removeEventListener('resize', checkMobile);
  };
});
</script>

<svelte:head>
  <title>{targetUser ? `${targetUser.username}'s Solved Problems` : pageTitle}</title>
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
        topics={PROBLEM_TYPES}
        selectedTopic={selectedTopic}
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
              problems={filteredProblems}
              userFeedback={userFeedback}
              userSolvedProblems={userSolvedProblems}
              allAuthors={availableAuthors}
              onLike={handleLike}
              onToggleSolved={handleToggleSolved}
              on:sortDifficulty={handleDifficultySort}
              on:filterSolved={handleSolvedFilter}
              on:filterAuthor={handleAuthorFilter}
              on:filterSource={handleSourceFilter}
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
