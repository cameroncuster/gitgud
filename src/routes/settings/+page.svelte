<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import type { Unsubscriber } from 'svelte/store';
  import { currentActor, getCurrentActor, resolveCurrentActor } from '$lib/auth/currentActor';
  import {
    currentTheme,
    setThemePreference,
    THEME_PREFERENCES,
    type ThemePreference
  } from '$lib/services/theme';
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
  const appearanceDescriptions: Record<ThemePreference, string> = {
    system: 'Follow your device appearance and update when it changes.',
    light: 'Always use the Paper theme.',
    dark: 'Always use the Dark Ink theme.'
  };

  let preferences: UserPreferences = { hideFromLeaderboard: false, theme: 'system' };
  let loading = true;
  let saving = false;
  let error: string | null = null;
  let success: string | null = null;
  let userUnsubscribe: Unsubscriber | null = null;

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
  let preferenceSaveRevision = 0;
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

  async function selectAppearance(theme: ThemePreference): Promise<void> {
    const revision = ++preferenceSaveRevision;
    preferences = { ...preferences, theme };
    saving = true;
    error = null;
    success = null;
    const saved = await setThemePreference(theme);
    if (revision !== preferenceSaveRevision) return;
    if (saved) success = 'Saved';
    else error = 'Failed to save';
    saving = false;
  }

  async function toggleHideFromLeaderboard(): Promise<void> {
    const userId = getCurrentActor().user?.id;
    if (!userId) return;
    const revision = ++preferenceSaveRevision;
    const nextValue = !preferences.hideFromLeaderboard;
    preferences = { ...preferences, hideFromLeaderboard: nextValue };
    saving = true;
    error = null;
    success = null;
    const saved = await updateLeaderboardPrivacyForUser(userId, nextValue);
    if (revision !== preferenceSaveRevision) return;
    if (saved) success = 'Saved';
    else error = 'Failed to save';
    saving = false;
  }

  onMount(() => {
    const initialize = async () => {
      const actor = await resolveCurrentActor();
      if (!actor.user) {
        await goto(resolve('/'));
        return;
      }

      const loaded = await fetchUserPreferences();
      if (loaded) preferences = loaded;
      loading = false;

      let seenUser = true;
      userUnsubscribe = currentActor.subscribe((value) => {
        if (value.user) seenUser = true;
        else if (value.initialized && seenUser) void goto(resolve('/'));
      });
    };
    void initialize();
    return () => userUnsubscribe?.();
  });
</script>

<svelte:head>
  <title>Settings</title>
  <meta name="description" content="User settings" />
</svelte:head>

<div class="mx-auto w-full max-w-[1200px] px-4 py-6">
  <h1 class="sr-only">Settings</h1>
  {#if loading}
    <div class="flex min-h-[40vh] items-center justify-center" role="status">
      <p class="text-[var(--color-text-muted)]">Loading settings…</p>
    </div>
  {:else}
    <div class="mb-4 flex min-h-6 justify-end" role="status" aria-live="polite">
      {#if success}<p class="text-sm text-[var(--color-success)]">{success}</p>{/if}
      {#if error}<p class="text-sm text-[var(--color-error)]">{error}</p>{/if}
    </div>

    <section class="overflow-hidden border-2 border-[var(--color-border)]">
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

    <section class="mt-6 overflow-hidden border-2 border-[var(--color-border)]">
      <h2 class="border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-4 font-bold">
        Appearance
      </h2>
      <fieldset class="bg-[var(--color-secondary)] p-4">
        <legend class="sr-only">Choose appearance</legend>
        <div class="grid gap-3 md:grid-cols-3">
          {#each THEME_PREFERENCES as theme (theme)}
            <label
              class="flex min-h-28 cursor-pointer gap-3 border-2 border-[var(--color-border)] p-4 has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-tertiary)]"
            >
              <input
                type="radio"
                name="settings-appearance"
                value={theme}
                checked={preferences.theme === theme}
                disabled={saving}
                on:change={() => selectAppearance(theme)}
              />
              <span>
                <span class="block font-bold text-[var(--color-heading)] capitalize">{theme}</span>
                <span class="mt-1 block text-sm text-[var(--color-text-muted)]">
                  {appearanceDescriptions[theme]}
                </span>
                {#if preferences.theme === theme}
                  <span class="mt-2 block text-xs text-[var(--color-text)]">
                    Currently resolved to {$currentTheme}.
                  </span>
                {/if}
              </span>
            </label>
          {/each}
        </div>
      </fieldset>
    </section>

    <section class="mt-6 overflow-hidden border-2 border-[var(--color-border)]">
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
          {#if importSuccess}<p class="text-sm text-[var(--color-success)]">{importSuccess}</p>{/if}
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
