import assert from 'node:assert/strict';
import { test } from 'node:test';
import { get, writable } from 'svelte/store';
import { createThemeService } from '../src/lib/services/theme.ts';
import type { UserPreferences } from '../src/lib/services/user.ts';

function setup(
  options: {
    user?: { id: string } | null;
    preferences?: UserPreferences | null;
    fetchError?: Error;
    updateError?: Error;
  } = {}
) {
  const themeStore = writable('light');
  const dataset: Record<string, string | undefined> = {};
  const stored = new Map<string, string>();
  const updated: UserPreferences[] = [];
  const service = createThemeService({
    isBrowser: true,
    themeStore,
    documentElement: { dataset },
    storage: { setItem: (key, value) => stored.set(key, value) },
    getActor: () => ({
      user: options.user === undefined ? { id: 'actor' } : options.user
    }),
    fetchPreferences: async () => {
      if (options.fetchError) throw options.fetchError;
      return options.preferences === undefined
        ? { hideFromLeaderboard: false, theme: 'dark' }
        : options.preferences;
    },
    updatePreferences: async (preferences) => {
      if (options.updateError) throw options.updateError;
      updated.push({ ...preferences });
      return true;
    }
  });
  return { service, themeStore, dataset, stored, updated };
}

test('browser theme service applies only supported themes to store and document', () => {
  const context = setup();
  context.service.applyTheme('dark');
  assert.equal(get(context.themeStore), 'dark');
  assert.equal(context.dataset.theme, 'dark');

  context.service.applyTheme('paper');
  assert.equal(get(context.themeStore), 'light');
  assert.equal(context.dataset.theme, 'light');
});

test('browser theme service saves a signed-in actor preference', async () => {
  const context = setup({
    preferences: { hideFromLeaderboard: true, theme: 'light' }
  });
  assert.equal(await context.service.saveThemePreference('dark'), true);
  assert.deepEqual(context.updated, [{ hideFromLeaderboard: true, theme: 'dark' }]);
});

test('theme saving requires an actor and existing preferences', async () => {
  const anonymous = setup({ user: null });
  assert.equal(await anonymous.service.saveThemePreference('dark'), false);

  const missing = setup({ preferences: null });
  assert.equal(await missing.service.saveThemePreference('dark'), false);
  assert.deepEqual(missing.updated, []);
});

test('loading applies and caches a browser preference', async () => {
  const context = setup({
    preferences: { hideFromLeaderboard: false, theme: 'dark' }
  });
  await context.service.loadThemePreference();
  assert.equal(get(context.themeStore), 'dark');
  assert.equal(context.dataset.theme, 'dark');
  assert.equal(context.stored.get('gitgud-theme'), 'dark');
});

test('toggle persists the next theme and returns to light', async () => {
  const context = setup();
  await context.service.toggleTheme();
  await context.service.toggleTheme();
  assert.equal(get(context.themeStore), 'light');
  assert.equal(context.dataset.theme, 'light');
  assert.deepEqual(
    context.updated.map((preference) => preference.theme),
    ['dark', 'light']
  );
});

test('loading missing preferences leaves browser state untouched', async () => {
  const context = setup({ preferences: null });
  await context.service.loadThemePreference();
  assert.equal(get(context.themeStore), 'light');
  assert.equal(context.dataset.theme, undefined);
  assert.equal(context.stored.size, 0);
});

test('theme service contains browser preference read and write failures', async () => {
  const readFailure = setup({ fetchError: new Error('offline') });
  await readFailure.service.loadThemePreference();
  assert.equal(await readFailure.service.saveThemePreference('dark'), false);

  const writeFailure = setup({ updateError: new Error('denied') });
  assert.equal(await writeFailure.service.saveThemePreference('dark'), false);
});
