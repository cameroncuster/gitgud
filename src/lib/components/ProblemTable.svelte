<script lang="ts">
import type { Problem } from '$lib/services/problem';
import { user } from '$lib/services/auth';
import { createEventDispatcher } from 'svelte';
import {
  cycleTableState,
  getDifficultyAriaSort,
  getDifficultySortLabel,
  getSortedAuthors,
  nextSortDirection,
  type SortDirection
} from '$lib/utils/table';
import RecommendersFilter from './RecommendersFilter.svelte';
import ResponsiveTableContainer from './ResponsiveTableContainer.svelte';
import TableFeedbackButtons from './TableFeedbackButtons.svelte';
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
let difficultySortDirection: SortDirection = null;
let solvedFilterState: 'all' | 'solved' | 'unsolved' = 'all';
let authorFilterValue: string | null = null;
let sourceFilterValue: 'all' | 'codeforces' | 'kattis' = 'all';
let uniqueAuthors: string[];

const SOLVED_FILTER_STATES = ['all', 'solved', 'unsolved'] as const;
const SOURCE_FILTER_STATES = ['all', 'codeforces', 'kattis'] as const;

// Subscribe to auth state
user.subscribe((value) => {
  isAuthenticated = !!value;
});

// We need to get all authors from the parent component
export let allAuthors: string[] = [];

// If allAuthors is not provided, fall back to extracting from current problems
$: uniqueAuthors = getSortedAuthors(problems, allAuthors);

function handleDifficultySort() {
  difficultySortDirection = nextSortDirection(difficultySortDirection);
  dispatch('sortDifficulty', { direction: difficultySortDirection });
}

function handleSolvedFilter() {
  solvedFilterState = cycleTableState(solvedFilterState, SOLVED_FILTER_STATES);
  dispatch('filterSolved', { state: solvedFilterState });
}

function handleSourceFilter() {
  sourceFilterValue = cycleTableState(sourceFilterValue, SOURCE_FILTER_STATES);
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

// Accessible names / state for the interactive column headers. Each announces
// the current filter/sort state and the action a press will take.
$: solvedFilterLabel =
  solvedFilterState === 'all'
    ? 'Filter by solved status (showing all)'
    : solvedFilterState === 'solved'
      ? 'Filter by solved status (showing solved)'
      : 'Filter by solved status (showing unsolved)';

$: sourceFilterLabel =
  sourceFilterValue === 'all'
    ? 'Filter by source (showing all)'
    : `Filter by source (showing ${sourceFilterValue})`;

$: difficultyAriaSort = getDifficultyAriaSort(difficultySortDirection);
$: difficultySortLabel = getDifficultySortLabel(difficultySortDirection);

// Function to get difficulty tooltip text
function getDifficultyTooltip(problem: Problem): string {
  if (problem.source === 'kattis') {
    return `Kattis difficulty mapped from 1-10 scale to 800-3500 rating range`;
  } else {
    return `${getRatingTierName(problem.difficulty)}`;
  }
}
</script>

<ResponsiveTableContainer variant="problem">
    <table
      class="w-full min-w-[900px] table-fixed border-collapse overflow-hidden bg-[var(--color-secondary)] font-mono text-sm"
    >
      <thead>
        <tr>
          <th
            scope="col"
            class="sticky top-0 z-10 w-[5%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-0 text-center font-bold"
          >
            <button
              type="button"
              class="flex w-full cursor-pointer items-center justify-center gap-1 p-3 font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]"
              on:click={handleSolvedFilter}
              aria-label={solvedFilterLabel}
              title={solvedFilterLabel}
            >
              {#if solvedFilterState === 'solved'}
                <span class="text-sm font-bold text-[var(--color-solved)]" aria-hidden="true">
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
                <span class="text-sm font-bold text-[var(--color-dislike)]" aria-hidden="true">
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
                <span class="text-sm font-bold text-[var(--color-text-muted)]" aria-hidden="true">
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
            </button>
          </th>
          <th
            scope="col"
            class="sticky top-0 z-10 w-[5%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-0 text-center font-bold"
          >
            <button
              type="button"
              class="flex w-full cursor-pointer items-center justify-center gap-1 p-3 font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]"
              on:click={handleSourceFilter}
              aria-label={sourceFilterLabel}
              title={sourceFilterLabel}
            >
              {#if sourceFilterValue === 'codeforces'}
                <span class="text-sm font-bold text-[#3B5998]" aria-hidden="true">
                  <div class="relative">
                    <img src={codeforcesLogo} alt="" class="h-5 w-5 object-contain" />
                    <div
                      class="absolute -right-1 -bottom-1 h-3 w-3 rounded border border-white bg-[#3B5998]"
                    ></div>
                  </div>
                </span>
              {:else if sourceFilterValue === 'kattis'}
                <span class="text-sm font-bold text-[#f2ae00]" aria-hidden="true">
                  <div class="relative">
                    <img src={kattisLogo} alt="" class="h-5 w-5 object-contain" />
                    <div
                      class="absolute -right-1 -bottom-1 h-3 w-3 rounded border border-white bg-[#f2ae00]"
                    ></div>
                  </div>
                </span>
              {:else}
                <span class="text-sm font-bold text-[var(--color-text-muted)]" aria-hidden="true">
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
            </button>
          </th>
          <th
            scope="col"
            class="sticky top-0 z-10 w-[25%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-3 text-left font-bold"
            >Problem</th
          >
          <th
            scope="col"
            aria-sort={difficultyAriaSort}
            class="sticky top-0 z-10 w-[11%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-0 text-center font-bold"
          >
            <button
              type="button"
              class="flex w-full cursor-pointer items-center justify-center gap-2 p-3 py-4 font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]"
              on:click={handleDifficultySort}
              aria-label={difficultySortLabel}
              title={difficultySortLabel}
            >
              {#if difficultySortDirection === 'asc'}
                <span class="text-sm font-bold text-[var(--color-accent)]" aria-hidden="true">▲</span>
              {:else if difficultySortDirection === 'desc'}
                <span class="text-sm font-bold text-[var(--color-accent)]" aria-hidden="true">▼</span>
              {:else}
                <span
                  class="flex flex-col text-sm leading-[1] font-bold text-[var(--color-text-muted)]"
                  aria-hidden="true"
                >
                  <span>▲</span>
                  <span>▼</span>
                </span>
              {/if}
              <span class="font-bold">Difficulty</span>
            </button>
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
            class={`relative border-b border-[var(--color-border)] transition-colors duration-200 last:border-b-0
            ${
              problem.id && userSolvedProblems.has(problem.id)
                ? 'border-l-4 border-l-[var(--color-solved)] bg-[var(--color-solved-row)]'
                : 'hover:bg-[var(--color-tertiary)]/30'
            }`}
          >
            <td class="p-3 text-center">
              {#if problem.id}
                {@const isSolved = userSolvedProblems.has(problem.id)}
                <button
                  class={`flex h-8 w-8 cursor-pointer items-center justify-center rounded transition-colors duration-300
                    ${isSolved
                      ? 'bg-[var(--color-solved)] text-white'
                      : 'border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[var(--color-solved)] hover:bg-[color-mix(in_oklab,var(--color-solved)_10%,transparent)] hover:text-[var(--color-solved)]'
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
                  <TableFeedbackButtons
                    likes={problem.likes}
                    dislikes={problem.dislikes}
                    feedback={userFeedback[problem.id]}
                    {isAuthenticated}
                    subject="problem"
                    iconSize={16}
                    onFeedback={(isLike) => onLike(problem.id!, isLike)}
                  />
                {/if}
              </div>
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="7" class="p-8 text-center text-[var(--color-text-muted)]">
              No problems match the current filters.
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
</ResponsiveTableContainer>

<style>
/* Ensure table is responsive and centered */
@media (max-width: 768px) {
  div {
    margin-right: auto;
    margin-left: auto;
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
