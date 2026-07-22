<script lang="ts">
import type { Contest } from '$lib/services/contest';
import { formatDuration } from '$lib/services/contest';
import { user } from '$lib/services/auth';
import { createEventDispatcher } from 'svelte';
import RecommendersFilter from './RecommendersFilter.svelte';

// Event dispatcher
const dispatch = createEventDispatcher();

// Use static image paths for logos
const codeforcesLogo = '/images/codeforces.png';
const icpcLogo = '/images/icpc.svg';

// Props
export let contests: Contest[] = [];
export let userParticipation: Set<string> = new Set();
export let userFeedback: Record<string, 'like' | 'dislike' | null> = {};
export let onToggleParticipation: (contestId: string, hasParticipated: boolean) => Promise<void>;
export let onLike: (contestId: string, isLike: boolean) => Promise<void>;
export let allAuthors: string[] = []; // New prop for filtered authors

// Computed
$: isAuthenticated = !!$user;

// Filter states
let difficultyFilter: number | null = null;
let difficultySortDirection: 'asc' | 'desc' | null = null;
let participatedFilterState: 'participated' | 'not-participated' | 'all' = 'all';
let authorFilter: string | null = null;
let typeFilterState: 'all' | 'icpc' | 'codeforces' = 'all';

// Get unique authors for filter dropdown
// If allAuthors is provided, use it; otherwise, fall back to extracting from current contests
$: uniqueAuthors =
  allAuthors.length > 0
    ? [...allAuthors].sort()
    : [...new Set(contests.map((contest) => contest.addedBy))].sort();

// Apply filters to contests
$: filteredContests = contests.filter((contest) => {
  // Filter by difficulty
  if (difficultyFilter !== null && contest.difficulty !== difficultyFilter) {
    return false;
  }

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

  // Filter by author
  if (authorFilter && contest.addedBy !== authorFilter) {
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

// Handle filter changes
function handleParticipatedFilter() {
  if (participatedFilterState === 'all') {
    participatedFilterState = 'participated';
  } else if (participatedFilterState === 'participated') {
    participatedFilterState = 'not-participated';
  } else {
    participatedFilterState = 'all';
  }

  // Dispatch event to parent component
  dispatch('filterParticipated', { state: participatedFilterState });
}

// Handle contest type filter
function handleTypeFilter() {
  if (typeFilterState === 'all') {
    typeFilterState = 'icpc';
  } else if (typeFilterState === 'icpc') {
    typeFilterState = 'codeforces';
  } else {
    typeFilterState = 'all';
  }

  // Dispatch event to parent component
  dispatch('filterType', { type: typeFilterState });
}

// Handle difficulty sort
function handleDifficultySort() {
  // Toggle sort direction: null -> asc -> desc -> null
  if (difficultySortDirection === null) {
    difficultySortDirection = 'asc';
  } else if (difficultySortDirection === 'asc') {
    difficultySortDirection = 'desc';
  } else {
    difficultySortDirection = null;
  }

  // Dispatch event to parent component
  dispatch('sortDifficulty', { direction: difficultySortDirection });
}

// Function to handle author filter is now handled directly in the RecommendersFilter component

// Generate star rating display
function getDifficultyStars(difficulty: number | undefined): string {
  if (difficulty === undefined) return '';

  const fullStar = '★';
  const emptyStar = '☆';

  return fullStar.repeat(difficulty) + emptyStar.repeat(5 - difficulty);
}

// Get color class based on difficulty
function getDifficultyColorClass(difficulty: number | undefined): string {
  if (difficulty === undefined) return 'text-gray-400';

  const colors = [
    'text-green-500', // 1 - Easy
    'text-blue-500', // 2 - Medium-Easy
    'text-yellow-500', // 3 - Medium
    'text-orange-500', // 4 - Medium-Hard
    'text-red-500' // 5 - Hard
  ];

  return colors[Math.min(difficulty, 5) - 1];
}
</script>

<div class="mt-4 w-full">
  <div
    class="table-wrapper rounded-md border-2 border-[var(--color-border)] bg-[var(--color-secondary)] shadow-[2px_2px_0_rgba(0,0,0,0.1)]"
  >
    <table
      class="w-full min-w-[900px] table-fixed border-collapse overflow-hidden bg-[var(--color-secondary)] font-mono text-sm"
    >
      <thead>
        <tr>
          <th
            class="sticky top-0 z-10 w-[5%] cursor-pointer border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-center font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)]"
            on:click={handleParticipatedFilter}
            title="Filter by participation status"
          >
            <div class="flex items-center justify-center gap-1">
              {#if participatedFilterState === 'participated'}
                <span class="text-sm font-bold text-[rgb(34_197_94)]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
              {:else if participatedFilterState === 'not-participated'}
                <span class="text-sm font-bold text-[rgb(239_68_68)]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </span>
              {:else}
                <span class="text-sm font-bold text-[var(--color-text-muted)]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                  </svg>
                </span>
              {/if}
            </div>
          </th>
          <th
            class="sticky top-0 z-10 w-[6%] cursor-pointer border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-center font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)]"
            style="min-width: 50px;"
            on:click={handleTypeFilter}
            title="Filter by contest type"
          >
            <div class="flex items-center justify-center gap-1">
              {#if typeFilterState === 'icpc'}
                <span class="text-sm font-bold text-[rgb(34_197_94)]">
                  <div class="relative">
                    <img src={icpcLogo} alt="ICPC" class="h-6 w-6 object-contain" />
                    <div
                      class="absolute -right-1 -bottom-1 h-3 w-3 rounded border border-white bg-[rgb(34_197_94)]"
                    ></div>
                  </div>
                </span>
              {:else if typeFilterState === 'codeforces'}
                <span class="text-sm font-bold text-[rgb(239_68_68)]">
                  <div class="relative">
                    <img src={codeforcesLogo} alt="Codeforces" class="h-5 w-5 object-contain" />
                    <div
                      class="absolute -right-1 -bottom-1 h-3 w-3 rounded border border-white bg-[rgb(239_68_68)]"
                    ></div>
                  </div>
                </span>
              {:else}
                <span class="text-sm font-bold text-[var(--color-text-muted)]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                  </svg>
                </span>
              {/if}
            </div>
          </th>
          <th
            class="sticky top-0 z-10 w-[34%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-left font-bold"
          >
            Contest
          </th>
          <th
            class="sticky top-0 z-10 w-[12%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-center font-bold"
          >
            Duration
          </th>
          <th
            class="sticky top-0 z-10 w-[15%] cursor-pointer border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-center font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)]"
            on:click={handleDifficultySort}
            title="Click to sort by difficulty"
          >
            <div class="flex items-center justify-center gap-2">
              {#if difficultySortDirection === 'asc'}
                <span class="text-sm font-bold text-[var(--color-accent)]">▲</span>
              {:else if difficultySortDirection === 'desc'}
                <span class="text-sm font-bold text-[var(--color-accent)]">▼</span>
              {:else}
                <span
                  class="flex flex-col text-sm leading-[1] font-bold text-[var(--color-text-muted)]"
                >
                  <span>▲</span>
                  <span>▼</span>
                </span>
              {/if}
              <span>Difficulty</span>
            </div>
          </th>
          <th
            class="sticky top-0 z-10 w-[21%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-left font-bold"
          >
            <div class="flex items-center gap-2">
              <RecommendersFilter
                authors={uniqueAuthors}
                selectedAuthor={authorFilter}
                width="w-auto min-w-[160px]"
                onAuthorChange={(author) => {
                  authorFilter = author;
                  dispatch('filterAuthor', { author: authorFilter });
                }}
              />
            </div>
          </th>
          <th
            class="sticky top-0 z-10 w-[5%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-right font-bold"
          ></th>
        </tr>
      </thead>
      <tbody>
        {#each filteredContests as contest (contest.url)}
          <tr
            class="relative border-b border-[var(--color-border)] transition-colors duration-200 last:border-b-0
            ${contest.id && userParticipation.has(contest.id)
              ? 'border-l-4 border-l-[rgb(34_197_94)] bg-[var(--color-solved-row)]'
              : 'hover:bg-[var(--color-tertiary)]/30'}"
          >
            <td class="p-3 text-center">
              {#if contest.id}
                {@const hasParticipated = userParticipation.has(contest.id)}
                <button
                  class={`flex h-8 w-8 cursor-pointer items-center justify-center rounded shadow-[1px_1px_0_rgba(0,0,0,0.1)] transition-all duration-300
                    ${hasParticipated
                      ? 'bg-[rgb(34_197_94)] text-white'
                      : 'border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[rgb(34_197_94)] hover:bg-[color-mix(in_oklab,rgb(34_197_94)_10%,transparent)] hover:text-[rgb(34_197_94)]'
                    } ${!isAuthenticated ? 'cursor-not-allowed opacity-50' : ''}`}
                  on:click={() => isAuthenticated && onToggleParticipation(contest.id!, !hasParticipated)}
                  title={hasParticipated ? 'Mark as not participated' : 'Mark as participated'}
                  aria-label={hasParticipated ? 'Mark as not participated' : 'Mark as participated'}
                  disabled={!isAuthenticated}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </button>
              {/if}
            </td>
            <td class="p-3 text-center" style="min-width: 50px;">
              <span class="flex items-center justify-center">
                {#if contest.type === 'ICPC'}
                  <img src={icpcLogo} alt="ICPC" class="h-8 w-8 object-contain" />
                {:else}
                  <img src={codeforcesLogo} alt="Codeforces" class="h-6 w-6 object-contain" />
                {/if}
              </span>
            </td>
            <td class="truncate p-3">
              <a
                href={contest.url}
                target="_blank"
                rel="noopener noreferrer external"
                class="text-[var(--color-text)] hover:text-[var(--color-accent)] hover:underline"
                title={contest.name}
              >
                {contest.name}
              </a>
            </td>
            <td class="p-3 text-center">
              <span class="font-mono text-sm font-medium">
                {formatDuration(contest.durationSeconds)}
              </span>
            </td>
            <td class="p-3 text-center">
              {#if contest.difficulty !== undefined}
                <span class={`text-2xl font-bold ${getDifficultyColorClass(contest.difficulty)}`}>
                  {getDifficultyStars(contest.difficulty)}
                </span>
              {:else}
                <span class="text-[var(--color-text-muted)]">-</span>
              {/if}
            </td>
            <td class="p-3 text-left">
              <a
                href={contest.addedByUrl}
                target="_blank"
                rel="noopener noreferrer external"
                class="text-[var(--color-username)] hover:underline"
              >
                @{contest.addedBy}
              </a>
            </td>
            <td class="p-3 text-right">
              <div class="flex justify-end gap-2">
                {#if contest.id}
                  {@const hasLiked = userFeedback[contest.id] === 'like'}
                  {@const hasDisliked = userFeedback[contest.id] === 'dislike'}

                  <!-- Like button -->
                  <button
                    class={`flex cursor-pointer items-center gap-1 rounded border-2 px-2 py-1 transition-all duration-200
                      ${hasLiked
                        ? 'border-[color-mix(in_oklab,rgb(34_197_94)_50%,transparent)] bg-[color-mix(in_oklab,rgb(34_197_94)_10%,transparent)] text-[rgb(34_197_94)]'
                        : 'border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[color-mix(in_oklab,rgb(34_197_94)_50%,transparent)] hover:bg-[color-mix(in_oklab,rgb(34_197_94)_10%,transparent)] hover:text-[rgb(34_197_94)]'
                      } ${!isAuthenticated ? 'cursor-not-allowed opacity-50' : ''}`}
                    on:click={() => isAuthenticated && onLike(contest.id!, true)}
                    title={!isAuthenticated
                      ? 'Sign in to like contests'
                      : hasLiked
                        ? 'Undo like'
                        : 'Like this contest'}
                    disabled={!isAuthenticated}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="stroke-2"
                    >
                      <path
                        d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"
                      ></path>
                    </svg>
                    <span>{contest.likes}</span>
                  </button>

                  <!-- Dislike button -->
                  <button
                    class={`flex cursor-pointer items-center gap-1 rounded border-2 px-2 py-1 transition-all duration-200
                      ${hasDisliked
                        ? 'border-[color-mix(in_oklab,rgb(239_68_68)_50%,transparent)] bg-[color-mix(in_oklab,rgb(239_68_68)_10%,transparent)] text-[rgb(239_68_68)]'
                        : 'border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[color-mix(in_oklab,rgb(239_68_68)_50%,transparent)] hover:bg-[color-mix(in_oklab,rgb(239_68_68)_10%,transparent)] hover:text-[rgb(239_68_68)]'
                      } ${!isAuthenticated ? 'cursor-not-allowed opacity-50' : ''}`}
                    on:click={() => isAuthenticated && onLike(contest.id!, false)}
                    title={!isAuthenticated
                      ? 'Sign in to dislike contests'
                      : hasDisliked
                        ? 'Undo dislike'
                        : 'Dislike this contest'}
                    disabled={!isAuthenticated}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="stroke-2"
                    >
                      <path
                        d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"
                      ></path>
                    </svg>
                    <span>{contest.dislikes}</span>
                  </button>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
/* Ensure the table is responsive */
.table-wrapper {
  overflow-x: auto;
  position: relative;
}

/* Add smooth transitions for buttons */
button {
  transition: all 0.2s ease;
}

/* Add hover effects */
button:hover {
  transform: translateY(1px);
}

/* Ensure proper text truncation */
.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
