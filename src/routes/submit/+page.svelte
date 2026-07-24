<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve as resolvePath } from '$app/paths';
  import { page } from '$app/stores';
  import { currentActor, resolveCurrentActor } from '$lib/auth/currentActor';
  import { createProviderAdapters, providerOrder } from '$lib/submit/providers';
  import type { ProviderId, WorkflowStage } from '$lib/submit/types';
  import { createSubmissionWorkflow, providerFromUrl } from '$lib/submit/workflow';
  import { get, type Unsubscriber } from 'svelte/store';

  const adapters = createProviderAdapters();
  const workflow = createSubmissionWorkflow(adapters, providerFromUrl(get(page).url));
  let workflowState = workflow.getState();
  const workflowUnsubscribe = workflow.subscribe((state) => (workflowState = state));
  onDestroy(workflowUnsubscribe);

  let isAdminUser = false;
  let checkingAdmin = true;
  let authError: string | null = null;
  let userUnsubscribe: Unsubscriber | null = null;

  let pasteInput: HTMLTextAreaElement | null = null;
  let reviewHeading: HTMLHeadingElement | null = null;

  $: provider = workflowState.provider;
  $: handle = workflowState.handle;
  $: pasted = workflowState.pasted;
  $: rows = workflowState.rows;
  $: resolving = workflowState.resolving;
  $: committing = workflowState.committing;
  $: done = workflowState.done;
  $: inlineError = workflowState.inlineError;
  $: validCount = workflowState.validCount;
  $: invalidCount = workflowState.invalidCount;
  $: addedCount = workflowState.addedCount;
  $: committedFailures = workflowState.committedFailures;
  $: adapter = adapters[provider];
  $: stage = workflowState.stage === 'complete' ? 'review' : workflowState.stage;

  onMount(() => {
    const initAuth = async () => {
      const actor = await resolveCurrentActor();
      if (!actor.user) {
        goto(resolvePath('/'));
        return;
      }
      checkingAdmin = true;
      isAdminUser = actor.isAdmin;
      if (actor.adminCheckFailed) {
        authError = 'Failed to verify your permissions. Please try again later.';
      } else if (!isAdminUser) {
        authError = 'Only admins can submit problems.';
      }
      checkingAdmin = false;
      userUnsubscribe = currentActor.subscribe((value) => {
        if (value.initialized && !value.user) {
          goto(resolvePath('/'));
        }
      });
    };
    initAuth();
    return () => userUnsubscribe?.();
  });

  $: {
    const selected = providerFromUrl($page.url);
    if (selected) workflow.syncProviderFromRoute(selected);
  }

  function selectProvider(next: ProviderId) {
    workflow.selectProvider(next);
  }

  function onHandleInput(event: Event) {
    workflow.setHandle((event.currentTarget as HTMLInputElement).value);
  }

  function onPasteInput(event: Event) {
    workflow.setPasted((event.currentTarget as HTMLTextAreaElement).value);
  }

  async function resolveEntries() {
    const outcome = await workflow.resolveEntries({
      authorized: isAdminUser,
      onReviewReady: async () => {
        await tick();
        reviewHeading?.focus();
      }
    });
    if (outcome === 'unauthorized') {
      authError = 'Only admins can submit problems.';
    } else if (outcome === 'no-entries') {
      pasteInput?.focus();
    }
  }

  function removeRow(id: number) {
    workflow.removeRow(id);
  }

  function confirmAdd() {
    return workflow.confirmAdd();
  }

  function startAnother() {
    workflow.startAnother();
    pasteInput?.focus();
  }

  $: stageIndex = stage === 'source' ? 0 : stage === 'links' ? 1 : 2;
  const stageLabels: { id: Exclude<WorkflowStage, 'complete'>; label: string }[] = [
    { id: 'source', label: 'Source' },
    { id: 'links', label: 'Links' },
    { id: 'review', label: 'Review' }
  ];
</script>

<svelte:head>
  <title>Submit</title>
</svelte:head>

<div class="mx-auto box-border w-full max-w-3xl px-4 py-6 pb-28 sm:pb-6">
  <h1 class="sr-only">Submit Problems</h1>

  {#if checkingAdmin}
    <div class="py-8 text-center text-[var(--color-info)]" role="status" aria-live="polite">
      Checking permissions…
    </div>
  {:else if authError}
    <div class="py-8 text-center text-[var(--color-error)]" role="alert">{authError}</div>
  {:else if isAdminUser}
    <!-- Stage indicator: the three visible stages Source → Links → Review. -->
    <ol
      class="mx-auto mt-4 mb-6 flex max-w-md list-none items-center justify-center gap-2 p-0 text-sm"
      aria-label="Submission stages"
    >
      {#each stageLabels as s, i (s.id)}
        <li class="flex items-center gap-2">
          <span
            class="flex items-center gap-1.5 {i <= stageIndex
              ? 'text-[var(--color-heading)]'
              : 'text-[var(--color-text-muted)]'}"
            aria-current={s.id === stage ? 'step' : undefined}
          >
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold {i <
              stageIndex
                ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                : i === stageIndex
                  ? 'border-2 border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border border-[var(--color-border)] text-[var(--color-text-muted)]'}"
              aria-hidden="true">{i + 1}</span
            >
            {s.label}
          </span>
          {#if i < stageLabels.length - 1}
            <span class="text-[var(--color-border)]" aria-hidden="true">→</span>
          {/if}
        </li>
      {/each}
    </ol>

    <!-- Stage 1 — Source: compact provider selector. -->
    <fieldset class="mb-6 border-0 p-0">
      <legend class="mb-2 block font-semibold text-[var(--color-heading)]">Source</legend>
      <div class="flex gap-2" role="radiogroup" aria-label="Problem source">
        {#each providerOrder as id (id)}
          <button
            type="button"
            role="radio"
            aria-checked={provider === id}
            data-testid={`provider-${id}`}
            on:click={() => selectProvider(id)}
            class="flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors duration-150 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none {provider ===
            id
              ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_12%,var(--color-background))] text-[var(--color-heading)]'
              : 'border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-muted)] hover:border-[var(--color-accent-muted)]'}"
          >
            <img src={adapters[id].icon} alt="" aria-hidden="true" class="h-5 w-5 object-contain" />
            {adapters[id].name}
          </button>
        {/each}
      </div>
    </fieldset>

    <!-- Stage 2 — Links: handle + paste textarea with quiet help. -->
    <div class="mb-4">
      <label for="handle" class="mb-2 block font-semibold text-[var(--color-heading)]">
        {adapter.name} Handle
        <span class="font-normal text-[var(--color-text-muted)]">(optional)</span>
      </label>
      <input
        type="text"
        id="handle"
        value={handle}
        on:input={onHandleInput}
        placeholder={`Your ${adapter.name} handle (optional)`}
        disabled={resolving || committing}
        autocomplete="off"
        class="font-inherit box-border w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-base text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] placeholder:opacity-70 focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>

    <div class="mb-4">
      <label for="paste" class="mb-2 block font-semibold text-[var(--color-heading)]">
        Problem URLs <span class="text-[var(--color-error)]" aria-hidden="true">*</span>
      </label>
      <textarea
        id="paste"
        bind:this={pasteInput}
        value={pasted}
        on:input={onPasteInput}
        placeholder={adapter.placeholder}
        rows="6"
        disabled={resolving || committing}
        aria-describedby="paste-help"
        class="font-inherit box-border min-h-[132px] w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-base text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] placeholder:opacity-70 focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      ></textarea>
      <small id="paste-help" class="mt-1.5 block text-sm text-[var(--color-text-muted)]">
        {adapter.help}
      </small>
    </div>

    {#if inlineError}
      <div class="mb-4 text-sm text-[var(--color-error)]" role="alert">{inlineError}</div>
    {/if}

    {#if rows.length === 0}
      <button
        type="button"
        on:click={resolveEntries}
        disabled={resolving || pasted.trim().length === 0}
        data-testid="preview-button"
        class="flex w-full items-center justify-center gap-2 rounded-md border-none bg-[var(--color-accent)] px-3 py-3 text-base font-semibold text-[var(--color-on-accent)] transition-[filter] duration-200 hover:brightness-110 focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-primary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        {#if resolving}
          <span
            class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
            aria-hidden="true"
          ></span>
          Resolving…
        {:else}
          Preview links
        {/if}
      </button>
    {/if}

    <!-- Stage 3 — Review: preview rows before any write. -->
    {#if rows.length > 0}
      <section class="mt-6" aria-labelledby="review-heading">
        <div class="mb-3 flex items-center justify-between">
          <h2
            id="review-heading"
            tabindex="-1"
            bind:this={reviewHeading}
            class="m-0 text-xl text-[var(--color-heading)] focus:outline-none"
          >
            Review
          </h2>
          {#if !done}
            <button
              type="button"
              on:click={startAnother}
              class="text-sm text-[var(--color-link)] underline hover:text-[var(--color-heading)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
            >
              Clear
            </button>
          {/if}
        </div>

        <p class="mb-3 text-sm text-[var(--color-text-muted)]" role="status" aria-live="polite">
          {#if done}
            {addedCount}
            {addedCount === 1 ? 'problem' : 'problems'} added.{committedFailures > 0
              ? ` ${committedFailures} could not be added.`
              : ''}
          {:else if resolving}
            Resolving {rows.length}
            {rows.length === 1 ? 'entry' : 'entries'}…
          {:else}
            {validCount} ready to add{invalidCount > 0
              ? `, ${invalidCount} cannot be submitted`
              : ''}.
          {/if}
        </p>

        <ul class="flex list-none flex-col gap-2 p-0" data-testid="preview">
          {#each rows as row (row.id)}
            <li
              data-testid="preview-row"
              data-valid={row.item.valid}
              class="flex items-center justify-between gap-3 rounded border-l-4 bg-[var(--color-background)] p-3 {row.status ===
              'added'
                ? 'border-l-[var(--color-success)]'
                : row.status === 'failed' || !row.item.valid
                  ? 'border-l-[var(--color-error)]'
                  : 'border-l-[var(--color-border)]'}"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 font-medium break-all">
                  <a
                    href={row.item.url}
                    target="_blank"
                    rel="noopener noreferrer external"
                    class="text-[var(--color-text)] no-underline hover:text-[var(--color-accent)] hover:underline"
                  >
                    {row.item.label}
                  </a>
                  {#if row.item.kind === 'contest'}
                    <span
                      class="rounded bg-[color-mix(in_oklab,var(--color-accent)_18%,var(--color-background))] px-2 py-0.5 text-xs font-semibold text-[var(--color-accent)]"
                      >Contest</span
                    >
                  {/if}
                </div>
                {#if row.status === 'added'}
                  <div class="mt-1 text-xs font-medium text-[var(--color-success)]">✓ Added</div>
                {:else if row.status === 'failed'}
                  <div class="mt-1 text-xs font-medium text-[var(--color-error)]">
                    ✗ {row.message ?? 'Could not be added'}
                  </div>
                {:else if !row.item.valid}
                  <div class="mt-1 text-xs text-[var(--color-error)]">{row.item.reason}</div>
                {/if}
              </div>
              {#if !done}
                <button
                  type="button"
                  on:click={() => removeRow(row.id)}
                  disabled={committing}
                  aria-label={`Remove ${row.item.label}`}
                  data-testid="remove-row"
                  class="shrink-0 rounded p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-error)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span aria-hidden="true">✕</span>
                </button>
              {/if}
            </li>
          {/each}
        </ul>

        {#if done}
          <button
            type="button"
            on:click={startAnother}
            class="mt-4 flex w-full items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 text-base font-semibold text-[var(--color-heading)] hover:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
          >
            Submit more
          </button>
        {:else}
          <!-- Final action in the desktop flow: the one clear "Add problems"
               step, in normal document flow below the preview. The mobile
               viewport instead pins a copy to the bottom (below) so it is
               always reachable without scrolling; only one is shown per
               viewport. -->
          <div class="mt-4 hidden sm:block">
            <button
              type="button"
              on:click={confirmAdd}
              disabled={committing || resolving || validCount === 0}
              data-testid="confirm-button"
              class="flex w-full items-center justify-center gap-2 rounded-md border-none bg-[var(--color-accent)] px-3 py-3 text-base font-semibold text-[var(--color-on-accent)] transition-[filter] duration-200 hover:brightness-110 focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-primary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {#if committing}
                <span
                  class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                  aria-hidden="true"
                ></span>
                Adding…
              {:else}
                Add {validCount}
                {validCount === 1 ? 'problem' : 'problems'}
              {/if}
            </button>
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<!-- Sticky final action (mobile only): pinned to the bottom so the one clear
     "Add problems" step is never scrolled out of view on a small screen. The
     desktop flow renders the same action inline (above); only one is shown per
     viewport. Hidden until there is a preview to act on, and after completion. -->
{#if isAdminUser && !checkingAdmin && rows.length > 0 && !done}
  <div
    class="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-secondary)] p-3 sm:hidden"
  >
    <button
      type="button"
      on:click={confirmAdd}
      disabled={committing || resolving || validCount === 0}
      data-testid="confirm-button-mobile"
      class="flex w-full items-center justify-center gap-2 rounded-md border-none bg-[var(--color-accent)] px-3 py-3 text-base font-semibold text-[var(--color-on-accent)] transition-[filter] duration-200 hover:brightness-110 focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-secondary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      {#if committing}
        <span
          class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
          aria-hidden="true"
        ></span>
        Adding…
      {:else}
        Add {validCount}
        {validCount === 1 ? 'problem' : 'problems'}
      {/if}
    </button>
  </div>
{/if}
