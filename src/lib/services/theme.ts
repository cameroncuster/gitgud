/**
 * Theme management service
 */
import { browser } from '$app/environment';
import { getCurrentActor } from '$lib/auth/currentActor';
import { get, writable, type Writable } from 'svelte/store';
import { fetchUserPreferences, updateUserPreferences, type UserPreferences } from './user';

export const currentTheme = writable<string>('light');

type ThemeServiceDependencies = {
  isBrowser: boolean;
  themeStore: Writable<string>;
  documentElement?: { dataset: Record<string, string | undefined> };
  storage?: Pick<Storage, 'setItem'>;
  getActor: () => { user: { id: string } | null };
  fetchPreferences: () => Promise<UserPreferences | null>;
  updatePreferences: (preferences: UserPreferences) => Promise<boolean>;
};

export function createThemeService({
  isBrowser,
  themeStore,
  documentElement,
  storage,
  getActor,
  fetchPreferences,
  updatePreferences
}: ThemeServiceDependencies) {
  function applyTheme(theme: string): void {
    if (!isBrowser) return;

    const resolved = theme === 'dark' ? 'dark' : 'light';
    themeStore.set(resolved);
    (documentElement ?? document.documentElement).dataset.theme = resolved;
  }

  async function saveThemePreference(theme: string): Promise<boolean> {
    if (!isBrowser || !getActor().user) return false;

    try {
      const preferences = await fetchPreferences();
      if (!preferences) return false;
      preferences.theme = theme;
      return await updatePreferences(preferences);
    } catch (err) {
      console.error('Failed to save theme preference:', err);
      return false;
    }
  }

  async function loadThemePreference(): Promise<void> {
    if (!isBrowser) return;

    try {
      const preferences = await fetchPreferences();
      if (!preferences) return;
      applyTheme(preferences.theme);
      (storage ?? localStorage).setItem('gitgud-theme', preferences.theme);
    } catch (err) {
      console.error('Failed to load theme preference:', err);
    }
  }

  async function toggleTheme(): Promise<void> {
    const theme = get(themeStore) === 'light' ? 'dark' : 'light';
    applyTheme(theme);
    await saveThemePreference(theme);
  }

  return { applyTheme, saveThemePreference, loadThemePreference, toggleTheme };
}

export const { applyTheme, saveThemePreference, loadThemePreference, toggleTheme } =
  createThemeService({
    isBrowser: browser,
    themeStore: currentTheme,
    getActor: getCurrentActor,
    fetchPreferences: fetchUserPreferences,
    updatePreferences: updateUserPreferences
  });
