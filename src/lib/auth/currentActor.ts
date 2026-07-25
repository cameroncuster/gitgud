import { get, writable } from 'svelte/store';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
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

type AdminLookup = Pick<CurrentActor, 'isAdmin' | 'adminCheckFailed'>;

type CurrentActorDependencies = {
  client: SupabaseClient;
  getOrigin?: () => string;
};

export function createCurrentActor({
  client,
  getOrigin = () => window.location.origin
}: CurrentActorDependencies) {
  const currentActor = writable<CurrentActor>(initialActor);
  let authSubscription: { unsubscribe: () => void; deactivate: () => void } | null = null;
  let bootstrapPromise: Promise<CurrentActor> | null = null;
  let actorVersion = 0;

  async function lookupAdmin(userId: string): Promise<AdminLookup> {
    try {
      const { data, error } = await client
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
    if (version === actorVersion) {
      currentActor.set(next);
      return next;
    }
    return get(currentActor);
  }

  async function bootstrap(): Promise<CurrentActor> {
    const bootstrapVersion = actorVersion;
    let data: { session: Session | null };
    try {
      ({ data } = await client.auth.getSession());
    } catch (error) {
      console.error('Failed to resolve current session:', error);
      if (bootstrapVersion === actorVersion) {
        currentActor.set({ ...initialActor, initialized: true });
      }
      return get(currentActor);
    }
    if (bootstrapVersion !== actorVersion) return get(currentActor);
    const session = data.session;
    const actor = await applySession(session);
    if (bootstrapVersion + 1 !== actorVersion) return get(currentActor);
    const listenerVersion = actorVersion;
    let listenerActive = true;
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!listenerActive) return;
      const actor = get(currentActor);
      if (
        actor.initialized &&
        actor.session?.access_token === nextSession?.access_token &&
        actor.user?.id === nextSession?.user?.id
      ) {
        currentActor.set({ ...actor, session: nextSession });
        return;
      }
      void applySession(nextSession);
    });
    if (listenerVersion === actorVersion) {
      authSubscription = {
        unsubscribe: () => listener.subscription.unsubscribe(),
        deactivate: () => {
          listenerActive = false;
        }
      };
    } else {
      listenerActive = false;
      listener.subscription.unsubscribe();
    }
    const current = get(currentActor);
    if (
      current.session?.access_token !== session?.access_token ||
      current.user?.id !== session?.user?.id
    ) {
      return current;
    }
    return actor;
  }

  function resolveCurrentActor(): Promise<CurrentActor> {
    bootstrapPromise ??= bootstrap();
    return bootstrapPromise;
  }

  async function startCurrentActor(): Promise<() => void> {
    await resolveCurrentActor();
    return stopCurrentActor;
  }

  function stopCurrentActor(): void {
    authSubscription?.deactivate();
    authSubscription?.unsubscribe();
    authSubscription = null;
    bootstrapPromise = null;
    actorVersion++;
    currentActor.set(initialActor);
  }

  function getCurrentActor(): CurrentActor {
    return get(currentActor);
  }

  async function signInWithGithub(): Promise<void> {
    const { error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${getOrigin()}/auth/callback` }
    });
    if (error) {
      console.error('Error signing in with Github:', error);
      throw error;
    }
  }

  async function signOut(): Promise<void> {
    const { error } = await client.auth.signOut();
    if (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }

  return {
    currentActor,
    resolveCurrentActor,
    startCurrentActor,
    stopCurrentActor,
    getCurrentActor,
    signInWithGithub,
    signOut
  };
}

export const {
  currentActor,
  resolveCurrentActor,
  startCurrentActor,
  stopCurrentActor,
  getCurrentActor,
  signInWithGithub,
  signOut
} = createCurrentActor({ client: supabase });
