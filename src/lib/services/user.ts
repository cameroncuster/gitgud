/**
 * Service for user operations
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentActor } from '$lib/auth/currentActor';
import { supabase } from './database';
import { normalizeThemePreference, type ThemePreference } from './appearance';

/**
 * User preferences interface
 */
export type UserPreferences = {
  hideFromLeaderboard: boolean;
  theme: ThemePreference;
};

/**
 * Database record type from Supabase
 */
export type UserPreferencesRecord = {
  id: string;
  user_id: string;
  hide_from_leaderboard: boolean;
  theme: string;
  created_at: string;
  updated_at: string;
};

/**
 * Fetches user preferences from the database
 * @returns User preferences or null if not found
 */
type UserServiceDependencies = {
  client: SupabaseClient;
  getCurrentUser: () => { id: string } | null;
  now?: () => string;
  wait?: (milliseconds: number) => Promise<void>;
};

export function createUserService({
  client,
  getCurrentUser,
  now = () => new Date().toISOString(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}: UserServiceDependencies) {
  type PreferenceWrite = {
    update: { hide_from_leaderboard?: boolean; theme?: ThemePreference };
    insert: { hide_from_leaderboard?: boolean; theme?: ThemePreference };
  };

  async function persistPreferencesForUser(
    userId: string,
    write: PreferenceWrite
  ): Promise<boolean> {
    if (!userId || getCurrentUser()?.id !== userId) return false;

    try {
      const { data: existingRows, error: checkError } = await client
        .from('user_preferences')
        .select('id')
        .eq('user_id', userId)
        .limit(1);
      if (checkError && checkError.code !== 'PGRST116') return false;

      const existing = (existingRows as { id: string }[] | null)?.[0];
      let result;
      if (existing) {
        result = await client
          .from('user_preferences')
          .update({ ...write.update, updated_at: now() })
          .eq('user_id', userId);
      } else {
        const timestamp = now();
        result = await client.from('user_preferences').insert({
          user_id: userId,
          ...write.insert,
          created_at: timestamp,
          updated_at: timestamp
        });
      }

      if (!result.error) return true;
      if (result.error.code !== '23505') return false;

      await wait(100);
      const retry = await client
        .from('user_preferences')
        .update({ ...write.update, updated_at: now() })
        .eq('user_id', userId);
      return !retry.error;
    } catch {
      return false;
    }
  }

  async function fetchUserPreferences(): Promise<UserPreferences | null> {
    const currentUser = getCurrentUser();
    if (!currentUser) return null;
    const userId = currentUser.id;

    try {
      const { data, error } = await client
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .limit(1);

      if (error) return null;
      const record = (data as UserPreferencesRecord[] | null)?.[0];
      if (!record) {
        const defaults: UserPreferences = { hideFromLeaderboard: false, theme: 'system' };
        const created = await persistPreferencesForUser(userId, { update: {}, insert: {} });
        return created ? defaults : null;
      }
      return {
        hideFromLeaderboard: record.hide_from_leaderboard,
        theme: normalizeThemePreference(record.theme)
      };
    } catch {
      return null;
    }
  }

  function updateUserPreferencesForUser(
    userId: string,
    preferences: UserPreferences
  ): Promise<boolean> {
    const normalizedTheme = normalizeThemePreference(preferences.theme);
    return persistPreferencesForUser(userId, {
      update: {
        hide_from_leaderboard: preferences.hideFromLeaderboard,
        theme: normalizedTheme
      },
      insert: {
        hide_from_leaderboard: preferences.hideFromLeaderboard,
        theme: normalizedTheme
      }
    });
  }

  function updateUserPreferences(preferences: UserPreferences): Promise<boolean> {
    const currentUser = getCurrentUser();
    if (!currentUser) return Promise.resolve(false);
    return updateUserPreferencesForUser(currentUser.id, preferences);
  }

  function updateThemePreferenceForUser(userId: string, theme: unknown): Promise<boolean> {
    const normalizedTheme = normalizeThemePreference(theme);
    return persistPreferencesForUser(userId, {
      update: { theme: normalizedTheme },
      insert: { theme: normalizedTheme }
    });
  }

  function updateLeaderboardPrivacyForUser(
    userId: string,
    hideFromLeaderboard: boolean
  ): Promise<boolean> {
    return persistPreferencesForUser(userId, {
      update: { hide_from_leaderboard: hideFromLeaderboard },
      insert: { hide_from_leaderboard: hideFromLeaderboard }
    });
  }

  return {
    fetchUserPreferences,
    updateUserPreferences,
    updateThemePreferenceForUser,
    updateLeaderboardPrivacyForUser
  };
}

export const {
  fetchUserPreferences,
  updateUserPreferences,
  updateThemePreferenceForUser,
  updateLeaderboardPrivacyForUser
} = createUserService({
  client: supabase,
  getCurrentUser: () => getCurrentActor().user
});
