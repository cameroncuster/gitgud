<script lang="ts" generics="TProblemInfo">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/services/auth';
  import { isAdmin } from '$lib/services/auth';
  import { supabase } from '$lib/services/database';
  import { insertProblem } from '$lib/services/problem';
  import type { Problem } from '$lib/services/problem';
  import type { Unsubscriber } from 'svelte/store';

  // Props
  export let title: string;
  export let platformName: string;
  export let platformIcon: string | null = null;
  export let handlePlaceholder: string = 'Enter your handle (optional)';
  export let urlsPlaceholder: string = 'Enter problem URLs';
  export let urlsDescription: string = `Enter ${platformName} problem URLs`;
  export let extractUrls: (text: string) => string[];
  export let fetchProblemData: (
    problemInfo: NonNullable<TProblemInfo>,
    handle?: string
  ) => Promise<{ success: boolean; message?: string; problem?: Omit<Problem, 'source'> }>;
  export let extractProblemInfo: (url: string) => TProblemInfo;
  export let formatResultUrl: (url: string, name?: string) => string = (url, name) => name || url;

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
  }[] = [];

  // Initialize auth state
  onMount(() => {
    const initAuth = async () => {
      // Get current auth state directly first
      const { data } = await supabase.auth.getSession();
      const currentUser = data.session?.user || null;

      if (!currentUser) {
        goto('/');
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
          goto('/');
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

  // Function to process all problem URLs
  async function processProblems() {
    if (!$user) {
      error = 'You must be logged in to submit problems.';
      return;
    }

    if (!isAdminUser) {
      error = 'You do not have permission to submit problems. Only admins can submit problems.';
      return;
    }

    // Validate handle if provided
    if (handle && !handle.match(/^[a-zA-Z0-9._-]{2,24}$/)) {
      error = `Invalid ${platformName} handle format.`;
      return;
    }

    const urls = extractUrls(problemUrls);

    if (urls.length === 0) {
      error = `No valid ${platformName} problem URLs found. Please enter at least one valid URL.`;
      return;
    }

    loading = true;
    error = null;

    // Initialize processing results
    processingResults = urls.map((url) => ({
      url,
      status: 'pending'
    }));

    try {
      // Process each URL
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const problemInfo = extractProblemInfo(url);

        if (!problemInfo) {
          processingResults[i] = {
            url,
            status: 'error',
            message: 'Invalid URL format'
          };
          continue;
        }

        // Update status to show we're processing this URL
        processingResults[i] = {
          ...processingResults[i],
          message: 'Fetching data...'
        };

        // Force UI update
        processingResults = [...processingResults];

        // Fetch problem data
        const result = await fetchProblemData(problemInfo, handle);

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
          // Use the insertProblem function from problemDatabase service
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
              message: 'Added successfully',
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

        // Force UI update
        processingResults = [...processingResults];
      }

    } catch (err) {
      console.error(`Error processing problems:`, err);
      error = 'An unexpected error occurred while processing problems.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="max-w-4xl mx-auto px-4 py-6 w-full box-border">
  <div class="bg-[var(--color-secondary)] rounded-lg p-8 shadow-md">
    <h1
      class="m-0 mb-8 text-[var(--color-heading)] text-4xl text-center flex items-center justify-center gap-4"
    >
      {#if platformIcon}
        <img
          src={platformIcon}
          alt={`${platformName} icon`}
          class="h-14 w-14 inline-block align-middle"
          width="56"
          height="56"
        />
      {/if}
      {title}
    </h1>

    {#if checkingAdmin}
      <div class="text-center py-4 mb-6 text-blue-400">Checking permissions...</div>
    {:else if error && !processingResults.length}
      <div class="text-center py-4 mb-6 text-red-500">{error}</div>
    {/if}

    {#if isAdminUser && !checkingAdmin}
      <form on:submit|preventDefault={processProblems}>
        <div class="mb-6">
          <label for="handle" class="block mb-2 font-semibold text-[var(--color-heading)]"
            >{platformName} Handle</label
          >
          <input
            type="text"
            id="handle"
            bind:value={handle}
            placeholder={handlePlaceholder}
            disabled={loading}
            class="w-full p-3 border border-[var(--color-border)] rounded-md bg-[var(--color-background)] text-[var(--color-text)] text-base box-border font-inherit placeholder:text-[var(--color-text-muted)] placeholder:opacity-70 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:border-[var(--color-primary)] focus:shadow-sm"
          />
        </div>

        <div class="mb-6">
          <label for="problemUrls" class="block mb-2 font-semibold text-[var(--color-heading)]">
            Problem URLs <span class="text-red-500">*</span>
          </label>
          <textarea
            id="problemUrls"
            bind:value={problemUrls}
            placeholder={urlsPlaceholder}
            required
            disabled={loading}
            rows="8"
            class="w-full p-3 border border-[var(--color-border)] rounded-md bg-[var(--color-background)] text-[var(--color-text)] text-base box-border font-inherit resize-y min-h-[150px] placeholder:text-[var(--color-text-muted)] placeholder:opacity-70 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:border-[var(--color-primary)] focus:shadow-sm"
          ></textarea>
          <small class="block mt-2 text-[var(--color-text-muted)] text-sm">{urlsDescription}</small>
        </div>

        <div>
          <button
            type="submit"
            class="w-full py-3 px-3 bg-[var(--color-primary)] text-white border-none rounded-md text-base font-semibold cursor-pointer transition-colors duration-200 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {loading ? 'Processing...' : 'Submit Problems'}
          </button>
        </div>
      </form>

      {#if processingResults.length > 0}
        <div class="mt-8">
          <h2 class="mt-8 mb-4 text-[var(--color-heading)] text-2xl">Results</h2>
          <div class="flex flex-col gap-2">
            {#each processingResults as result (result.url)}
              <div
                class="flex justify-between items-center p-3 bg-[var(--color-background)] rounded border-l-4 {result.status ===
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
                    rel="noopener noreferrer"
                    class="text-[var(--color-text)] no-underline hover:text-[var(--color-primary)] hover:underline"
                  >
                    {formatResultUrl(result.url, result.name)}
                  </a>
                </div>
                <div class="whitespace-nowrap ml-4">
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
