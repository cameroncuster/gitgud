import { supabase } from './database';
import { writable } from 'svelte/store';
import type { Session, User } from '@supabase/supabase-js';

// Create a store for the user
export const user = writable<User | null>(null);
export const session = writable<Session | null>(null);
// True once the initial session has been resolved. Consumers can use this to
// avoid rendering a signed-in/signed-out state before auth is known.
export const authInitialized = writable(false);

// Initialize the auth state
export async function initAuth() {
  // Get the initial session
  const { data } = await supabase.auth.getSession();
  session.set(data.session);
  user.set(data.session?.user || null);
  authInitialized.set(true);

  // Listen for auth changes
  const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
    session.set(newSession);
    user.set(newSession?.user || null);
  });

  return authListener;
}

// Sign in with Github
export async function signInWithGithub() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`
    }
  });

  if (error) {
    console.error('Error signing in with Github:', error);
    throw error;
  }
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('Error signing out:', error);
    throw error;
  }
}

// Check if user has admin role
export async function isAdmin(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error checking admin status:', error);
      return false;
    }

    return data?.role === 'admin';
  } catch (err) {
    console.error('Failed to check admin status:', err);
    return false;
  }
}
