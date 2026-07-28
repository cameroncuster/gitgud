<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { currentActor, getCurrentActor, resolveCurrentActor } from '$lib/auth/currentActor';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import type { ThemePreference } from '$lib/services/appearance';
  import { currentThemePreference, setThemePreference } from '$lib/services/theme';
  import {
    fetchUserPreferences,
    updateLeaderboardPrivacyForUser,
    type UserPreferences
  } from '$lib/services/user';
  import {
    confirmCodeforcesImport,
    confirmKattisImport,
    previewCodeforcesImport,
    previewKattisImport
  } from '$lib/services/userSolves';
  import type { SolveMatchResult } from '$lib/services/codeforcesSolves';
  import { MAX_KATTIS_FILE_SIZE, type KattisSolveMatchResult } from '$lib/services/kattisSolves';

  type ImportProvider = 'codeforces' | 'kattis';

  const importProviders: ImportProvider[] = ['codeforces', 'kattis'];

  let preferences: UserPreferences = { hideFromLeaderboard: false, theme: 'system' };
  let loading = true;
  let saving = false;
  let error: string | null = null;
  let success: string | null = null;

  let importProvider: ImportProvider = 'codeforces';
  let cfHandle = '';
  let kattisInput = '';
  let kattisIsHtml = false;
  let selectedFileName = '';
  let importPreviewing = false;
  let importing = false;
  let importError: string | null = null;
  let importSuccess: string | null = null;
  let codeforcesPreview: SolveMatchResult | null = null;
  let kattisPreview: KattisSolveMatchResult | null = null;
  let fileSelectionRevision = 0;
  let privacySaveRevision = 0;
  let themeSaveRevision = 0;
  let themeSaveError = false;
  let failedThemePreference: ThemePreference | null = null;
  $: importPreview = importProvider === 'codeforces' ? codeforcesPreview : kattisPreview;

  function clearImportState(): void {
    importError = null;
    importSuccess = null;
    codeforcesPreview = null;
    kattisPreview = null;
  }

  async function runPreview(): Promise<void> {
    if (importProvider === 'codeforces' && !cfHandle.trim()) {
      importError = 'Enter a Codeforces handle';
      return;
    }
    if (importProvider === 'kattis' && !kattisInput.trim()) {
      importError = 'Paste Kattis problem IDs or choose a file';
      return;
    }

    importPreviewing = true;
    clearImportState();
    try {
      if (importProvider === 'codeforces') {
        const result = await previewCodeforcesImport(cfHandle);
        if (!result.success) importError = result.message;
        else codeforcesPreview = result.result;
      } else {
        const result = await previewKattisImport(kattisInput, kattisIsHtml);
        if (!result.success) importError = result.message;
        else kattisPreview = result.result;
      }
    } catch (previewError) {
      console.error('runPreview: error', previewError);
      importError = 'Failed to preview import';
    } finally {
      importPreviewing = false;
    }
  }

  async function runImport(): Promise<void> {
    const matchCount =
      importProvider === 'codeforces'
        ? codeforcesPreview?.matched.length
        : kattisPreview?.matched.length;
    if (!matchCount) return;

    importing = true;
    importError = null;
    importSuccess = null;
    try {
      const result =
        importProvider === 'codeforces'
          ? await confirmCodeforcesImport(cfHandle)
          : await confirmKattisImport(kattisInput, kattisIsHtml);
      if (!result.success) importError = result.message || 'Import failed';
      else {
        importSuccess = `Imported ${result.imported} newly solved problem${result.imported === 1 ? '' : 's'}`;
        codeforcesPreview = null;
        kattisPreview = null;
      }
    } catch (importFailure) {
      console.error('runImport: error', importFailure);
      importError = 'Import failed';
    } finally {
      importing = false;
    }
  }

  async function handleKattisFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const revision = ++fileSelectionRevision;
    kattisInput = '';
    kattisIsHtml = false;
    selectedFileName = '';
    clearImportState();
    if (!file) return;
    if (!/\.(txt|html?)$/i.test(file.name)) {
      importError = 'Choose a .txt or .html file';
      input.value = '';
      return;
    }
    if (file.size > MAX_KATTIS_FILE_SIZE) {
      importError = 'File is too large (maximum 2 MB)';
      input.value = '';
      return;
    }
    try {
      const contents = await file.text();
      if (revision !== fileSelectionRevision) return;
      kattisInput = contents;
      kattisIsHtml = /\.html?$/i.test(file.name);
      selectedFileName = file.name;
    } catch {
      if (revision === fileSelectionRevision) importError = 'Could not read that file';
    }
  }

  async function selectThemePreference(preference: ThemePreference): Promise<void> {
    const revision = ++themeSaveRevision;
    const userId = getCurrentActor().user?.id;
    themeSaveError = false;
    failedThemePreference = null;
    const saved = await setThemePreference(preference);
    if (revision !== themeSaveRevision || !userId || getCurrentActor().user?.id !== userId) return;
    if (!saved) {
      themeSaveError = true;
      failedThemePreference = preference;
    }
  }

  function retryThemeSave(): void {
    if (failedThemePreference) void selectThemePreference(failedThemePreference);
  }

  async function toggleHideFromLeaderboard(): Promise<void> {
    const userId = getCurrentActor().user?.id;
    if (!userId) return;
    const revision = ++privacySaveRevision;
    const nextValue = !preferences.hideFromLeaderboard;
    preferences = { ...preferences, hideFromLeaderboard: nextValue };
    saving = true;
    error = null;
    success = null;
    const saved = await updateLeaderboardPrivacyForUser(userId, nextValue);
    if (revision !== privacySaveRevision) return;
    if (saved) success = 'Saved';
    else error = 'Failed to save';
    saving = false;
  }

  onMount(() => {
    let authorizedUserId: string | null = null;
    const unsubscribe = currentActor.subscribe((actor) => {
      if (authorizedUserId && actor.initialized && actor.user?.id !== authorizedUserId) {
        loading = true;
        preferences = { hideFromLeaderboard: false, theme: 'system' };
        codeforcesPreview = null;
        kattisPreview = null;
        void goto(resolve('/'), { replaceState: true });
      }
    });

    const initialize = async () => {
      const actor = await resolveCurrentActor();
      if (!actor.user) {
        await goto(resolve('/'), { replaceState: true });
        return;
      }
      authorizedUserId = actor.user.id;
      const loaded = await fetchUserPreferences();
      if (getCurrentActor().user?.id !== authorizedUserId) return;
      if (loaded) preferences = loaded;
      loading = false;
    };
    void initialize();
    return unsubscribe;
  });
</script>

<svelte:head>
  <title>Settings</title>
  <meta name="description" content="User settings" />
</svelte:head>

<div class="mx-auto w-full max-w-[1200px] px-4 py-6">
  <h1 class="sr-only">Settings</h1>
  {#if loading}
    <div
      class="flex h-[calc(100vh-4rem)] items-center justify-center py-2 text-center"
      role="status"
    >
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
        <p class="mt-2 text-[var(--color-text-muted)]">Loading settings...</p>
      </div>
    </div>
  {:else}
    <div class="mb-4 flex min-h-6 justify-end" role="status" aria-live="polite">
      {#if success}<p class="text-sm text-[var(--color-success)]">{success}</p>{/if}
      {#if error}<p class="text-sm text-[var(--color-error)]">{error}</p>{/if}
    </div>

    <section class="overflow-hidden border-2 border-[var(--color-border)]">
      <h2 class="border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-4 font-bold">
        Appearance
      </h2>
      <div
        class="flex flex-col gap-3 bg-[var(--color-secondary)] p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <div>
          <p class="font-medium text-[var(--color-text)]">Theme</p>
          <p class="text-sm text-[var(--color-text-muted)]">
            Choose System, Light, or Dark. System follows your device preference.
          </p>
        </div>
        <ThemeToggle preference={$currentThemePreference} onSelect={selectThemePreference} />
      </div>
      {#if themeSaveError}
        <div
          class="flex items-center justify-end gap-2 border-t-2 border-[var(--color-border)] bg-[var(--color-secondary)] px-4 pb-4 text-sm text-[var(--color-error)]"
          role="alert"
        >
          <span>Theme could not sync.</span>
          <button
            type="button"
            class="min-h-11 border border-[var(--color-error)] px-3 font-bold"
            on:click={retryThemeSave}>Retry</button
          >
        </div>
      {/if}
    </section>

    <section class="mt-6 overflow-hidden border-2 border-[var(--color-border)]">
      <h2 class="border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-4 font-bold">
        Privacy
      </h2>
      <div class="flex items-center justify-between gap-4 bg-[var(--color-secondary)] p-4">
        <div>
          <p class="font-medium text-[var(--color-text)]">Hide from leaderboard</p>
          <p class="text-sm text-[var(--color-text-muted)]">
            Your profile will not be visible on the public leaderboard.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={preferences.hideFromLeaderboard}
          class="min-h-11 min-w-16 border-2 border-[var(--color-border)] px-2 font-medium focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          on:click={() => void toggleHideFromLeaderboard()}
          disabled={saving}>{preferences.hideFromLeaderboard ? 'On' : 'Off'}</button
        >
      </div>
    </section>

    <section class="mt-6 mb-16 overflow-hidden border-2 border-[var(--color-border)] md:mb-20">
      <h2 class="border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-4 font-bold">
        Import solved problems
      </h2>
      <div class="bg-[var(--color-secondary)] p-4">
        <fieldset>
          <legend class="mb-2 font-medium">Source</legend>
          <div class="flex gap-2">
            {#each importProviders as provider (provider)}
              <label
                class="flex min-h-11 cursor-pointer items-center gap-2 border-2 border-[var(--color-border)] px-3 capitalize has-[:checked]:border-[var(--color-accent)]"
              >
                <input
                  type="radio"
                  name="import-provider"
                  value={provider}
                  checked={importProvider === provider}
                  on:change={() => {
                    importProvider = provider;
                    fileSelectionRevision++;
                    clearImportState();
                  }}
                />
                {provider}
              </label>
            {/each}
          </div>
        </fieldset>

        {#if importProvider === 'codeforces'}
          <p class="my-3 text-sm text-[var(--color-text-muted)]">
            Import accepted submissions from your public Codeforces handle. Existing behavior is
            unchanged and only tracked problems are matched.
          </p>
          <label class="block">
            <span class="sr-only">Codeforces handle</span>
            <input
              type="text"
              bind:value={cfHandle}
              placeholder="Codeforces handle"
              autocomplete="off"
              class="w-full border-2 border-[var(--color-border)] bg-[var(--color-primary)] px-3 py-2"
              disabled={importPreviewing || importing}
            />
          </label>
        {:else}
          <p class="my-3 text-sm text-[var(--color-text-muted)]">
            Paste Kattis problem IDs or canonical problem URLs, or choose a local .txt/.html file.
            Files stay in your browser; gitgud never contacts Kattis for this import.
          </p>
          <label class="block">
            <span class="mb-1 block font-medium">Kattis problem IDs or URLs</span>
            <textarea
              bind:value={kattisInput}
              on:input={() => {
                fileSelectionRevision++;
                kattisIsHtml = false;
                selectedFileName = '';
                clearImportState();
              }}
              rows="6"
              maxlength="1000000"
              placeholder="gamma&#10;https://open.kattis.com/problems/twostones"
              class="w-full border-2 border-[var(--color-border)] bg-[var(--color-primary)] p-3"
              disabled={importPreviewing || importing}></textarea>
          </label>
          <label
            class="mt-3 inline-flex min-h-11 cursor-pointer items-center border-2 border-[var(--color-border)] px-3 font-medium"
          >
            Choose local .txt or .html file
            <input
              type="file"
              accept=".txt,.html,.htm,text/plain,text/html"
              class="sr-only"
              on:change={handleKattisFile}
              disabled={importPreviewing || importing}
            />
          </label>
          {#if selectedFileName}
            <p class="mt-2 text-sm text-[var(--color-text-muted)]">Loaded {selectedFileName}</p>
          {/if}
        {/if}

        <button
          type="button"
          class="mt-3 min-h-11 border-2 border-[var(--color-border)] bg-[var(--color-tertiary)] px-4 font-medium disabled:opacity-50"
          on:click={runPreview}
          disabled={importPreviewing || importing}
          >{importPreviewing ? 'Loading…' : 'Preview'}</button
        >

        <div class="mt-3" role="status" aria-live="polite">
          {#if importError}<p class="text-sm text-[var(--color-error)]">{importError}</p>{/if}
          {#if importSuccess}<p class="text-sm text-[var(--color-success)]">
              {importSuccess}
            </p>{/if}
        </div>

        {#if importPreview}
          <div class="mt-4 border-t-2 border-[var(--color-border)] pt-4">
            <p>
              <strong>{importPreview.matched.length}</strong> solved problem{importPreview.matched
                .length === 1
                ? ''
                : 's'} matched.
            </p>
            {#if importProvider === 'codeforces'}
              {#if codeforcesPreview && codeforcesPreview.unmatchedCount > 0}
                <p class="text-sm text-[var(--color-text-muted)]">
                  {codeforcesPreview.unmatchedCount} solved problem{codeforcesPreview.unmatchedCount ===
                  1
                    ? ''
                    : 's'} not tracked here.
                </p>
              {/if}
            {:else if kattisPreview}
              <p class="text-sm text-[var(--color-text-muted)]">
                {kattisPreview.unmatchedCount} unmatched. {kattisPreview.duplicateCount} duplicate{kattisPreview.duplicateCount ===
                1
                  ? ''
                  : 's'} removed.
                {#if kattisPreview.capped}Input was capped for safety.{/if}
              </p>
            {/if}
            {#if importPreview.matched.length > 0}
              <button
                type="button"
                class="mt-3 min-h-11 border-2 border-[var(--color-border)] bg-[var(--color-accent)] px-4 font-medium text-[var(--color-on-accent)] disabled:opacity-50"
                on:click={runImport}
                disabled={importing}
                >{importing ? 'Importing…' : `Import ${importPreview.matched.length}`}</button
              >
            {/if}
          </div>
        {/if}
      </div>
    </section>
  {/if}
</div>
