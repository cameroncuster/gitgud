<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { user, isAdmin } from '$lib/services/auth';
  import { supabase } from '$lib/services/database';
  import type { SubmitItem, ProcessOutcome } from './submitForm';
  import type { Unsubscriber } from 'svelte/store';

  // Presentation props.
  export let title: string;
  export let platformName: string;
  export let platformIcon: string | null = null;
  export let handlePlaceholder: string = `Enter your ${platformName} handle (optional)`;
  export let urlsPlaceholder: string = `Enter ${platformName} problem URLs`;
  export let urlsDescription: string = `Enter ${platformName} problem URLs. Separate multiple URLs with spaces or new lines.`;
  // A short, human sentence explaining what this form does. Shown as help text
  // under the heading so an admin has context before pasting URLs.
  export let intro: string = `Add ${platformName} problems to the catalog. Paste one or more URLs and submit — each is fetched, de-duplicated, and recorded.`;
  // Regex the optional handle must match when non-empty. Shared default matches
  // the handles both providers accept.
  export let handlePattern: RegExp = /^[a-zA-Z0-9._-]{2,24}$/;

  // Behavior props: the caller owns URL extraction and per-URL processing so the
  // UI, auth gate, validation, and progressive status are shared across
  // providers while the provider-specific work stays in each service.
  export let extractUrls: (text: string) => string[];
  export let processUrl: (url: string, handle: string) => Promise<ProcessOutcome>;
  export let formatItemLabel: (item: SubmitItem) => string = (item) => item.name || item.url;

  // Form state.
  let problemUrls = '';
  let handle = '';
  let loading = false;
  let error: string | null = null;
  let isAdminUser = false;
  let checkingAdmin = true;
  let userUnsubscribe: Unsubscriber | null = null;

  // Progressive batch status; each row updates in place as it is processed.
  let items: SubmitItem[] = [];

  // Elements captured for focus management.
  let urlsInput: HTMLTextAreaElement | null = null;
  let resultsHeading: HTMLHeadingElement | null = null;

  // Derived run summary, recomputed as rows resolve. Built as a single string so
  // the rendered status text has no stray inter-token whitespace.
  $: total = items.length;
  $: succeeded = items.filter((i) => i.status === 'success').length;
  $: failed = items.filter((i) => i.status === 'error').length;
  $: summaryText = loading
    ? `Processing ${succeeded + failed} of ${total}…`
    : `${succeeded} ${succeeded === 1 ? 'item' : 'items'} added, ` +
      `${failed} ${failed === 1 ? 'failure' : 'failures'} of ` +
      `${total} ${total === 1 ? 'URL' : 'URLs'}.`;

  onMount(() => {
    const initAuth = async () => {
      const { data } = await supabase.auth.getSession();
      const currentUser = data.session?.user || null;

      if (!currentUser) {
        goto(resolve('/'));
        return;
      }

      checkingAdmin = true;
      try {
        isAdminUser = await isAdmin(currentUser.id);
        if (!isAdminUser) {
          error = `You do not have permission to submit. Only admins can submit ${platformName} problems.`;
        }
      } catch (err) {
        console.error('Error checking admin status:', err);
        error = 'Failed to verify your permissions. Please try again later.';
      } finally {
        checkingAdmin = false;
      }

      userUnsubscribe = user.subscribe((value) => {
        if (value === null && currentUser !== null) {
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

  async function processProblems() {
    if (!$user) {
      error = 'You must be logged in to submit.';
      return;
    }

    if (!isAdminUser) {
      error = `You do not have permission to submit. Only admins can submit ${platformName} problems.`;
      return;
    }

    if (handle && !handle.match(handlePattern)) {
      error = `Invalid ${platformName} handle format.`;
      return;
    }

    const urls = extractUrls(problemUrls);
    if (urls.length === 0) {
      error = `No valid ${platformName} URLs found. Please enter at least one valid URL.`;
      // Keep focus on the field the admin must fix.
      urlsInput?.focus();
      return;
    }

    loading = true;
    error = null;
    items = urls.map((url) => ({ url, status: 'pending', kind: 'problem' }));

    // Move focus to the results region so keyboard/screen-reader users are
    // taken to the live status once processing starts.
    await tick();
    resultsHeading?.focus();

    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];

        items[i] = { ...items[i], status: 'working', message: 'Fetching…' };
        items = [...items];

        let outcome: ProcessOutcome;
        try {
          outcome = await processUrl(url, handle);
        } catch (err) {
          outcome = {
            success: false,
            kind: items[i].kind,
            message: err instanceof Error ? err.message : 'Failed to process URL'
          };
        }

        items[i] = {
          url,
          kind: outcome.kind,
          status: outcome.success ? 'success' : 'error',
          name: outcome.name,
          message: outcome.message ?? (outcome.success ? 'Added' : 'Failed'),
          details: outcome.details,
          classification: outcome.classification
        };
        items = [...items];
      }
    } catch (err) {
      console.error('Error processing URLs:', err);
      error = 'An unexpected error occurred while processing URLs.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="mx-auto box-border w-full max-w-3xl px-4 py-6">
  <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-secondary)] p-6 sm:p-8">
    <header class="mb-6">
      <h1
        class="m-0 flex items-center justify-center gap-3 text-center text-3xl text-[var(--color-heading)] sm:text-4xl"
      >
        {#if platformIcon}
          <img
            src={platformIcon}
            alt=""
            aria-hidden="true"
            class="inline-block h-12 w-12 align-middle"
            width="48"
            height="48"
          />
        {/if}
        {title}
      </h1>
      <p class="mx-auto mt-3 max-w-prose text-center text-sm text-[var(--color-text-muted)]">
        {intro}
      </p>
    </header>

    {#if checkingAdmin}
      <div class="py-4 text-center text-[var(--color-info)]" role="status" aria-live="polite">
        Checking permissions…
      </div>
    {:else if error && !items.length}
      <div class="py-4 text-center text-[var(--color-error)]" role="alert">{error}</div>
    {/if}

    {#if isAdminUser && !checkingAdmin}
      <form on:submit|preventDefault={processProblems} novalidate>
        <div class="mb-5">
          <label for="handle" class="mb-2 block font-semibold text-[var(--color-heading)]">
            {platformName} Handle
            <span class="font-normal text-[var(--color-text-muted)]">(optional)</span>
          </label>
          <input
            type="text"
            id="handle"
            bind:value={handle}
            placeholder={handlePlaceholder}
            disabled={loading}
            autocomplete="off"
            class="font-inherit box-border w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-base text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] placeholder:opacity-70 focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <small id="handle-help" class="mt-1.5 block text-sm text-[var(--color-text-muted)]">
            Credits the submission to your {platformName} profile. Leave blank to submit anonymously.
          </small>
        </div>

        <div class="mb-6">
          <label for="problemUrls" class="mb-2 block font-semibold text-[var(--color-heading)]">
            Problem URLs <span class="text-[var(--color-error)]" aria-hidden="true">*</span>
          </label>
          <textarea
            id="problemUrls"
            bind:this={urlsInput}
            bind:value={problemUrls}
            placeholder={urlsPlaceholder}
            required
            disabled={loading}
            rows="8"
            aria-describedby="urls-help"
            class="font-inherit box-border min-h-[150px] w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-base text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] placeholder:opacity-70 focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          ></textarea>
          <small id="urls-help" class="mt-1.5 block text-sm text-[var(--color-text-muted)]">
            {urlsDescription}
          </small>
        </div>

        <button
          type="submit"
          class="flex w-full items-center justify-center gap-2 rounded-md border-none bg-[var(--color-accent)] px-3 py-3 text-base font-semibold text-[var(--color-on-accent)] transition-[filter] duration-200 hover:brightness-110 focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-secondary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
        >
          {#if loading}
            <span
              class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
              aria-hidden="true"
            ></span>
            Processing {succeeded + failed}/{total}…
          {:else}
            Submit
          {/if}
        </button>
      </form>

      {#if items.length > 0}
        <section class="mt-8" aria-labelledby="results-heading">
          <h2
            id="results-heading"
            tabindex="-1"
            bind:this={resultsHeading}
            class="mt-0 mb-3 text-2xl text-[var(--color-heading)] focus:outline-none"
          >
            Results
          </h2>

          <!-- Run summary. `aria-live` announces the tally as rows resolve. -->
          <p
            class="mb-4 text-sm text-[var(--color-text-muted)]"
            role="status"
            aria-live="polite"
          >
            {summaryText}
          </p>

          <ul class="flex list-none flex-col gap-2 p-0" data-testid="results">
            {#each items as item, i (i)}
              <li
                class="flex flex-col gap-2 rounded border-l-4 bg-[var(--color-background)] p-3 sm:flex-row sm:items-center sm:justify-between {item.status ===
                'success'
                  ? 'border-l-[var(--color-success)]'
                  : item.status === 'error'
                    ? 'border-l-[var(--color-error)]'
                    : 'border-l-[var(--color-border)]'}"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-medium break-all">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer external"
                      class="text-[var(--color-text)] no-underline hover:text-[var(--color-accent)] hover:underline"
                    >
                      {formatItemLabel(item)}
                    </a>
                    {#if item.kind === 'contest'}
                      <span
                        class="ml-2 rounded bg-[color-mix(in_oklab,var(--color-accent)_18%,var(--color-background))] px-2 py-0.5 text-xs font-semibold text-[var(--color-accent)]"
                        >Contest</span
                      >
                    {/if}
                  </div>
                  <!-- Per-item classification slot: a placeholder the later
                       Gemini PR fills with an inferred topic. Rendered now so
                       the layout and tests already exercise the column. -->
                  <div class="mt-1 text-xs text-[var(--color-text-muted)]" data-testid="classification">
                    <span class="opacity-70">Topic:</span>
                    {item.classification ?? '—'}
                  </div>
                </div>
                <div class="shrink-0 text-sm sm:ml-4 sm:text-right">
                  {#if item.status === 'pending'}
                    <span class="text-[var(--color-info)]">Pending</span>
                  {:else if item.status === 'working'}
                    <span class="text-[var(--color-info)]">{item.message ?? 'Working…'}</span>
                  {:else if item.status === 'success'}
                    <span class="font-medium text-[var(--color-success)]">✓ {item.message}</span>
                    {#if item.details}
                      <span class="ml-1 text-[var(--color-text-muted)]">{item.details}</span>
                    {/if}
                  {:else}
                    <span class="font-medium text-[var(--color-error)]">✗ {item.message}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  </div>
</div>
