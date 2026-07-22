/**
 * Service for user operations
 */
import { supabase } from './database';
import { user } from './auth';
import { get } from 'svelte/store';

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
export async function fetchUserPreferences(): Promise<UserPreferences | null> {
  // First try to get the user from the store
  let currentUser = get(user);

  // If no user in the store, try to get it directly from Supabase
  if (!currentUser) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        currentUser = data.session.user;
      }
    } catch (err) {
      console.error('fetchUserPreferences: Error getting session', err);
    }
  }

  if (!currentUser) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', currentUser.id)
      .single();

    if (error) {
      // If the error is that no rows were returned, create default preferences
      if (error.code === 'PGRST116') {
        // Create default preferences
        const result = await updateUserPreferences({
          hideFromLeaderboard: false,
          theme: 'light'
        });

        if (result) {
          return {
            hideFromLeaderboard: false,
            theme: 'light'
          };
        }
      }
      return null;
    }

    if (!data) {
      return null;
    }

    const record = data as UserPreferencesRecord;
    return {
      hideFromLeaderboard: record.hide_from_leaderboard,
      theme: record.theme || 'light' // Provide default if not present
    };
  } catch (err) {
    console.error('fetchUserPreferences: Exception', err);
    return null;
  }
}

/**
 * Updates user preferences in the database
 * @param preferences - User preferences to update
 * @returns True if successful, false otherwise
 */
export async function updateUserPreferences(preferences: UserPreferences): Promise<boolean> {
  // First try to get the user from the store
  let currentUser = get(user);

  // If no user in the store, try to get it directly from Supabase
  if (!currentUser) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        currentUser = data.session.user;
      }
    } catch (err) {
      console.error('updateUserPreferences: Error getting session', err);
    }
  }

  if (!currentUser) {
    return false;
  }

  try {
    // First check if a record exists
    const { data: existingData, error: checkError } = await supabase
      .from('user_preferences')
      .select('id')
      .eq('user_id', currentUser.id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('updateUserPreferences: Error checking if preferences exist', checkError);
    }

    let result;

    if (existingData) {
      // Update existing record
      result = await supabase
        .from('user_preferences')
        .update({
          hide_from_leaderboard: preferences.hideFromLeaderboard,
          theme: preferences.theme,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', currentUser.id);
    } else {
      // Insert new record
      result = await supabase.from('user_preferences').insert({
        user_id: currentUser.id,
        hide_from_leaderboard: preferences.hideFromLeaderboard,
        theme: preferences.theme,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    if (result.error) {
      console.error('updateUserPreferences: Error updating/inserting preferences', result.error);
      // If we still have an error and it's a duplicate key error,
      // try one more time with an update
      if (result.error.code === '23505') {
        // Wait a moment before retrying
        await new Promise((resolve) => setTimeout(resolve, 100));

        result = await supabase
          .from('user_preferences')
          .update({
            hide_from_leaderboard: preferences.hideFromLeaderboard,
            theme: preferences.theme,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', currentUser.id);

        if (result.error) {
          console.error('updateUserPreferences: Error on retry', result.error);
          return false;
        }
      } else {
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('updateUserPreferences: Exception', err);
    return false;
  }
}
