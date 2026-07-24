import { get, writable } from 'svelte/store';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '$lib/services/database';

export type CurrentActor = {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  adminCheckFailed: boolean;
  initialized: boolean;
};

const initialActor: CurrentActor = {
  session: null,
  user: null,
  isAdmin: false,
  adminCheckFailed: false,
  initialized: false
};

export const currentActor = writable<CurrentActor>(initialActor);

let authSubscription: { unsubscribe: () => void } | null = null;
let bootstrapPromise: Promise<CurrentActor> | null = null;
let actorVersion = 0;

type AdminLookup = Pick<CurrentActor, 'isAdmin' | 'adminCheckFailed'>;

async function lookupAdmin(userId: string): Promise<AdminLookup> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error checking admin status:', error);
      return { isAdmin: false, adminCheckFailed: true };
    }
    return { isAdmin: data?.role === 'admin', adminCheckFailed: false };
  } catch (error) {
    console.error('Failed to check admin status:', error);
    return { isAdmin: false, adminCheckFailed: true };
  }
}

async function applySession(session: Session | null): Promise<CurrentActor> {
  const version = ++actorVersion;
  const user = session?.user ?? null;
  const base: CurrentActor = {
    session,
    user,
    isAdmin: false,
    adminCheckFailed: false,
    initialized: true
  };
  currentActor.set(base);
  if (!user) return base;

  const next = { ...base, ...(await lookupAdmin(user.id)) };
  if (version === actorVersion) currentActor.set(next);
  return next;
}

async function bootstrap(): Promise<CurrentActor> {
  const { data } = await supabase.auth.getSession();
  const actor = await applySession(data.session);
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    const actor = get(currentActor);
    if (actor.initialized && actor.session?.access_token === session?.access_token) {
      currentActor.set({ ...actor, session });
      return;
    }
    void applySession(session);
  });
  authSubscription = listener.subscription;
  return actor;
}

export function resolveCurrentActor(): Promise<CurrentActor> {
  bootstrapPromise ??= bootstrap();
  return bootstrapPromise;
}

export async function startCurrentActor(): Promise<() => void> {
  await resolveCurrentActor();
  return stopCurrentActor;
}

export function stopCurrentActor(): void {
  authSubscription?.unsubscribe();
  authSubscription = null;
  bootstrapPromise = null;
  actorVersion++;
  currentActor.set(initialActor);
}

export function getCurrentActor(): CurrentActor {
  return get(currentActor);
}

export async function signInWithGithub(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: `${window.location.origin}/auth/callback` }
  });
  if (error) {
    console.error('Error signing in with Github:', error);
    throw error;
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Error signing out:', error);
    throw error;
  }
}
