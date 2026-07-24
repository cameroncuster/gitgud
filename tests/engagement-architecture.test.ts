import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFile(new URL(path, root), 'utf8');

async function assertMissing(path: string) {
  await assert.rejects(access(new URL(path, root)), { code: 'ENOENT' }, path);
}

test('problem and contest shells delegate engagement ownership', async () => {
  const [problem, contest, problemTable, contestTable] = await Promise.all([
    source('src/lib/components/ProblemDisplay.svelte'),
    source('src/routes/contests/+page.svelte'),
    source('src/lib/components/ProblemTable.svelte'),
    source('src/lib/components/ContestTable.svelte')
  ]);
  assert.match(problem, /createProblemEngagementController/);
  assert.match(contest, /createContestEngagementController/);
  for (const contents of [problem, contest, problemTable, contestTable]) {
    assert.doesNotMatch(contents, /\.rpc\s*\(|\.insert\s*\(|\.delete\s*\(/);
    assert.doesNotMatch(contents, /currentActor\.subscribe|\$currentActor/);
    assert.doesNotMatch(contents, /currentFeedback|isUndo/);
    assert.doesNotMatch(
      contents,
      /likes:\s*problem\.likes\s*[+-]|dislikes:\s*problem\.dislikes\s*[+-]/
    );
  }
});

test('legacy service facades are deleted', async () => {
  await Promise.all(
    ['auth', 'leaderboard', 'problem', 'contest'].map((service) =>
      assertMissing(`src/lib/services/${service}.ts`)
    )
  );
});

test('gateway composition is the only engagement layer with direct database access', async () => {
  const paths = [
    'src/lib/problems/problemEngagementController.ts',
    'src/lib/contests/contestEngagementController.ts',
    'src/lib/engagement/reactionTransition.ts'
  ];
  for (const path of paths) {
    const contents = await source(path);
    assert.doesNotMatch(contents, /services\/database|supabase/);
  }
  assert.match(
    await source('src/lib/problems/problemEngagementGateway.supabase.ts'),
    /services\/database/
  );
  assert.match(
    await source('src/lib/contests/contestEngagementGateway.supabase.ts'),
    /services\/database/
  );
});
