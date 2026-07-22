/**
 * Theme management service
 */
import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import { retroBlueLightTheme } from '../theme-options/retro-blue-light';
import { retroBlueDarkTheme } from '../theme-options/retro-blue-dark';
import { fetchUserPreferences, updateUserPreferences } from './user';
import { user } from './auth';

// Theme store
export const currentTheme = writable<string>('light');

/**
 * Apply a theme to the document
 * @param theme - The theme to apply ('light' or 'dark')
 */
export function applyTheme(theme: string): void {
  if (!browser) return;

  // Update the store
  currentTheme.set(theme);

  // Apply the selected theme
  let themeColors: string;

  switch (theme) {
    case 'dark':
      themeColors = retroBlueDarkTheme.colors;
      // Add a class to the body for easier CSS targeting
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
      break;
    case 'light':
    default:
      themeColors = retroBlueLightTheme.colors;
      // Add a class to the body for easier CSS targeting
      document.body.classList.add('light-theme');
      document.body.classList.remove('dark-theme');
      break;
  }

  // If we have theme colors to apply, create a style element and add it to the head
  if (themeColors) {
    // Remove any existing theme style element
    const existingTheme = document.getElementById('theme-colors');
    if (existingTheme) {
      existingTheme.remove();
    }

    // Create a new style element
    const style = document.createElement('style');
    style.id = 'theme-colors';
    style.textContent = `:root {${themeColors}}`;
    document.head.appendChild(style);
  }
}

/**
 * Save theme preference to database
 * @param theme - The theme to save ('light' or 'dark')
 */
export async function saveThemePreference(theme: string): Promise<boolean> {
  if (!browser) return false;

  // Check if user is authenticated
  const currentUser = get(user);
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
