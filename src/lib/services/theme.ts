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
export const THEME_STORAGE_KEY = 'gitgud-theme';

const initialResolvedTheme: ResolvedTheme =
  browser && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
export const currentThemePreference = writable<ThemePreference>('system');
export const currentTheme = writable<ResolvedTheme>(initialResolvedTheme);

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
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
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
  storage,
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
  const getStorage = () => storage ?? localStorage;
  const getDocumentElement = () => documentElement ?? document.documentElement;

  function readStoredPreference(): string | null {
    try {
      return getStorage().getItem(THEME_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function storePreference(preference: ThemePreference): void {
    try {
      getStorage().setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // The applied in-memory preference still works when storage is unavailable.
    }
  }

  function applyResolvedTheme(): void {
    if (!isBrowser) return;
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
    if (!isBrowser) return;
    const query = getMediaQuery();
    if (activePreference === 'system' && !listeningToSystem) {
      query.addEventListener('change', handleSystemThemeChange);
      listeningToSystem = true;
    } else if (activePreference !== 'system' && listeningToSystem) {
      query.removeEventListener('change', handleSystemThemeChange);
      listeningToSystem = false;
    }
  }

  function applyThemePreference(value: unknown, persistLocally = true): ThemePreference {
    const preference = normalizeThemePreference(value);
    activePreference = preference;
    preferenceRevision++;
    preferenceStore.set(preference);
    if (!isBrowser) return preference;

    if (persistLocally) storePreference(preference);
    syncSystemListener();
    applyResolvedTheme();
    return preference;
  }

  function initializeThemePreference(): ThemePreference {
    if (!isBrowser) return 'system';
    return applyThemePreference(readStoredPreference());
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
    const preference = applyThemePreference(value);
    const userId = getActor().user?.id;
    if (!userId) return Promise.resolve(true);
    return persistThemeInOrder(userId, preference);
  }

  async function loadThemePreference(): Promise<void> {
    if (!isBrowser) return;

    const revisionAtStart = preferenceRevision;
    const userIdAtStart = getActor().user?.id;
    try {
      const preferences = await fetchPreferences();
      if (
        preferences &&
        userIdAtStart &&
        getActor().user?.id === userIdAtStart &&
        revisionAtStart === preferenceRevision
      ) {
        applyThemePreference(preferences.theme);
      }
    } catch (error) {
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
    destroy
  };
}

export const {
  applyThemePreference,
  initializeThemePreference,
  saveThemePreference,
  setThemePreference,
  loadThemePreference,
  destroy: destroyThemeService
} = createThemeService({
  isBrowser: browser,
  preferenceStore: currentThemePreference,
  themeStore: currentTheme,
  getActor: getCurrentActor,
  fetchPreferences: fetchUserPreferences,
  updateThemeForUser: updateThemePreferenceForUser
});
