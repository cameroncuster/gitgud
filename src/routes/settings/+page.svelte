<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { user } from '$lib/services/auth';
import { fetchUserPreferences, updateUserPreferences } from '$lib/services/user';
import type { UserPreferences } from '$lib/services/user';
import type { Unsubscriber } from 'svelte/store';
import { supabase } from '$lib/services/database';
import { applyTheme } from '$lib/services/theme';
import { fetchProblems } from '$lib/services/problem';
import {
  fetchCodeforcesSolves,
  matchSolvedToProblems,
  importSolvedProblems
} from '$lib/services/userSolves';
import type { SolveMatchResult } from '$lib/services/userSolves';

let preferences: UserPreferences = {
  hideFromLeaderboard: false,
  theme: 'light'
};

let loading: boolean = true;
let saving: boolean = false;
let error: string | null = null;
let success: string | null = null;
let userUnsubscribe: Unsubscriber | null = null;

// Codeforces solved-problem import state
let cfHandle: string = '';
let importPreviewing: boolean = false;
let importing: boolean = false;
let importError: string | null = null;
let importSuccess: string | null = null;
let importPreview: SolveMatchResult | null = null;

// Preview the Codeforces solves that match problems tracked here. Read-only.
async function previewCodeforcesImport(): Promise<void> {
  if (!cfHandle.trim()) {
    importError = 'Enter a Codeforces handle';
    return;
  }

  importPreviewing = true;
  importError = null;
  importSuccess = null;
  importPreview = null;

  try {
    const result = await fetchCodeforcesSolves(cfHandle);
    if (!result.success || !result.solvedUrls) {
      importError = result.message || 'Failed to fetch solves';
      return;
    }

    const problems = await fetchProblems();
    importPreview = matchSolvedToProblems(result.solvedUrls, problems);
  } catch (err) {
    console.error('previewCodeforcesImport: error', err);
    importError = 'Failed to preview import';
  } finally {
    importPreviewing = false;
  }
}

// Confirm the previewed import: idempotent upsert of matched problems.
async function confirmCodeforcesImport(): Promise<void> {
  if (!importPreview || importPreview.matched.length === 0) {
    return;
  }

  importing = true;
  importError = null;
  importSuccess = null;

  try {
    const result = await importSolvedProblems(importPreview.matched.map((problem) => problem.id));
    if (!result.success) {
      importError = result.message || 'Import failed';
      return;
    }
    importSuccess = `Imported ${result.imported} newly solved problem${result.imported === 1 ? '' : 's'}`;
    importPreview = null;
  } catch (err) {
    console.error('confirmCodeforcesImport: error', err);
    importError = 'Import failed';
  } finally {
    importing = false;
  }
}

// Load user preferences
async function loadPreferences(): Promise<void> {
  loading = true;
  error = null;

  try {
    const userPrefs = await fetchUserPreferences();
    if (userPrefs) {
      preferences = userPrefs;

      // Apply theme immediately
      applyTheme(preferences.theme);
    } else {
      // If no preferences were returned, try to create them
      const result = await updateUserPreferences({
        hideFromLeaderboard: false,
        theme: 'light'
      });

      if (result) {
        // Set the default preferences in the UI
        preferences = {
          hideFromLeaderboard: false,
          theme: 'light'
        };
      }
    }
  } catch (err) {
    console.error('loadPreferences: Error loading preferences', err);
    error = 'Failed to load preferences';
  } finally {
    loading = false;
  }
}

// Save user preferences
async function savePreferences(): Promise<void> {
  saving = true;
  error = null;
  success = null;

  try {
    const result = await updateUserPreferences(preferences);
    if (result) {
      success = 'Saved';
      setTimeout(() => {
        success = null;
      }, 2000);
    } else {
      console.error('savePreferences: Failed to save preferences');
      error = 'Failed to save';
    }
  } catch (err) {
    console.error('savePreferences: Error saving preferences', err);
    error = 'Failed to save';
  } finally {
    saving = false;
  }
}

// Toggle the hide from leaderboard setting
function toggleHideFromLeaderboard(): void {
  preferences.hideFromLeaderboard = !preferences.hideFromLeaderboard;
  savePreferences();
}

// Toggle the theme setting
function toggleTheme(): void {
  // Toggle the theme
  const newTheme = preferences.theme === 'light' ? 'dark' : 'light';
  preferences.theme = newTheme;

  // Apply theme immediately for better UX
  applyTheme(newTheme);

  // Save to localStorage for immediate persistence
  localStorage.setItem('gitgud-theme', newTheme);

  // Force a re-render by creating a new object
  preferences = { ...preferences };

  // Save to database
  savePreferences();
}

// Initialize auth state and load preferences
onMount(() => {
  // Create a flag to track if we've already checked auth
  let authChecked = false;
  let loadingTimeout: ReturnType<typeof setTimeout> | null = null;

  // First, directly check the session
  const checkSession = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        // No session, redirect to home
        goto(resolve('/'));
        return false;
      }
      return true;
    } catch (err) {
      console.error('Error checking session:', err);
      return false;
    }
  };

  // Function to load preferences with a delay
  const loadPreferencesWithDelay = () => {
    // Clear any existing timeout
    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
    }

    // Set a timeout to ensure user state is fully initialized
    loadingTimeout = setTimeout(async () => {
      // Try to directly check the toggle state from the database
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
          const userId = data.session.user.id;

          const { data: prefData, error } = await supabase
            .from('user_preferences')
            .select('hide_from_leaderboard, theme')
            .eq('user_id', userId)
            .single();

          if (prefData && !error) {
            preferences = {
              hideFromLeaderboard: prefData.hide_from_leaderboard,
              theme: prefData.theme || 'light'
            };

            // Apply the theme immediately
            applyTheme(preferences.theme);
            loading = false;
            return;
          }
        }
      } catch (err) {
        console.error('Error in direct preference check:', err);
      }

      // Fall back to normal loading if direct check fails
      loadPreferences();
    }, 500); // 500ms delay
  };

  // Check session and load preferences if authenticated
  checkSession().then((isAuthenticated) => {
    if (isAuthenticated) {
      authChecked = true;
      loadPreferencesWithDelay();
    }
  });

  // Also set up a subscription to handle auth state changes
  userUnsubscribe = user.subscribe(async (value) => {
    // If we haven't checked auth yet, do it now
    if (!authChecked && value === null) {
      // Double-check with the API directly
      const isAuthenticated = await checkSession();
      if (!isAuthenticated) {
        goto(resolve('/'));
        return;
      }
    } else if (value === null) {
      // User logged out, redirect to home
      goto(resolve('/'));
      return;
    } else if (!authChecked || value) {
      // User is authenticated and we haven't loaded preferences yet
      // OR user state just changed to logged in
      authChecked = true;
      loadPreferencesWithDelay();
    }
  });

  // Cleanup function
  return () => {
    if (userUnsubscribe) {
      userUnsubscribe();
    }
    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
    }
  };
});
</script>

<svelte:head>
  <title>Settings</title>
  <meta name="description" content="User settings" />
</svelte:head>

<div class="mx-auto w-full max-w-[1200px] px-4 py-6">
  {#if loading}
    <div class="flex h-[calc(100vh-4rem)] items-center justify-center py-2 text-center">
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
    <div class="mb-4 flex h-6 justify-end">
      {#if success}
        <div class="text-sm font-medium text-[var(--color-primary)]">{success}</div>
      {/if}
      {#if error}
        <div class="text-sm font-medium text-[var(--color-accent)]">{error}</div>
      {/if}
    </div>

    <div
      class="overflow-hidden rounded-none border-2 border-[var(--color-border)] shadow-[2px_2px_0_rgba(0,0,0,0.1)]"
    >
      <div class="border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-4">
        <div class="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 text-[var(--color-text-muted)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          <span class="font-bold text-[var(--color-heading)]">Privacy</span>
        </div>
      </div>

      <div class="bg-[var(--color-secondary)] p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium text-[var(--color-text)]">Hide from leaderboard</p>
            <p class="text-sm text-[var(--color-text-muted)]">
              Your profile will not be visible on the public leaderboard
            </p>
          </div>

          <div class="w-11 flex-shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={preferences.hideFromLeaderboard}
              class="relative inline-flex h-6 w-11 cursor-pointer items-center rounded focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 focus:outline-none"
              on:click={toggleHideFromLeaderboard}
              disabled={saving}
            >
              <span class="sr-only">Hide from leaderboard</span>
              <span
                class="absolute h-full w-full rounded transition-colors duration-200 {preferences.hideFromLeaderboard ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'} {saving ? 'opacity-50' : ''}"
              ></span>
              <span
                class="absolute top-0.5 left-0.5 h-5 w-5 transform rounded bg-white transition-transform duration-200 {preferences.hideFromLeaderboard ? 'translate-x-5' : ''} {saving ? 'opacity-50' : ''}"
              ></span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Theme Settings Section -->
    {#if !loading}
      <div
        class="mt-6 overflow-hidden rounded-none border-2 border-[var(--color-border)] shadow-[2px_2px_0_rgba(0,0,0,0.1)]"
      >
        <div class="border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-4">
          <div class="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5 text-[var(--color-text-muted)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
              />
            </svg>
            <span class="font-bold text-[var(--color-heading)]">Theme</span>
          </div>
        </div>

        <div class="bg-[var(--color-secondary)] p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-medium text-[var(--color-text)]">Dark mode</p>
              <p class="text-sm text-[var(--color-text-muted)]">
                Switch between light and dark theme
              </p>
            </div>

            <div class="w-11 flex-shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={preferences.theme === 'dark'}
                class="relative inline-flex h-6 w-11 cursor-pointer items-center rounded focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 focus:outline-none"
                on:click={toggleTheme}
                disabled={saving}
              >
                <span class="sr-only">Toggle dark mode</span>
                <span
                  class="absolute h-full w-full rounded transition-colors duration-200 {preferences.theme === 'dark' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-muted)]'} {saving ? 'opacity-50' : ''}"
                ></span>
                <span
                  class="absolute top-0.5 left-0.5 h-5 w-5 transform rounded bg-white transition-transform duration-200 {preferences.theme === 'dark' ? 'translate-x-5' : ''} {saving ? 'opacity-50' : ''}"
                ></span>
              </button>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Import Solved Problems Section -->
    <div
      class="mt-6 overflow-hidden rounded-none border-2 border-[var(--color-border)] shadow-[2px_2px_0_rgba(0,0,0,0.1)]"
    >
      <div class="border-b-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-4">
        <div class="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 text-[var(--color-text-muted)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span class="font-bold text-[var(--color-heading)]">Import solved problems</span>
        </div>
      </div>

      <div class="bg-[var(--color-secondary)] p-4">
        <p class="mb-3 text-sm text-[var(--color-text-muted)]">
          Import your solved problems from Codeforces. Only problems already tracked on gitgud are
          matched; nothing is created and re-importing is safe.
        </p>

        <div class="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            bind:value={cfHandle}
            placeholder="Codeforces handle"
            autocomplete="off"
            class="flex-1 rounded-none border-2 border-[var(--color-border)] bg-[var(--color-primary)] px-3 py-2 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
            disabled={importPreviewing || importing}
          />
          <button
            type="button"
            class="rounded-none border-2 border-[var(--color-border)] bg-[var(--color-tertiary)] px-4 py-2 font-medium text-[var(--color-heading)] hover:bg-[var(--color-accent)] hover:text-white disabled:opacity-50"
            on:click={previewCodeforcesImport}
            disabled={importPreviewing || importing}
          >
            {importPreviewing ? 'Loading…' : 'Preview'}
          </button>
        </div>

        {#if importError}
          <p class="mt-3 text-sm font-medium text-[var(--color-accent)]">{importError}</p>
        {/if}
        {#if importSuccess}
          <p class="mt-3 text-sm font-medium text-[var(--color-primary)]">{importSuccess}</p>
        {/if}

        {#if importPreview}
          <div class="mt-4 border-t-2 border-[var(--color-border)] pt-4">
            <p class="text-sm text-[var(--color-text)]">
              <span class="font-medium">{importPreview.matched.length}</span> solved problem{importPreview
                .matched.length === 1
                ? ''
                : 's'} matched.
              {#if importPreview.unmatchedCount > 0}
                <span class="text-[var(--color-text-muted)]">
                  {importPreview.unmatchedCount} solved problem{importPreview.unmatchedCount === 1
                    ? ''
                    : 's'} not tracked here.
                </span>
              {/if}
            </p>

            {#if importPreview.matched.length > 0}
              <button
                type="button"
                class="mt-3 rounded-none border-2 border-[var(--color-border)] bg-[var(--color-accent)] px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
                on:click={confirmCodeforcesImport}
                disabled={importing}
              >
                {importing ? 'Importing…' : `Import ${importPreview.matched.length}`}
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
