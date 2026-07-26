import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { _createUserSolvesGet } from '../src/routes/api/codeforces/user-solves/+server.ts';

test('user-solves route aborts the upstream fetch once the timeout elapses', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handler = _createUserSolvesGet({
    authorize: async () => ({
      authorized: true,
      userId: 'actor',
      supabase: {} as SupabaseClient
    }),
    createAnonClient: () =>
      ({
        from: () => ({ select: async () => ({ data: [], error: null }) })
      }) as unknown as SupabaseClient
  });
  const fetchFn: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      (init as RequestInit).signal?.addEventListener('abort', () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        reject(abort);
      });
    });
  const pending = handler({
    url: new URL('https://gitgud.test/api?handle=tourist'),
    request: { headers: new Headers() },
    fetch: fetchFn
  } as never);
  await Promise.resolve();
  t.mock.timers.tick(15_000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: 'Timed out fetching solves from Codeforces' });
});
