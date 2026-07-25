/**
 * Service for user operations
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentActor } from '$lib/auth/currentActor';
import { supabase } from './database';

/**
 * User preferences interface
 */
export type UserPreferences = {
  hideFromLeaderboard: boolean;
  theme: string;
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
  async function fetchUserPreferences(): Promise<UserPreferences | null> {
    const currentUser = getCurrentUser();
    if (!currentUser) return null;

    try {
      const { data, error } = await client
        .from('user_preferences')
        .select('*')
        .eq('user_id', currentUser.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          const defaults = { hideFromLeaderboard: false, theme: 'light' };
          if (await updateUserPreferences(defaults)) return defaults;
        }
        return null;
      }
      if (!data) return null;

      const record = data as UserPreferencesRecord;
      return {
        hideFromLeaderboard: record.hide_from_leaderboard,
        theme: record.theme || 'light'
      };
    } catch (err) {
      console.error('fetchUserPreferences: Exception', err);
      return null;
    }
  }

  async function updateUserPreferences(preferences: UserPreferences): Promise<boolean> {
    const currentUser = getCurrentUser();
    if (!currentUser) return false;

    try {
      const { data: existingData, error: checkError } = await client
        .from('user_preferences')
        .select('id')
        .eq('user_id', currentUser.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('updateUserPreferences: Error checking if preferences exist', checkError);
      }

      let result;
      if (existingData) {
        result = await client
          .from('user_preferences')
          .update({
            hide_from_leaderboard: preferences.hideFromLeaderboard,
            theme: preferences.theme,
            updated_at: now()
          })
          .eq('user_id', currentUser.id);
      } else {
        const timestamp = now();
        result = await client.from('user_preferences').insert({
          user_id: currentUser.id,
          hide_from_leaderboard: preferences.hideFromLeaderboard,
          theme: preferences.theme,
          created_at: timestamp,
          updated_at: timestamp
        });
      }

      if (result.error) {
        console.error('updateUserPreferences: Error updating/inserting preferences', result.error);
        if (result.error.code !== '23505') return false;

        await wait(100);
        result = await client
          .from('user_preferences')
          .update({
            hide_from_leaderboard: preferences.hideFromLeaderboard,
            theme: preferences.theme,
            updated_at: now()
          })
          .eq('user_id', currentUser.id);
        if (result.error) {
          console.error('updateUserPreferences: Error on retry', result.error);
          return false;
        }
      }

      return true;
    } catch (err) {
      console.error('updateUserPreferences: Exception', err);
      return false;
    }
  }

  return { fetchUserPreferences, updateUserPreferences };
}

export const { fetchUserPreferences, updateUserPreferences } = createUserService({
  client: supabase,
  getCurrentUser: () => getCurrentActor().user
});
