import { browser } from '$app/environment';
import { getCurrentActor } from '$lib/auth/currentActor';
import { writable, type Writable } from 'svelte/store';
import { fetchUserPreferences, updateThemePreferenceForUser, type UserPreferences } from './user';
import {
  normalizeThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference
} from './appearance';

export { THEME_PREFERENCES, normalizeThemePreference, resolveTheme } from './appearance';
export type { ResolvedTheme, ThemePreference } from './appearance';

// Seed the theme from the SSR-applied data-theme attribute so the first paint
// matches the server. Reads the DOM only in the browser; defaults to light
// everywhere else. The root element is injectable for unit tests.
export function resolveInitialTheme(
  isBrowser: boolean,
  getRoot: () => { dataset: { theme?: string } } | undefined = () =>
    (globalThis as { document?: { documentElement: { dataset: { theme?: string } } } }).document
      ?.documentElement
): ResolvedTheme {
  if (!isBrowser) return 'light';
  return getRoot()?.dataset.theme === 'dark' ? 'dark' : 'light';
}

export const currentThemePreference = writable<ThemePreference>('system');
export const currentTheme = writable<ResolvedTheme>(resolveInitialTheme(browser));

type MediaQuery = {
  matches: boolean;
  addEventListener: (type: 'change', listener: () => void) => void;
  removeEventListener: (type: 'change', listener: () => void) => void;
};

type ThemeServiceDependencies = {
  isBrowser: boolean;
  preferenceStore: Writable<ThemePreference>;
  themeStore: Writable<ResolvedTheme>;
  documentElement?: {
    dataset: Record<string, string | undefined>;
    style: { colorScheme: string };
  };
  mediaQuery?: MediaQuery;
  getActor: () => { user: { id: string } | null };
  fetchPreferences: () => Promise<UserPreferences | null>;
  updateThemeForUser: (userId: string, preference: ThemePreference) => Promise<boolean>;
};

export function createThemeService({
  isBrowser,
  preferenceStore,
  themeStore,
  documentElement,
  mediaQuery,
  getActor,
  fetchPreferences,
  updateThemeForUser
}: ThemeServiceDependencies) {
  let activePreference: ThemePreference = 'system';
  let preferenceRevision = 0;
  let listeningToSystem = false;
  let activeMediaQuery: MediaQuery | null = mediaQuery ?? null;
  let persistenceQueue: Promise<void> = Promise.resolve();

  const getMediaQuery = () =>
    (activeMediaQuery ??= window.matchMedia('(prefers-color-scheme: dark)'));
  const getDocumentElement = () => documentElement ?? document.documentElement;

  function applyResolvedTheme(): void {
    const resolved = resolveTheme(activePreference, getMediaQuery().matches);
    const root = getDocumentElement();
    themeStore.set(resolved);
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  }

  function handleSystemThemeChange(): void {
    if (activePreference === 'system') applyResolvedTheme();
  }

  function syncSystemListener(): void {
    const query = getMediaQuery();
    if (activePreference === 'system' && !listeningToSystem) {
      query.addEventListener('change', handleSystemThemeChange);
      listeningToSystem = true;
    } else if (activePreference !== 'system' && listeningToSystem) {
      query.removeEventListener('change', handleSystemThemeChange);
      listeningToSystem = false;
    }
  }

  function applyThemePreference(value: unknown): ThemePreference {
    const preference = normalizeThemePreference(value);
    activePreference = preference;
    preferenceRevision++;
    preferenceStore.set(preference);
    if (!isBrowser) return preference;

    syncSystemListener();
    applyResolvedTheme();
    return preference;
  }

  function initializeThemePreference(): ThemePreference {
    return applyThemePreference('system');
  }

  function persistThemeInOrder(userId: string, preference: ThemePreference): Promise<boolean> {
    const write = persistenceQueue.then(async () => {
      try {
        return await updateThemeForUser(userId, preference);
      } catch {
        return false;
      }
    });
    persistenceQueue = write.then(() => undefined);
    return write;
  }

  function saveThemePreference(preference: ThemePreference): Promise<boolean> {
    const userId = getActor().user?.id;
    if (!isBrowser || !userId) return Promise.resolve(false);
    return persistThemeInOrder(userId, normalizeThemePreference(preference));
  }

  function setThemePreference(value: unknown): Promise<boolean> {
    const userId = getActor().user?.id;
    if (!isBrowser || !userId) return Promise.resolve(false);
    const preference = applyThemePreference(value);
    return persistThemeInOrder(userId, preference);
  }

  async function loadThemePreference(): Promise<void> {
    if (!isBrowser) return;

    const revisionAtStart = preferenceRevision;
    const userIdAtStart = getActor().user?.id;
    try {
      const preferences = await fetchPreferences();
      if (!userIdAtStart || getActor().user?.id !== userIdAtStart) return;
      if (revisionAtStart !== preferenceRevision) return;
      applyThemePreference(preferences?.theme ?? 'system');
    } catch (error) {
      if (
        userIdAtStart &&
        getActor().user?.id === userIdAtStart &&
        revisionAtStart === preferenceRevision
      ) {
        applyThemePreference('system');
      }
      console.error('Failed to load theme preference:', error);
    }
  }

  function destroy(): void {
    if (isBrowser && listeningToSystem) {
      getMediaQuery().removeEventListener('change', handleSystemThemeChange);
      listeningToSystem = false;
    }
  }

  return {
    applyThemePreference,
    initializeThemePreference,
    saveThemePreference,
    setThemePreference,
    loadThemePreference,
    resetThemePreference: () => applyThemePreference('system'),
    destroy
  };
}

export const {
  applyThemePreference,
  initializeThemePreference,
  saveThemePreference,
  setThemePreference,
  loadThemePreference,
  resetThemePreference,
  destroy: destroyThemeService
} = createThemeService({
  isBrowser: browser,
  preferenceStore: currentThemePreference,
  themeStore: currentTheme,
  getActor: getCurrentActor,
  fetchPreferences: fetchUserPreferences,
  updateThemeForUser: updateThemePreferenceForUser
});
