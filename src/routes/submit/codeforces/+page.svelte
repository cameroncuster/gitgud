<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { user } from '$lib/services/auth';
import { isAdmin } from '$lib/services/auth';
import { supabase } from '$lib/services/database';
import { insertProblem } from '$lib/services/problem';
import {
  extractCodeforcesProblemInfo,
  fetchCodeforcesProblemData,
  formatCodeforcesUrl,
  extractCodeforcesUrls
} from '$lib/services/codeforces';
import {
  extractCodeforcesContestInfo,
  fetchCodeforcesContestData,
  insertContest
} from '$lib/services/contest';
import type { Unsubscriber } from 'svelte/store';

// Form data
let problemUrls = '';
let handle = '';
let loading = false;
let error: string | null = null;
let isAdminUser = false;
let checkingAdmin = true;
let userUnsubscribe: Unsubscriber | null = null;

// Processing status
let processingResults: {
  url: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
  name?: string;
  details?: string;
  isContest?: boolean;
}[] = [];

// Initialize auth state
onMount(() => {
  const initAuth = async () => {
    // Get current auth state directly first
    const { data } = await supabase.auth.getSession();
    const currentUser = data.session?.user || null;

    if (!currentUser) {
      goto(resolve('/'));
      return;
    }

    // If we have a user, check admin status
    checkingAdmin = true;

    try {
      isAdminUser = await isAdmin(currentUser.id);

      if (!isAdminUser) {
        error = `You do not have permission to submit problems. Only admins can submit problems.`;
      }
    } catch (err) {
      console.error('Error checking admin status:', err);
      error = 'Failed to verify your permissions. Please try again later.';
    } finally {
      checkingAdmin = false;
    }

    // Now set up the subscription for future changes
    userUnsubscribe = user.subscribe((value) => {
      if (value === null && currentUser !== null) {
        // User logged out after initial load
        goto(resolve('/'));
      }
    });
  };

  initAuth();

  return () => {
    if (userUnsubscribe) {
      userUnsubscribe();
    }
  };
});

// Function to process all URLs
async function processUrls() {
  if (!$user) {
    error = 'You must be logged in to submit problems or contests.';
    return;
  }

  if (!isAdminUser) {
    error = 'You do not have permission to submit problems or contests. Only admins can submit.';
    return;
  }

  // Validate handle if provided
  if (handle && !handle.match(/^[a-zA-Z0-9._-]{2,24}$/)) {
    error = `Invalid Codeforces handle format.`;
    return;
  }

  const { problemUrls: problems, contestUrls: contests } = extractCodeforcesUrls(problemUrls);

  if (problems.length === 0 && contests.length === 0) {
    error = `No valid Codeforces URLs found. Please enter at least one valid problem or contest URL.`;
    return;
  }

  loading = true;
  error = null;

  // Initialize processing results for all URLs
  const allUrls = [...problems, ...contests];
  processingResults = allUrls.map((url) => ({
    url,
    status: 'pending',
    isContest: contests.includes(url)
  }));

  try {
    // Process each URL
    for (let i = 0; i < allUrls.length; i++) {
      const url = allUrls[i];
      const isContest = contests.includes(url);

      if (isContest) {
        // Process contest URL
        const contestInfo = extractCodeforcesContestInfo(url);

        if (!contestInfo) {
          processingResults[i] = {
            url,
            status: 'error',
            message: 'Invalid contest URL format',
            isContest: true
          };
          continue;
        }

        // Update status to show we're processing this URL
        processingResults[i] = {
          ...processingResults[i],
          message: 'Fetching contest data...'
        };

        // Force UI update
        processingResults = [...processingResults];

        // Fetch contest data
        const result = await fetchCodeforcesContestData(contestInfo, handle);

        if (!result.success || !result.contest) {
          processingResults[i] = {
            url,
            status: 'error',
            message: result.message || 'Failed to fetch contest data',
            isContest: true
          };
          continue;
        }

        // Try to insert the contest
        try {
          const insertResult = await insertContest(result.contest);

          if (!insertResult.success) {
            processingResults[i] = {
              url,
              status: 'error',
              message: insertResult.message,
              isContest: true
            };
          } else {
            processingResults[i] = {
              url,
              status: 'success',
              name: result.contest.name,
              message: 'Contest added successfully',
              details: insertResult.id ? `ID: ${insertResult.id}` : undefined,
              isContest: true
            };
          }
        } catch (err) {
          processingResults[i] = {
            url,
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to insert contest',
            isContest: true
          };
        }
      } else {
        // Process problem URL
        const problemInfo = extractCodeforcesProblemInfo(url);

        if (!problemInfo) {
          processingResults[i] = {
            url,
            status: 'error',
            message: 'Invalid problem URL format'
          };
          continue;
        }

        // Update status to show we're processing this URL
        processingResults[i] = {
          ...processingResults[i],
          message: 'Fetching problem data...'
        };

        // Force UI update
        processingResults = [...processingResults];

        // Fetch problem data
        const result = await fetchCodeforcesProblemData(problemInfo, handle);

        if (!result.success || !result.problem) {
          processingResults[i] = {
            url,
            status: 'error',
            message: result.message || 'Failed to fetch problem data'
          };
          continue;
        }

        // Try to insert the problem
        try {
          const insertResult = await insertProblem(result.problem);

          if (!insertResult.success) {
            processingResults[i] = {
              url,
              status: 'error',
              message: insertResult.message
            };
          } else {
            processingResults[i] = {
              url,
              status: 'success',
              name: result.problem.name,
              message: 'Problem added successfully',
              details: insertResult.id ? `ID: ${insertResult.id}` : undefined
            };
          }
        } catch (err) {
          processingResults[i] = {
            url,
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to insert problem'
          };
        }
      }

      // Force UI update
      processingResults = [...processingResults];
    }

  } catch (err) {
    console.error(`Error processing URLs:`, err);
    error = 'An unexpected error occurred while processing URLs.';
  } finally {
    loading = false;
  }
}
</script>

<svelte:head>
  <title>Submit | Codeforces</title>
</svelte:head>

<div class="mx-auto box-border w-full max-w-4xl px-4 py-6">
  <div class="rounded-lg bg-[var(--color-secondary)] p-8">
    <h1
      class="m-0 mb-8 flex items-center justify-center gap-4 text-center text-4xl text-[var(--color-heading)]"
    >
      <img
        src="/images/codeforces.png"
        alt="Codeforces icon"
        class="inline-block h-14 w-14 align-middle"
        width="56"
        height="56"
      />
      Submit Codeforces Problems & Contests
    </h1>

    {#if checkingAdmin}
      <div class="mb-6 py-4 text-center text-blue-400">Checking permissions...</div>
    {:else if error && !processingResults.length}
      <div class="mb-6 py-4 text-center text-red-500">{error}</div>
    {/if}

    {#if isAdminUser && !checkingAdmin}
      <form on:submit|preventDefault={processUrls}>
        <div class="mb-6">
          <label for="handle" class="mb-2 block font-semibold text-[var(--color-heading)]"
            >Codeforces Handle</label
          >
          <input
            type="text"
            id="handle"
            bind:value={handle}
            placeholder="Enter your Codeforces handle (optional)"
            disabled={loading}
            class="font-inherit box-border w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-base text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] placeholder:opacity-70 focus:border-[var(--color-primary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div class="mb-6">
          <label for="problemUrls" class="mb-2 block font-semibold text-[var(--color-heading)]">
            Problem or Contest URLs <span class="text-red-500">*</span>
          </label>
          <textarea
            id="problemUrls"
            bind:value={problemUrls}
            placeholder="https://codeforces.com/contest/1234/problem/A https://codeforces.com/problemset/problem/1234/A https://codeforces.com/gym/104427/problem/A https://codeforces.com/contest/1234 https://codeforces.com/gym/104427"
            required
            disabled={loading}
            rows="12"
            class="font-inherit box-border min-h-[150px] w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-base text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] placeholder:opacity-70 focus:border-[var(--color-primary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          ></textarea>
          <small class="mt-2 block text-sm text-[var(--color-text-muted)]">
            Enter Codeforces problem or contest URLs. URLs can be separated by spaces or newlines.
            You can mix problem and contest URLs in the same submission.
          </small>
        </div>

        <div>
          <button
            type="submit"
            class="w-full cursor-pointer rounded-md border-none bg-[var(--color-primary)] px-3 py-3 text-base font-semibold text-white transition-colors duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
          >
            {loading ? 'Processing...' : 'Submit'}
          </button>
        </div>
      </form>

      {#if processingResults.length > 0}
        <div class="mt-8">
          <h2 class="mt-8 mb-4 text-2xl text-[var(--color-heading)]">Results</h2>
          <div class="flex flex-col gap-2">
            {#each processingResults as result (result.url)}
              <div
                class="flex items-center justify-between rounded border-l-4 bg-[var(--color-background)] p-3 {result.status ===
                'success'
                  ? 'border-l-green-500'
                  : result.status === 'error'
                    ? 'border-l-red-500'
                    : 'border-l-[var(--color-border)]'}"
              >
                <div class="font-medium break-all">
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer external"
                    class="text-[var(--color-text)] no-underline hover:text-[var(--color-primary)] hover:underline"
                  >
                    {result.isContest
                      ? (result.name ? `${result.name}` : result.url)
                      : formatCodeforcesUrl(result.url, result.name)}
                  </a>
                  {#if result.isContest}
                    <span class="ml-2 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800"
                      >Contest</span
                    >
                  {/if}
                </div>
                <div class="ml-4 whitespace-nowrap">
                  {#if result.status === 'pending'}
                    <span class="text-blue-400">Pending</span>
                  {:else if result.status === 'success'}
                    <span class="text-green-500">✓ {result.message}</span>
                  {:else}
                    <span class="text-red-500">✗ {result.message}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
