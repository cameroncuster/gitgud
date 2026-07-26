import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  createAuthorization,
  requireUser as productionRequireUser,
  type AuthorizationResult
} from '../src/lib/server/authorization.ts';
import { createCurrentActor } from '../src/lib/auth/currentActor.ts';

type Result = { data: unknown; error: { code?: string } | null };

function authorizationClient(options: {
  user?: { id: string } | null;
  userError?: { code?: string } | null;
  role?: string | null;
  roleError?: { code?: string } | null;
}) {
  const getUser = mock.fn(async (token?: string) => {
    void token;
    return {
      data: { user: options.user ?? null },
      error: options.userError ?? null
    };
  });
  const roleResult: Result = {
    data: options.role === undefined ? null : { role: options.role },
    error: options.roleError ?? null
  };
  const client = {
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => roleResult })
      })
    })
  } as unknown as SupabaseClient;
  return { client, getUser };
}

async function responseBody(result: AuthorizationResult) {
  assert.equal(result.authorized, false);
  return result.response.json() as Promise<{ error: string }>;
}

test('requireUser rejects missing and whitespace-only bearer credentials before client creation', async () => {
  const factory = mock.fn(() => authorizationClient({}).client);
  const authorization = createAuthorization({ createSupabaseClient: factory });

  for (const header of [undefined, 'Bearer   ', 'Basic token', 'raw-token']) {
    const request = new Request('https://gitgud.test/api', {
      headers: header ? { authorization: header } : undefined
    });
    const result = await authorization.requireUser(request);
    assert.equal(result.authorized, false);
    if (!result.authorized) {
      assert.equal(result.response.status, 401);
      assert.deepEqual(await result.response.json(), { error: 'Authentication required' });
    }
  }
  assert.equal(factory.mock.callCount(), 0);
});

test('requireUser normalizes bearer scheme and binds the token to both auth layers', async () => {
  const created = authorizationClient({ user: { id: 'actor-1' } });
  const factory = mock.fn((_url: string, _key: string, options: unknown) => {
    assert.deepEqual(options, {
      global: { headers: { Authorization: 'Bearer secret-token' } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return created.client;
  });
  const { requireUser } = createAuthorization({ createSupabaseClient: factory });
  const result = await requireUser(
    new Request('https://gitgud.test/api', { headers: { authorization: 'bEaReR secret-token ' } })
  );

  assert.equal(result.authorized, true);
  if (result.authorized) {
    assert.equal(result.userId, 'actor-1');
    assert.equal(result.supabase, created.client);
  }
  assert.equal(created.getUser.mock.calls[0].arguments[0], 'secret-token');
});

test('requireUser rejects provider errors and missing users with the same safe response', async () => {
  const throwing = authorizationClient({});
  throwing.client.auth.getUser = async () => {
    throw new Error('offline');
  };
  for (const client of [
    authorizationClient({ userError: { code: 'expired' } }),
    authorizationClient({ user: null }),
    throwing
  ]) {
    const { requireUser } = createAuthorization({ createSupabaseClient: () => client.client });
    const body = await responseBody(
      await requireUser(
        new Request('https://gitgud.test/api', { headers: { authorization: 'Bearer token' } })
      )
    );
    assert.deepEqual(body, { error: 'Invalid or expired session' });
  }
});

test('requireAdmin preserves authentication denial and enforces the role lookup', async () => {
  const unauthenticated = createAuthorization({
    createSupabaseClient: () => authorizationClient({ user: null }).client
  });
  const denied = await unauthenticated.requireAdmin(
    new Request('https://gitgud.test/api', { headers: { authorization: 'Bearer bad' } })
  );
  assert.equal(denied.authorized, false);
  if (!denied.authorized) assert.equal(denied.response.status, 401);

  for (const options of [
    { user: { id: 'actor' }, role: 'member' },
    { user: { id: 'actor' }, role: 'admin', roleError: { code: 'denied' } }
  ]) {
    const authorization = createAuthorization({
      createSupabaseClient: () => authorizationClient(options).client
    });
    const result = await authorization.requireAdmin(
      new Request('https://gitgud.test/api', { headers: { authorization: 'Bearer token' } })
    );
    assert.equal(result.authorized, false);
    if (!result.authorized) {
      assert.equal(result.response.status, 403);
      assert.deepEqual(await result.response.json(), { error: 'Admin privileges required' });
    }
  }

  const throwingRole = authorizationClient({ user: { id: 'actor' } });
  throwingRole.client.from = () => {
    throw new Error('offline');
  };
  const throwingResult = await createAuthorization({
    createSupabaseClient: () => throwingRole.client
  }).requireAdmin(
    new Request('https://gitgud.test/api', { headers: { authorization: 'Bearer token' } })
  );
  assert.equal(throwingResult.authorized, false);
  if (!throwingResult.authorized) assert.equal(throwingResult.response.status, 403);

  const adminClient = authorizationClient({ user: { id: 'admin-1' }, role: 'admin' });
  const allowed = await createAuthorization({
    createSupabaseClient: () => adminClient.client
  }).requireAdmin(
    new Request('https://gitgud.test/api', { headers: { authorization: 'Bearer token' } })
  );
  assert.equal(allowed.authorized, true);
});

function session(id: string, accessToken: string): Session {
  return { user: { id }, access_token: accessToken } as unknown as Session;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function actorClient(options: {
  initial: Session | null;
  lookup?: (userId: string) => Promise<Result>;
  oauthError?: Error | null;
  signOutError?: Error | null;
}) {
  type AuthListener = (event: string, next: Session | null) => void;
  let authListener: AuthListener | undefined;
  let unsubscribed = 0;
  const getSession = mock.fn(async () => ({ data: { session: options.initial } }));
  const onAuthStateChange = mock.fn((listener: AuthListener) => {
    authListener = listener;
    return { data: { subscription: { unsubscribe: () => unsubscribed++ } } };
  });
  const signInWithOAuth = mock.fn(async (oauthOptions: unknown) => {
    void oauthOptions;
    return { error: options.oauthError ?? null };
  });
  const signOut = mock.fn(async () => ({ error: options.signOutError ?? null }));
  const client = {
    auth: { getSession, onAuthStateChange, signInWithOAuth, signOut },
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: () =>
            options.lookup?.(userId) ?? Promise.resolve({ data: null, error: null })
        })
      })
    })
  } as unknown as SupabaseClient;
  return {
    client,
    getSession,
    onAuthStateChange,
    signInWithOAuth,
    signOut,
    emit: (next: Session | null) => authListener?.('SIGNED_IN', next),
    unsubscribed: () => unsubscribed
  };
}

test('current actor bootstraps once, resolves admin state, and unsubscribes on stop', async () => {
  const fake = actorClient({
    initial: session('admin', 'token'),
    lookup: async () => ({ data: { role: 'admin' }, error: null })
  });
  const actor = createCurrentActor({ client: fake.client, getOrigin: () => 'https://gitgud.test' });

  const [first, second] = await Promise.all([
    actor.resolveCurrentActor(),
    actor.resolveCurrentActor()
  ]);
  assert.equal(first, second);
  assert.equal(first.isAdmin, true);
  assert.equal(first.adminCheckFailed, false);
  assert.equal(fake.getSession.mock.callCount(), 1);
  assert.equal(fake.onAuthStateChange.mock.callCount(), 1);

  const stop = await actor.startCurrentActor();
  stop();
  assert.equal(fake.unsubscribed(), 1);
  assert.deepEqual(actor.getCurrentActor(), {
    session: null,
    user: null,
    isAdmin: false,
    adminCheckFailed: false,
    initialized: false
  });
});

test('current actor distinguishes ordinary users from admin lookup failures', async () => {
  const ordinary = actorClient({
    initial: session('user', 'token'),
    lookup: async () => ({ data: { role: 'member' }, error: null })
  });
  const ordinaryActor = await createCurrentActor({ client: ordinary.client }).resolveCurrentActor();
  assert.equal(ordinaryActor.isAdmin, false);
  assert.equal(ordinaryActor.adminCheckFailed, false);

  for (const lookup of [
    async () => ({ data: null, error: { code: 'denied' } }),
    async () => Promise.reject(new Error('offline'))
  ]) {
    const fake = actorClient({ initial: session('user', 'token'), lookup });
    const actor = await createCurrentActor({ client: fake.client }).resolveCurrentActor();
    assert.equal(actor.isAdmin, false);
    assert.equal(actor.adminCheckFailed, true);
  }
});

test('auth changes update same-token metadata but stale admin lookups cannot overwrite logout', async () => {
  const pending = deferred<Result>();
  const fake = actorClient({ initial: null, lookup: () => pending.promise });
  const actor = createCurrentActor({ client: fake.client });
  await actor.resolveCurrentActor();

  const first = session('user', 'token');
  fake.emit(first);
  assert.equal(actor.getCurrentActor().user?.id, 'user');
  fake.emit(null);
  pending.resolve({ data: { role: 'admin' }, error: null });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(actor.getCurrentActor().user, null);
  assert.equal(actor.getCurrentActor().isAdmin, false);

  const sameToken = { ...first, expires_at: 123 } as Session;
  fake.emit(first);
  await Promise.resolve();
  fake.emit(sameToken);
  assert.equal(actor.getCurrentActor().session?.expires_at, 123);

  const reusedToken = session('different-user', 'token');
  fake.emit(reusedToken);
  assert.equal(actor.getCurrentActor().user?.id, 'different-user');
});

test('current actor stop before getSession resolves cannot resurrect state', async () => {
  const sessionLookup = deferred<{ data: { session: Session | null } }>();
  const fake = actorClient({ initial: null });
  fake.client.auth.getSession = () => sessionLookup.promise as never;
  const actor = createCurrentActor({ client: fake.client });
  const bootstrap = actor.resolveCurrentActor();
  actor.stopCurrentActor();
  sessionLookup.resolve({ data: { session: session('user', 'token') } });
  await bootstrap;
  assert.equal(actor.getCurrentActor().initialized, false);
  assert.equal(fake.onAuthStateChange.mock.callCount(), 0);
});

test('current actor stop during bootstrap prevents a leaked subscription', async () => {
  const pending = deferred<Result>();
  const fake = actorClient({ initial: session('user', 'token'), lookup: () => pending.promise });
  const actor = createCurrentActor({ client: fake.client });
  const bootstrap = actor.resolveCurrentActor();
  await Promise.resolve();
  actor.stopCurrentActor();
  pending.resolve({ data: { role: 'admin' }, error: null });
  await bootstrap;
  assert.equal(fake.unsubscribed(), 0);
  assert.equal(fake.onAuthStateChange.mock.callCount(), 0);
  assert.equal(actor.getCurrentActor().initialized, false);
});

test('current actor reboots cleanly after stop', async () => {
  const fake = actorClient({ initial: null });
  const actor = createCurrentActor({ client: fake.client });
  await actor.resolveCurrentActor();
  actor.stopCurrentActor();
  await actor.resolveCurrentActor();
  assert.equal(fake.getSession.mock.callCount(), 2);
  assert.equal(fake.onAuthStateChange.mock.callCount(), 2);
});

test('current actor contains getSession rejection and ignores a detached listener', async () => {
  const fake = actorClient({ initial: null });
  fake.client.auth.getSession = mock.fn(async () => {
    throw new Error('offline');
  });
  const rejected = createCurrentActor({ client: fake.client });
  assert.equal((await rejected.resolveCurrentActor()).initialized, true);
  assert.equal(fake.onAuthStateChange.mock.callCount(), 0);

  const listening = actorClient({ initial: null });
  const actor = createCurrentActor({ client: listening.client });
  await actor.resolveCurrentActor();
  actor.stopCurrentActor();
  listening.emit(session('stale-user', 'stale-token'));
  await Promise.resolve();
  assert.equal(actor.getCurrentActor().initialized, false);
  assert.equal(actor.getCurrentActor().user, null);
});

test('current actor discards a listener the bootstrap superseded via a synchronous auth event', async () => {
  let unsubscribed = 0;
  let deactivatedListener = false;
  const getSession = mock.fn(async () => ({ data: { session: session('user', 'token') } }));
  const onAuthStateChange = mock.fn((listener: (event: string, next: Session | null) => void) => {
    // Emit synchronously during registration so actorVersion advances before the
    // post-subscribe version check, exercising the superseded-listener branch.
    listener('SIGNED_IN', session('user', 'refreshed'));
    deactivatedListener = true;
    return { data: { subscription: { unsubscribe: () => unsubscribed++ } } };
  });
  const client = {
    auth: {
      getSession,
      onAuthStateChange,
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => ({ error: null })
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
    })
  } as unknown as SupabaseClient;

  const actor = createCurrentActor({ client });
  const resolved = await actor.resolveCurrentActor();
  assert.equal(deactivatedListener, true);
  assert.equal(unsubscribed, 1);
  assert.equal(resolved.initialized, true);
  actor.stopCurrentActor();
  assert.equal(unsubscribed, 1);
});

test('current actor default redirect uses the browser origin', async (t) => {
  const fake = actorClient({ initial: null });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://default-origin.test' } }
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  await createCurrentActor({ client: fake.client }).signInWithGithub();
  assert.deepEqual(fake.signInWithOAuth.mock.calls[0].arguments[0], {
    provider: 'github',
    options: { redirectTo: 'https://default-origin.test/auth/callback' }
  });
});

test('oauth and sign-out preserve redirects and surface provider failures', async () => {
  const success = actorClient({ initial: null });
  const actor = createCurrentActor({ client: success.client, getOrigin: () => 'https://app.test' });
  await actor.signInWithGithub();
  assert.deepEqual(success.signInWithOAuth.mock.calls[0].arguments[0], {
    provider: 'github',
    options: { redirectTo: 'https://app.test/auth/callback' }
  });
  await actor.signOut();

  const oauthError = new Error('oauth failed');
  const logoutError = new Error('logout failed');
  const failed = createCurrentActor({
    client: actorClient({ initial: null, oauthError, signOutError: logoutError }).client,
    getOrigin: () => 'https://app.test'
  });
  await assert.rejects(() => failed.signInWithGithub(), oauthError);
  await assert.rejects(() => failed.signOut(), logoutError);
});

test('the production requireUser wiring builds a real client and fails closed', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'invalid token' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })) as typeof fetch;
  const result = await productionRequireUser(
    new Request('https://gitgud.test/api', { headers: { authorization: 'Bearer tok' } })
  );
  assert.equal(result.authorized, false);
  if (!result.authorized) assert.equal(result.response.status, 401);
});
