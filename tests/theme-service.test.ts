import assert from 'node:assert/strict';
import { test } from 'node:test';
import { get, writable } from 'svelte/store';
import { createThemeService, resolveInitialTheme } from '../src/lib/services/theme.ts';
import {
  nextThemePreference,
  type ResolvedTheme,
  type ThemePreference
} from '../src/lib/services/appearance.ts';
import type { UserPreferences } from '../src/lib/services/user.ts';

function setup(
  options: {
    user?: { id: string } | null;
    stored?: string | null;
    systemDark?: boolean;
    preferences?: UserPreferences | null;
    fetchError?: Error;
    updateError?: Error;
    updateTheme?: (userId: string, preference: ThemePreference) => Promise<boolean>;
  } = {}
) {
  const preferenceStore = writable<ThemePreference>('system');
  const themeStore = writable<ResolvedTheme>('light');
  const dataset: Record<string, string | undefined> = {};
  const style = { colorScheme: '' };
  const stored = new Map<string, string>();
  if (options.stored != null) stored.set('gitgud-theme', options.stored);
  const listeners = new Set<() => void>();
  const mediaQuery = {
    matches: options.systemDark ?? false,
    addEventListener: (_type: 'change', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'change', listener: () => void) => listeners.delete(listener)
  };
  let currentUser = options.user === undefined ? { id: 'actor' } : options.user;
  const updated: Array<{ userId: string; preference: ThemePreference }> = [];
  const service = createThemeService({
    isBrowser: true,
    preferenceStore,
    themeStore,
    documentElement: { dataset, style },
    storage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value)
    },
    mediaQuery,
    getActor: () => ({ user: currentUser }),
    fetchPreferences: async () => {
      if (options.fetchError) throw options.fetchError;
      return options.preferences === undefined
        ? { hideFromLeaderboard: false, theme: 'dark' }
        : options.preferences;
    },
    updateThemeForUser: async (userId, preference) => {
      if (options.updateError) throw options.updateError;
      if (options.updateTheme) return options.updateTheme(userId, preference);
      updated.push({ userId, preference });
      return true;
    }
  });
  return {
    service,
    preferenceStore,
    themeStore,
    dataset,
    style,
    stored,
    updated,
    mediaQuery,
    listeners,
    setUser: (user: { id: string } | null) => {
      currentUser = user;
    }
  };
}

test('initial theme seeds from the SSR data-theme attribute only in the browser', (t) => {
  assert.equal(
    resolveInitialTheme(false, () => ({ dataset: { theme: 'dark' } })),
    'light'
  );
  assert.equal(
    resolveInitialTheme(true, () => ({ dataset: { theme: 'dark' } })),
    'dark'
  );
  assert.equal(
    resolveInitialTheme(true, () => ({ dataset: { theme: 'light' } })),
    'light'
  );
  assert.equal(
    resolveInitialTheme(true, () => ({ dataset: {} })),
    'light'
  );
  assert.equal(
    resolveInitialTheme(true, () => undefined),
    'light'
  );

  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { dataset: { theme: 'dark' } } }
  });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  assert.equal(resolveInitialTheme(true), 'dark');
});

test('theme preferences cycle from System to Light to Dark', () => {
  assert.equal(nextThemePreference('system'), 'light');
  assert.equal(nextThemePreference('light'), 'dark');
  assert.equal(nextThemePreference('dark'), 'system');
});

test('initialization normalizes missing and invalid local preferences to System', () => {
  for (const value of [null, 'paper']) {
    const context = setup({ stored: value, systemDark: true });
    assert.equal(context.service.initializeThemePreference(), 'system');
    assert.equal(get(context.preferenceStore), 'system');
    assert.equal(get(context.themeStore), 'dark');
    assert.equal(context.dataset.theme, 'dark');
    assert.equal(context.style.colorScheme, 'dark');
    assert.equal(context.stored.get('gitgud-theme'), 'system');
  }
});

test('explicit light and dark choices remain semantic preferences', () => {
  const context = setup({ systemDark: true });
  context.service.applyThemePreference('light');
  assert.equal(get(context.preferenceStore), 'light');
  assert.equal(get(context.themeStore), 'light');
  context.service.applyThemePreference('dark');
  assert.equal(get(context.preferenceStore), 'dark');
  assert.equal(get(context.themeStore), 'dark');
});

test('System listens to media changes and explicit choices stop listening', () => {
  const context = setup();
  context.service.applyThemePreference('system');
  assert.equal(context.listeners.size, 1);
  context.mediaQuery.matches = true;
  for (const listener of context.listeners) listener();
  assert.equal(get(context.themeStore), 'dark');

  context.service.applyThemePreference('light');
  assert.equal(context.listeners.size, 0);
  context.mediaQuery.matches = false;
  assert.equal(get(context.themeStore), 'light');
});

test('signed-in choices apply locally and persist only theme for the captured actor', async () => {
  const context = setup({ preferences: { hideFromLeaderboard: true, theme: 'light' } });
  assert.equal(await context.service.setThemePreference('dark'), true);
  assert.equal(get(context.themeStore), 'dark');
  assert.deepEqual(context.updated, [{ userId: 'actor', preference: 'dark' }]);
});

test('rapid choices persist in selection order even when the first write is slow', async () => {
  let finishFirst: ((saved: boolean) => void) | undefined;
  const calls: Array<{ userId: string; preference: ThemePreference }> = [];
  const context = setup({
    updateTheme: (userId, preference) => {
      calls.push({ userId, preference });
      if (preference === 'light') {
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve(true);
    }
  });

  const light = context.service.setThemePreference('light');
  const dark = context.service.setThemePreference('dark');
  await Promise.resolve();
  assert.deepEqual(calls, [{ userId: 'actor', preference: 'light' }]);
  finishFirst?.(true);
  assert.deepEqual(await Promise.all([light, dark]), [true, true]);
  assert.deepEqual(calls, [
    { userId: 'actor', preference: 'light' },
    { userId: 'actor', preference: 'dark' }
  ]);
  assert.equal(get(context.preferenceStore), 'dark');
});

test('queued writes retain the actor captured by each selection', async () => {
  let finishFirst: ((saved: boolean) => void) | undefined;
  const calls: Array<{ userId: string; preference: ThemePreference }> = [];
  const context = setup({
    user: { id: 'actor-a' },
    updateTheme: (userId, preference) => {
      calls.push({ userId, preference });
      if (calls.length === 1) {
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve(true);
    }
  });

  const first = context.service.setThemePreference('light');
  context.setUser({ id: 'actor-b' });
  const second = context.service.setThemePreference('dark');
  await Promise.resolve();
  finishFirst?.(true);
  await Promise.all([first, second]);
  assert.deepEqual(calls, [
    { userId: 'actor-a', preference: 'light' },
    { userId: 'actor-b', preference: 'dark' }
  ]);
});

test('anonymous choices remain local and do not fetch account preferences', async () => {
  const context = setup({ user: null, fetchError: new Error('must not fetch') });
  assert.equal(await context.service.setThemePreference('dark'), true);
  assert.equal(context.stored.get('gitgud-theme'), 'dark');
  assert.deepEqual(context.updated, []);
});

test('loaded account preference becomes authoritative after auth resolution', async () => {
  const context = setup({
    stored: 'light',
    preferences: { hideFromLeaderboard: false, theme: 'dark' }
  });
  context.service.initializeThemePreference();
  assert.equal(get(context.themeStore), 'light');
  await context.service.loadThemePreference();
  assert.equal(get(context.preferenceStore), 'dark');
  assert.equal(get(context.themeStore), 'dark');
  assert.equal(context.stored.get('gitgud-theme'), 'dark');
});

test('local choices are not overwritten by distinct stale account fetches', async () => {
  const fetchResolvers: Array<(preferences: UserPreferences) => void> = [];
  const preferenceStore = writable<ThemePreference>('system');
  const themeStore = writable<ResolvedTheme>('light');
  const service = createThemeService({
    isBrowser: true,
    preferenceStore,
    themeStore,
    documentElement: { dataset: {}, style: { colorScheme: '' } },
    storage: { getItem: () => 'light', setItem: () => {} },
    mediaQuery: {
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    getActor: () => ({ user: { id: 'actor' } }),
    fetchPreferences: () =>
      new Promise((resolve) => {
        fetchResolvers.push(resolve);
      }),
    updateThemeForUser: async () => true
  });
  service.initializeThemePreference();
  const firstLoad = service.loadThemePreference();
  const secondLoad = service.loadThemePreference();
  await service.setThemePreference('dark');
  assert.equal(fetchResolvers.length, 2);
  fetchResolvers[0]({ hideFromLeaderboard: false, theme: 'light' });
  fetchResolvers[1]({ hideFromLeaderboard: false, theme: 'system' });
  await Promise.all([firstLoad, secondLoad]);
  assert.equal(get(preferenceStore), 'dark');
});

test('missing and failed account reads leave the local preference untouched', async () => {
  for (const options of [{ preferences: null }, { fetchError: new Error('offline') }]) {
    const context = setup({ stored: 'dark', ...options });
    context.service.initializeThemePreference();
    await context.service.loadThemePreference();
    assert.equal(get(context.themeStore), 'dark');
  }
});

test('saving requires a browser actor', async () => {
  assert.equal(await setup({ user: null }).service.saveThemePreference('dark'), false);

  const preferenceStore = writable<ThemePreference>('system');
  const themeStore = writable<ResolvedTheme>('light');
  const server = createThemeService({
    isBrowser: false,
    preferenceStore,
    themeStore,
    getActor: () => ({ user: { id: 'actor' } }),
    fetchPreferences: async () => ({ hideFromLeaderboard: false, theme: 'dark' }),
    updateThemeForUser: async () => true
  });
  assert.equal(server.initializeThemePreference(), 'system');
  assert.equal(server.applyThemePreference('dark'), 'dark');
  assert.equal(await server.saveThemePreference('dark'), false);
  await server.loadThemePreference();
  server.destroy();
  assert.equal(get(themeStore), 'light');
});

test('storage denial does not prevent in-memory theme application', () => {
  const preferenceStore = writable<ThemePreference>('system');
  const themeStore = writable<ResolvedTheme>('light');
  const service = createThemeService({
    isBrowser: true,
    preferenceStore,
    themeStore,
    documentElement: { dataset: {}, style: { colorScheme: '' } },
    storage: {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      }
    },
    mediaQuery: {
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    getActor: () => ({ user: null }),
    fetchPreferences: async () => null,
    updateThemeForUser: async () => false
  });
  assert.equal(service.initializeThemePreference(), 'system');
  assert.equal(get(themeStore), 'dark');
  service.applyThemePreference('light', false);
  assert.equal(get(themeStore), 'light');
});

test('browser services fall back to global storage and document when none are injected', (t) => {
  const dataset: Record<string, string | undefined> = {};
  const style = { colorScheme: '' };
  const store = new Map<string, string>();
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value)
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { dataset, style } }
  });
  t.after(() => {
    if (previousLocalStorage)
      Object.defineProperty(globalThis, 'localStorage', previousLocalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  const preferenceStore = writable<ThemePreference>('system');
  const themeStore = writable<ResolvedTheme>('light');
  const service = createThemeService({
    isBrowser: true,
    preferenceStore,
    themeStore,
    mediaQuery: {
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    getActor: () => ({ user: null }),
    fetchPreferences: async () => null,
    updateThemeForUser: async () => false
  });
  assert.equal(service.initializeThemePreference(), 'system');
  assert.equal(store.get('gitgud-theme'), 'system');
  assert.equal(dataset.theme, 'dark');
  assert.equal(style.colorScheme, 'dark');
});

test('save failures are contained and destroy removes the media listener', async () => {
  const context = setup({ updateError: new Error('denied') });
  context.service.applyThemePreference('system');
  assert.equal(await context.service.saveThemePreference('dark'), false);
  context.service.destroy();
  context.service.destroy();
  assert.equal(context.listeners.size, 0);
});
