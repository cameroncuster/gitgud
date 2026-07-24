import { expect, test } from '@playwright/test';
import { MEMBER_USER } from './support/constants.ts';
import { setScenario } from './support/scenario.ts';

test.beforeEach(async () => {
  await setScenario('data');
});

test('admin handler preserves authentication and authorization responses', async ({ request }) => {
  const missing = await request.post('/api/codeforces/problems', { data: { problems: [] } });
  expect(missing.status()).toBe(401);
  expect(await missing.json()).toEqual({ error: 'Authentication required' });

  const invalid = await request.post('/api/codeforces/problems', {
    headers: { Authorization: 'Bearer invalid-token' },
    data: { problems: [] }
  });
  expect(invalid.status()).toBe(401);
  expect(await invalid.json()).toEqual({ error: 'Invalid or expired session' });

  const forbidden = await request.post('/api/codeforces/problems', {
    headers: { Authorization: `Bearer ${MEMBER_USER.accessToken}` },
    data: { problems: [{ contestId: '1000', index: 'A' }] }
  });
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toEqual({ error: 'Admin privileges required' });
});

test('user handler preserves missing and invalid session responses', async ({ request }) => {
  const missing = await request.get('/api/codeforces/user-solves?handle=tourist');
  expect(missing.status()).toBe(401);
  expect(await missing.json()).toEqual({ error: 'Authentication required' });

  const invalid = await request.get('/api/codeforces/user-solves?handle=tourist', {
    headers: { Authorization: 'Bearer invalid-token' }
  });
  expect(invalid.status()).toBe(401);
  expect(await invalid.json()).toEqual({ error: 'Invalid or expired session' });
});
