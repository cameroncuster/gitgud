<script lang="ts">
import type { Problem } from '$lib/services/problem';
import { user } from '$lib/services/auth';
import { createEventDispatcher } from 'svelte';
import RecommendersFilter from './RecommendersFilter.svelte';
// Use static image paths instead of imports
const codeforcesLogo = '/images/codeforces.png';
const kattisLogo = '/images/kattis.png';

// Event dispatcher
const dispatch = createEventDispatcher();

// Props
export let problems: Problem[] = [];
export let userFeedback: Record<string, 'like' | 'dislike' | null> = {};
export let userSolvedProblems: Set<string> = new Set();
export let onLike: (problemId: string, isLike: boolean) => Promise<void>;
export let onToggleSolved: (problemId: string, isSolved: boolean) => Promise<void>;

// State
let isAuthenticated = false;
let difficultySortDirection: 'asc' | 'desc' | null = null;
let solvedFilterState: 'all' | 'solved' | 'unsolved' = 'all';
let authorFilterValue: string | null = null;
let sourceFilterValue: 'all' | 'codeforces' | 'kattis' = 'all';
let uniqueAuthors: string[];

// Subscribe to auth state
user.subscribe((value) => {
  isAuthenticated = !!value;
});

// We need to get all authors from the parent component
export let allAuthors: string[] = [];

// If allAuthors is not provided, fall back to extracting from current problems
$: {
  if (allAuthors.length === 0) {
    uniqueAuthors = [...new Set(problems.map((p) => p.addedBy))].sort();
  } else {
    uniqueAuthors = [...allAuthors].sort();
  }
}

// Function to handle difficulty column click
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

// Function to handle solved filter click
function handleSolvedFilter() {
  // Toggle filter state: all -> solved -> unsolved -> all
  if (solvedFilterState === 'all') {
    solvedFilterState = 'solved';
  } else if (solvedFilterState === 'solved') {
    solvedFilterState = 'unsolved';
  } else {
    solvedFilterState = 'all';
  }

  // Dispatch event to parent component
  dispatch('filterSolved', { state: solvedFilterState });
}

// Function to handle author filter is now handled directly in the RecommendersFilter component

// Function to handle source filter click
function handleSourceFilter() {
  // Toggle filter state: all -> codeforces -> kattis -> all
  if (sourceFilterValue === 'all') {
    sourceFilterValue = 'codeforces';
  } else if (sourceFilterValue === 'codeforces') {
    sourceFilterValue = 'kattis';
  } else {
    sourceFilterValue = 'all';
  }

  // Dispatch event to parent component
  dispatch('filterSource', { source: sourceFilterValue === 'all' ? null : sourceFilterValue });
}

// Define common tiers
const TIERS = [
  [3000, 'Legendary Grandmaster'],
  [2600, 'International Grandmaster'],
  [2400, 'Grandmaster'],
  [2300, 'International Master'],
  [2100, 'Master'],
  [1900, 'Candidate Master'],
  [1600, 'Expert'],
  [1400, 'Specialist'],
  [1200, 'Pupil']
] as const;

// Get rating color class
function getRatingColor(rating: number | undefined): string {
  if (!rating) return 'unrated';
  const tier = TIERS.find(([min]) => rating >= min)?.[1];
  if (!tier) return 'newbie';
  return tier.toLowerCase().replace(' ', '-');
}

// Get rating tier display name
function getRatingTierName(rating: number | undefined): string {
  if (!rating) return 'Unrated';
  return TIERS.find(([min]) => rating >= min)?.[1] || 'Newbie';
}

// Function to get difficulty tooltip text
function getDifficultyTooltip(problem: Problem): string {
  if (problem.source === 'kattis') {
    return `Kattis difficulty mapped from 1-10 scale to 800-3500 rating range`;
  } else {
    return `${getRatingTierName(problem.difficulty)}`;
  }
}
</script>

<div class="mt-4 w-full">
  <div
    class="table-wrapper rounded-md border-2 border-[var(--color-border)] bg-[var(--color-secondary)]"
  >
    <table
      class="w-full min-w-[900px] table-fixed border-collapse overflow-hidden bg-[var(--color-secondary)] font-mono text-sm"
    >
      <thead>
        <tr>
          <th
            class="sticky top-0 z-10 w-[5%] cursor-pointer border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-center font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)]"
            on:click={handleSolvedFilter}
            title="Filter by solved status"
          >
            <div class="flex items-center justify-center gap-1">
              {#if solvedFilterState === 'solved'}
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
                    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" fill="none" opacity="0.2" />
                  </svg>
                </span>
              {:else if solvedFilterState === 'unsolved'}
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
                    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" fill="none" opacity="0.2" />
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
            class="sticky top-0 z-10 w-[5%] cursor-pointer border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-center font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)]"
            on:click={handleSourceFilter}
            title="Filter by source"
          >
            <div class="flex items-center justify-center gap-1">
              {#if sourceFilterValue === 'codeforces'}
                <span class="text-sm font-bold text-[#3B5998]">
                  <div class="relative">
                    <img src={codeforcesLogo} alt="Codeforces" class="h-5 w-5 object-contain" />
                    <div
                      class="absolute -right-1 -bottom-1 h-3 w-3 rounded border border-white bg-[#3B5998]"
                    ></div>
                  </div>
                </span>
              {:else if sourceFilterValue === 'kattis'}
                <span class="text-sm font-bold text-[#f2ae00]">
                  <div class="relative">
                    <img src={kattisLogo} alt="Kattis" class="h-5 w-5 object-contain" />
                    <div
                      class="absolute -right-1 -bottom-1 h-3 w-3 rounded border border-white bg-[#f2ae00]"
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
            class="sticky top-0 z-10 w-[25%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-left font-bold"
            >Problem</th
          >
          <th
            class="sticky top-0 z-10 w-[11%] cursor-pointer border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 py-4 text-center font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)]"
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
              <span class="font-bold">Difficulty</span>
            </div>
          </th>
          <th
            class="sticky top-0 z-10 w-[10%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-left font-bold"
            >Topic</th
          >
          <th
            class="sticky top-0 z-10 w-[24%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-left font-bold"
          >
            <div class="flex w-full items-center gap-2">
              <RecommendersFilter
                authors={uniqueAuthors}
                selectedAuthor={authorFilterValue}
                width="w-full"
                onAuthorChange={(author) => {
                  authorFilterValue = author;
                  dispatch('filterAuthor', { author: authorFilterValue });
                }}
              />
            </div>
          </th>
          <th
            class="sticky top-0 z-10 w-[20%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-right font-bold"
          ></th>
        </tr>
      </thead>
      <tbody>
        {#each problems as problem (problem.url)}
          <tr
            class="relative border-b border-[var(--color-border)] transition-colors duration-200 last:border-b-0
            ${problem.id && userSolvedProblems.has(problem.id)
              ? 'border-l-4 border-l-[rgb(34_197_94)] bg-[var(--color-solved-row)]'
              : 'hover:bg-[var(--color-tertiary)]/30'}"
          >
            <td class="p-3 text-center">
              {#if problem.id}
                {@const isSolved = userSolvedProblems.has(problem.id)}
                <button
                  class={`flex h-8 w-8 cursor-pointer items-center justify-center rounded transition-colors duration-300
                    ${isSolved
                      ? 'bg-[rgb(34_197_94)] text-white'
                      : 'border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[rgb(34_197_94)] hover:bg-[color-mix(in_oklab,rgb(34_197_94)_10%,transparent)] hover:text-[rgb(34_197_94)]'
                    } ${!isAuthenticated ? 'cursor-not-allowed opacity-50' : ''}`}
                  on:click={() => isAuthenticated && onToggleSolved(problem.id!, !isSolved)}
                  title={!isAuthenticated
                    ? 'Sign in to mark problems as solved'
                    : isSolved
                      ? 'Mark as unsolved'
                      : 'Mark as solved'}
                  disabled={!isAuthenticated}
                  aria-label={isSolved ? 'Mark as unsolved' : 'Mark as solved'}
                >
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
                    class="checkmark-icon stroke-2"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </button>
              {/if}
            </td>
            <td class="p-3 text-center">
              <span class="flex items-center justify-center">
                <img
                  src={problem.source === 'codeforces' ? codeforcesLogo : kattisLogo}
                  alt={problem.source}
                  class="h-6 w-6 object-contain"
                />
              </span>
            </td>
            <td class="truncate p-3">
              <a
                href={problem.url}
                target="_blank"
                rel="noopener noreferrer external"
                class="font-bold text-[var(--color-text)] hover:text-[var(--color-accent)] hover:underline"
                title={problem.name}
              >
                {problem.name}
              </a>
            </td>
            <td class="p-3 text-center">
              <span
                class="group relative inline-block rounded border px-2 py-1 font-bold
                  text-white
                   {problem.source === 'codeforces' ? 'cursor-default' : 'cursor-help'}"
                style="background-color: var(--color-{getRatingColor(problem.difficulty)})"
              >
                {problem.difficulty}
                <span
                  class="invisible absolute bottom-full left-1/2 z-50 -translate-x-1/2 transform rounded-md border border-[var(--color-border)] bg-[var(--color-secondary)] text-left text-xs leading-relaxed font-normal whitespace-pre-line text-[var(--color-text)] opacity-0 transition-opacity duration-300 group-hover:visible group-hover:opacity-100 {problem.source === 'codeforces'
                    ? 'w-auto max-w-fit min-w-0 p-1.5 px-3 text-center whitespace-nowrap'
                    : 'w-[280px] p-2.5'} mb-0.3"
                >
                  {getDifficultyTooltip(problem)}
                </span>
              </span>
            </td>
            <td class="p-3">
              {#if problem.type}
                <span
                  class="inline-block rounded border border-[var(--color-border)] bg-[var(--color-tertiary)] px-2 py-1 text-sm text-[var(--color-text)]"
                >
                  {problem.type}
                </span>
              {:else}
                <span
                  class="inline-block rounded border-2 border-dashed border-[var(--color-accent)] bg-transparent px-2 py-1 text-sm font-bold text-[var(--color-accent)]"
                >
                  NEW!
                </span>
              {/if}
            </td>
            <td class="truncate p-3">
              <a
                href={problem.addedByUrl}
                target="_blank"
                rel="noopener noreferrer external"
                class="text-[var(--color-username)] hover:text-[color-mix(in_oklab,var(--color-username)_80%,white)] hover:underline"
                title={"@" + problem.addedBy}
              >
                @{problem.addedBy}
              </a>
            </td>
            <td class="p-3 text-right">
              <div class="flex justify-end gap-2">
                {#if problem.id}
                  {@const hasLiked = userFeedback[problem.id] === 'like'}
                  {@const hasDisliked = userFeedback[problem.id] === 'dislike'}

                  <!-- Like button -->
                  <button
                    class={`flex cursor-pointer items-center gap-1 rounded border-2 px-2 py-1 transition-colors duration-200
                      ${hasLiked
                        ? 'border-[color-mix(in_oklab,rgb(34_197_94)_50%,transparent)] bg-[color-mix(in_oklab,rgb(34_197_94)_10%,transparent)] text-[rgb(34_197_94)]'
                        : 'border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[color-mix(in_oklab,rgb(34_197_94)_50%,transparent)] hover:bg-[color-mix(in_oklab,rgb(34_197_94)_10%,transparent)] hover:text-[rgb(34_197_94)]'
                      } ${!isAuthenticated ? 'cursor-not-allowed opacity-50' : ''}`}
                    on:click={() => isAuthenticated && onLike(problem.id!, true)}
                    title={!isAuthenticated
                      ? 'Sign in to like problems'
                      : hasLiked
                        ? 'Undo like'
                        : 'Like this problem'}
                    disabled={!isAuthenticated}
                  >
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
                      class="stroke-2"
                    >
                      <path
                        d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"
                      ></path>
                    </svg>
                    <span>{problem.likes}</span>
                  </button>

                  <!-- Dislike button -->
                  <button
                    class={`flex cursor-pointer items-center gap-1 rounded border-2 px-2 py-1 transition-colors duration-200
                      ${hasDisliked
                        ? 'border-[color-mix(in_oklab,rgb(239_68_68)_50%,transparent)] bg-[color-mix(in_oklab,rgb(239_68_68)_10%,transparent)] text-[rgb(239_68_68)]'
                        : 'border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[color-mix(in_oklab,rgb(239_68_68)_50%,transparent)] hover:bg-[color-mix(in_oklab,rgb(239_68_68)_10%,transparent)] hover:text-[rgb(239_68_68)]'
                      } ${!isAuthenticated ? 'cursor-not-allowed opacity-50' : ''}`}
                    on:click={() => isAuthenticated && onLike(problem.id!, false)}
                    title={!isAuthenticated
                      ? 'Sign in to dislike problems'
                      : hasDisliked
                        ? 'Undo dislike'
                        : 'Dislike this problem'}
                    disabled={!isAuthenticated}
                  >
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
                      class="stroke-2"
                    >
                      <path
                        d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"
                      ></path>
                    </svg>
                    <span>{problem.dislikes}</span>
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
/* Ensure table is responsive and centered */
@media (max-width: 768px) {
  div {
    margin-left: auto;
    margin-right: auto;
  }
}

/* Remove margin between sidebar and table */
@media (min-width: 768px) {
  .table-wrapper {
    margin-left: 0;
  }
}

/* Ensure feedback buttons don't get cut off */
td:last-child {
  min-width: 140px;
}

/* Ensure table fits within container */
.w-full {
  max-width: 100%;
}

/* Ensure proper table scrolling */
.table-wrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  width: 100%;
}

/* Basic styling for elements */
tr {
  overflow: hidden;
}

/* Button transitions */
button {
  transition: all 0.2s ease;
}

.checkmark-icon {
  transition: transform 0.2s ease;
}

/* Sortable header styles */
th {
  transition: background-color 0.2s ease;
}

/* Select styling is now handled in the RecommendersFilter component */

/* Ensure username is always blue */
a[href*='github.com'] {
  color: var(--color-username) !important;
  text-decoration: none;
}

a[href*='github.com']:hover {
  color: color-mix(in oklab, var(--color-username) 80%, white) !important;
  text-decoration: underline;
}

/* Add pixel-style border to buttons on hover */
button:hover {
  transform: translateY(1px);
}
</style>
