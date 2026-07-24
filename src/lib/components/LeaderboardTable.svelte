<script lang="ts">
import { resolve } from '$app/paths';
import type { LeaderboardEntry } from '$lib/queries/leaderboardQueries';

// Props
export let leaderboardEntries: LeaderboardEntry[] = [];

// Format large numbers with commas
function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Get rank color class based on Codeforces tier system - sequential assignment
function getRankColor(rank: number): string {
  if (rank === 1) return 'legendary-grandmaster';
  if (rank === 2) return 'international-grandmaster';
  if (rank === 3) return 'grandmaster';
  if (rank === 4) return 'international-master';
  if (rank === 5) return 'master';
  if (rank === 6) return 'candidate-master';
  if (rank === 7) return 'expert';
  if (rank === 8) return 'specialist';
  if (rank === 9) return 'pupil';
  return 'newbie';
}

// Get rank tier name for display - sequential assignment
function getRankTierName(rank: number): string {
  if (rank === 1) return 'Legendary Grandmaster';
  if (rank === 2) return 'International Grandmaster';
  if (rank === 3) return 'Grandmaster';
  if (rank === 4) return 'International Master';
  if (rank === 5) return 'Master';
  if (rank === 6) return 'Candidate Master';
  if (rank === 7) return 'Expert';
  if (rank === 8) return 'Specialist';
  if (rank === 9) return 'Pupil';
  return 'Newbie';
}
</script>

<div class="mt-4 w-full">
  <div
    class="table-wrapper rounded-md border-2 border-[var(--color-border)] bg-[var(--color-secondary)]"
  >
    <table
      class="w-full table-fixed border-collapse overflow-hidden bg-[var(--color-secondary)] font-mono text-sm"
    >
      <thead>
        <tr>
          <th
            class="sticky top-0 z-10 w-[15%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-2 text-center font-bold sm:w-[10%] sm:p-3"
          >
            Rank
          </th>
          <th
            class="sticky top-0 z-10 w-[55%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-2 text-left font-bold sm:w-[60%] sm:p-3"
          >
            User
          </th>
          <th
            class="sticky top-0 z-10 w-[30%] border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-2 text-center font-bold sm:p-3"
          >
            Solves
          </th>
        </tr>
      </thead>
      <tbody>
        {#each leaderboardEntries as entry (entry.username)}
          <tr
            class="relative border-b border-[var(--color-border)] transition-colors duration-200 last:border-b-0 hover:bg-[var(--color-tertiary)]/30"
          >
            <td class="p-2 text-center sm:p-3">
              <!-- Rank with styling based on Codeforces tiers -->
              {#if entry.rank === 1}
                <span
                  class="inline-flex h-8 w-8 items-center justify-center rounded border-2 border-black font-bold text-white"
                  style="background-color: var(--color-{getRankColor(entry.rank)})"
                  title={getRankTierName(entry.rank)}
                >
                  {entry.rank}
                </span>
              {:else if entry.rank <= 9}
                <span
                  class="inline-flex h-8 w-8 items-center justify-center rounded font-bold text-white"
                  style="background-color: var(--color-{getRankColor(entry.rank)})"
                  title={getRankTierName(entry.rank)}
                >
                  {entry.rank}
                </span>
              {:else}
                <span
                  class="inline-flex h-8 w-8 items-center justify-center rounded bg-[var(--color-newbie)] font-bold text-white"
                  title="Newbie"
                >
                  {entry.rank}
                </span>
              {/if}
            </td>
            <td class="p-2 sm:p-3">
              <div class="flex items-center gap-1 sm:gap-3">
                {#if entry.avatarUrl}
                  <img
                    src={entry.avatarUrl}
                    alt={entry.username}
                    class="h-8 w-8 rounded sm:h-10 sm:w-10"
                  />
                {:else}
                  <div
                    class="flex h-8 w-8 items-center justify-center rounded bg-[var(--color-tertiary)] text-xs font-medium sm:h-10 sm:w-10 sm:text-sm"
                  >
                    {entry.username.substring(0, 2).toUpperCase()}
                  </div>
                {/if}
                <div class="flex items-center gap-2">
                  <a
                    href={resolve(`/user/${entry.userId}`)}
                    class="text-[var(--color-username)] hover:text-[color-mix(in_oklab,var(--color-username)_80%,white)] hover:underline"
                    title={"View @" + entry.username + "'s solved problems"}
                  >
                    @{entry.username}
                  </a>
                  <a
                    href={entry.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer external"
                    class="text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline"
                    title={"View @" + entry.username + "'s GitHub profile"}
                    aria-label={"View @" + entry.username + "'s GitHub profile"}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                </div>
              </div>
            </td>
            <td class="p-2 text-center font-medium sm:p-3">
              {formatNumber(entry.problemsSolved)}
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

  /* Make username text smaller on mobile */
  a[href*='github.com'] {
    font-size: 0.9rem;
  }
}

/* Remove margin between sidebar and table */
@media (min-width: 768px) {
  .table-wrapper {
    margin-left: 0;
  }
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

/* Extra small screen adjustments */
@media (max-width: 480px) {
  /* Further reduce padding and spacing */
  td,
  th {
    padding: 0.5rem 0.25rem !important;
  }

  /* Make rank bubbles smaller on very small screens */
  .inline-flex.h-8.w-8 {
    height: 1.5rem !important;
    width: 1.5rem !important;
    font-size: 0.75rem !important;
  }
}

/* Ensure username is always purple */
a[href^='/user/'] {
  color: var(--color-username) !important;
}

a[href^='/user/']:hover {
  color: color-mix(in oklab, var(--color-username) 80%, white) !important;
}
</style>
