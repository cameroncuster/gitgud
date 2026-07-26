import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _createKattisGet } from '../src/routes/api/kattis/+server.ts';

test('Kattis route aborts the upstream fetch once the timeout elapses', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handler = _createKattisGet(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener('abort', () => {
          const abort = new Error('aborted');
          abort.name = 'AbortError';
          reject(abort);
        });
      })
  );
  const pending = handler({ url: new URL('https://gitgud.test/api?url=hello') } as never);
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: 'Timed out fetching problem' });
});

test('Kattis route keeps the timeout active while reading the response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handler = _createKattisGet(async (_input, init) => {
    const signal = (init as RequestInit).signal;
    return {
      ok: true,
      text: () =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const abort = new Error('aborted body');
            abort.name = 'AbortError';
            reject(abort);
          });
        })
    } as Response;
  });

  const pending = handler({ url: new URL('https://gitgud.test/api?url=hello') } as never);
  await Promise.resolve();
  t.mock.timers.tick(10_000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: 'Timed out fetching problem' });
});
