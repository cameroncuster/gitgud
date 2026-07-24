/**
 * Theme management service
 */
import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import { getCurrentActor } from '$lib/auth/currentActor';
import { fetchUserPreferences, updateUserPreferences } from './user';

// Theme store
export const currentTheme = writable<string>('light');

/**
 * Apply a theme to the document
 * @param theme - The theme to apply ('light' or 'dark')
 */
export function applyTheme(theme: string): void {
  if (!browser) return;

  const resolved = theme === 'dark' ? 'dark' : 'light';

  // Update the store
  currentTheme.set(resolved);

  // Palettes live in app.css keyed on html[data-theme]; selecting the theme is a
  // single attribute write that matches the pre-paint inline script in app.html.
  document.documentElement.dataset.theme = resolved;
}

/**
 * Save theme preference to database
 * @param theme - The theme to save ('light' or 'dark')
 */
export async function saveThemePreference(theme: string): Promise<boolean> {
  if (!browser) return false;

  // Check if user is authenticated
  const currentUser = getCurrentActor().user;
  if (!currentUser) return false;

  try {
    // Get current preferences
    const preferences = await fetchUserPreferences();
    if (!preferences) return false;

    // Update theme preference
    preferences.theme = theme;

    // Save to database
    return await updateUserPreferences(preferences);
  } catch (err) {
    console.error('Failed to save theme preference:', err);
    return false;
  }
}

/**
 * Load theme preference from database
 */
export async function loadThemePreference(): Promise<void> {
  if (!browser) return;

  try {
    // Get current preferences
    const preferences = await fetchUserPreferences();
    if (!preferences) return;

    // Apply theme
    applyTheme(preferences.theme);

    // Also save to localStorage for faster loading on next visit
    localStorage.setItem('gitgud-theme', preferences.theme);
  } catch (err) {
    console.error('Failed to load theme preference:', err);
  }
}

/**
 * Toggle between light and dark themes
 */
export async function toggleTheme(): Promise<void> {
  const theme = get(currentTheme) === 'light' ? 'dark' : 'light';
  applyTheme(theme);
  await saveThemePreference(theme);
}
