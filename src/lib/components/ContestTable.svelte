<script lang="ts">
import type { Contest } from '$lib/services/contest';
import { formatDuration } from '$lib/services/contest';
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
let difficultySortDirection: SortDirection = null;
let participatedFilterState: 'participated' | 'not-participated' | 'all' = 'all';
let authorFilter: string | null = null;
let typeFilterState: 'all' | 'icpc' | 'codeforces' = 'all';

const PARTICIPATION_FILTER_STATES = ['all', 'participated', 'not-participated'] as const;
const TYPE_FILTER_STATES = ['all', 'icpc', 'codeforces'] as const;

// Get unique authors for filter dropdown
// If allAuthors is provided, use it; otherwise, fall back to extracting from current contests
$: uniqueAuthors = getSortedAuthors(contests, allAuthors);

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

// Accessible names / state for the interactive column headers.
$: participatedFilterLabel =
  participatedFilterState === 'all'
    ? 'Filter by participation status (showing all)'
    : participatedFilterState === 'participated'
      ? 'Filter by participation status (showing participated)'
      : 'Filter by participation status (showing not participated)';

$: typeFilterLabel =
  typeFilterState === 'all'
    ? 'Filter by contest type (showing all)'
    : typeFilterState === 'icpc'
      ? 'Filter by contest type (showing ICPC)'
      : 'Filter by contest type (showing Codeforces)';

$: difficultyAriaSort = getDifficultyAriaSort(difficultySortDirection);
$: difficultySortLabel = getDifficultySortLabel(difficultySortDirection);

function handleParticipatedFilter() {
  participatedFilterState = cycleTableState(
    participatedFilterState,
    PARTICIPATION_FILTER_STATES
  );
  dispatch('filterParticipated', { state: participatedFilterState });
}

function handleTypeFilter() {
  typeFilterState = cycleTableState(typeFilterState, TYPE_FILTER_STATES);
  dispatch('filterType', { type: typeFilterState });
}

function handleDifficultySort() {
  difficultySortDirection = nextSortDirection(difficultySortDirection);
  dispatch('sortDifficulty', { direction: difficultySortDirection });
}

// Generate star rating display
function getDifficultyStars(difficulty: number | undefined): string {
  if (difficulty === undefined) return '';

  const fullStar = '★';
  const emptyStar = '☆';

  return fullStar.repeat(difficulty) + emptyStar.repeat(5 - difficulty);
}

// Get color class based on difficulty. Uses theme-token star colors that meet
// the large-text contrast bar (>= 3:1) on both the Paper and Dark grounds,
// rather than the fixed Tailwind hues that failed on paper.
function getDifficultyColorClass(difficulty: number | undefined): string {
  if (difficulty === undefined) return 'text-[var(--color-text-muted)]';

  const colors = [
    'text-[var(--color-star-1)]', // 1 - Easy
    'text-[var(--color-star-2)]', // 2 - Medium-Easy
    'text-[var(--color-star-3)]', // 3 - Medium
    'text-[var(--color-star-4)]', // 4 - Medium-Hard
    'text-[var(--color-star-5)]' // 5 - Hard
  ];

  return colors[Math.min(difficulty, 5) - 1];
}

// Accessible label for the star rating, e.g. "Difficulty: 3 of 5".
function getDifficultyLabel(difficulty: number | undefined): string {
  if (difficulty === undefined) return 'Difficulty not rated';
  return `Difficulty: ${difficulty} of 5`;
}
</script>

<ResponsiveTableContainer variant="contest">
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
              on:click={handleParticipatedFilter}
              aria-label={participatedFilterLabel}
              title={participatedFilterLabel}
            >
              {#if participatedFilterState === 'participated'}
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
                  </svg>
                </span>
              {:else if participatedFilterState === 'not-participated'}
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
            </button>
          </th>
          <th
            scope="col"
            class="sticky top-0 z-10 w-[6%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-0 text-center font-bold"
            style="min-width: 50px;"
          >
            <button
              type="button"
              class="flex w-full cursor-pointer items-center justify-center gap-1 p-3 font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]"
              on:click={handleTypeFilter}
              aria-label={typeFilterLabel}
              title={typeFilterLabel}
            >
              {#if typeFilterState === 'icpc'}
                <span class="text-sm font-bold text-[var(--color-solved)]" aria-hidden="true">
                  <div class="relative">
                    <img src={icpcLogo} alt="" class="h-6 w-6 object-contain" />
                    <div
                      class="absolute -right-1 -bottom-1 h-3 w-3 rounded border border-white bg-[var(--color-solved)]"
                    ></div>
                  </div>
                </span>
              {:else if typeFilterState === 'codeforces'}
                <span class="text-sm font-bold text-[var(--color-dislike)]" aria-hidden="true">
                  <div class="relative">
                    <img src={codeforcesLogo} alt="" class="h-5 w-5 object-contain" />
                    <div
                      class="absolute -right-1 -bottom-1 h-3 w-3 rounded border border-white bg-[var(--color-dislike)]"
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
            scope="col"
            aria-sort={difficultyAriaSort}
            class="sticky top-0 z-10 w-[15%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-0 text-center font-bold"
          >
            <button
              type="button"
              class="flex w-full cursor-pointer items-center justify-center gap-2 p-3 font-bold transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--color-tertiary)_90%,var(--color-accent)_10%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]"
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
              <span>Difficulty</span>
            </button>
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
            class={`relative border-b border-[var(--color-border)] transition-colors duration-200 last:border-b-0
            ${
              contest.id && userParticipation.has(contest.id)
                ? 'border-l-4 border-l-[var(--color-solved)] bg-[var(--color-solved-row)]'
                : 'hover:bg-[var(--color-tertiary)]/30'
            }`}
          >
            <td class="p-3 text-center">
              {#if contest.id}
                {@const hasParticipated = userParticipation.has(contest.id)}
                <button
                  class={`flex h-8 w-8 cursor-pointer items-center justify-center rounded transition-colors duration-300
                    ${hasParticipated
                      ? 'bg-[var(--color-solved)] text-white'
                      : 'border-2 border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:border-[var(--color-solved)] hover:bg-[color-mix(in_oklab,var(--color-solved)_10%,transparent)] hover:text-[var(--color-solved)]'
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
                <span
                  class={`text-2xl font-bold ${getDifficultyColorClass(contest.difficulty)}`}
                  role="img"
                  aria-label={getDifficultyLabel(contest.difficulty)}
                >
                  <span aria-hidden="true">{getDifficultyStars(contest.difficulty)}</span>
                </span>
              {:else}
                <span class="text-[var(--color-text-muted)]" aria-label={getDifficultyLabel(undefined)}
                  ><span aria-hidden="true">-</span></span
                >
              {/if}
            </td>
            <td class="p-3 text-left">
              <a
                href={contest.addedByUrl}
                target="_blank"
                rel="noopener noreferrer external"
                class="text-[var(--color-username)] hover:text-[color-mix(in_oklab,var(--color-username)_80%,white)] hover:underline"
                title={'@' + contest.addedBy}
              >
                @{contest.addedBy}
              </a>
            </td>
            <td class="p-3 text-right">
              <div class="flex justify-end gap-2">
                {#if contest.id}
                  <TableFeedbackButtons
                    likes={contest.likes}
                    dislikes={contest.dislikes}
                    feedback={userFeedback[contest.id]}
                    {isAuthenticated}
                    subject="contest"
                    iconSize={18}
                    onFeedback={(isLike) => onLike(contest.id!, isLike)}
                  />
                {/if}
              </div>
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="7" class="p-8 text-center text-[var(--color-text-muted)]">
              No contests match the current filters.
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
</ResponsiveTableContainer>

<style>
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
