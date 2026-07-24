import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmissionWorkflow, providerFromUrl } from '../src/lib/submit/workflow.ts';
import type {
  ExtractedEntry,
  ProviderAdapter,
  ProviderAdapters,
  ResolvedItem
} from '../src/lib/submit/types.ts';

const draft = {
  name: 'A',
  tags: [],
  url: 'https://example.test/a',
  solved: 0,
  dateAdded: '2026-01-01T00:00:00.000Z',
  addedBy: 'tourist',
  addedByUrl: 'https://example.test/tourist',
  likes: 0,
  dislikes: 0
};

function adapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id: 'codeforces',
    name: 'Codeforces',
    icon: '',
    placeholder: '',
    help: '',
    extract: (text) =>
      text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((url) => ({ kind: 'problem' as const, url })),
    resolve: async (entry) => ({
      valid: true,
      kind: 'problem',
      label: entry.url,
      url: entry.url,
      payload: { ...draft, url: entry.url }
    }),
    commit: async () => ({ success: true }),
    ...overrides
  };
}

function adapters(codeforces = adapter(), kattis = adapter({ id: 'kattis', name: 'Kattis' })) {
  return { codeforces, kattis } as ProviderAdapters;
}

test('initializes from a valid route provider and defaults invalid routes', () => {
  assert.equal(providerFromUrl(new URL('https://gitgud.test/submit?provider=kattis')), 'kattis');
  assert.equal(providerFromUrl(new URL('https://gitgud.test/submit?provider=unknown')), undefined);
  assert.equal(createSubmissionWorkflow(adapters(), 'kattis').getState().provider, 'kattis');
  assert.equal(createSubmissionWorkflow(adapters()).getState().provider, 'codeforces');
});

test('owns source, links, review, complete stages and derived counts', async () => {
  const workflow = createSubmissionWorkflow(adapters());
  assert.equal(workflow.getState().stage, 'source');
  workflow.setPasted('one two');
  assert.equal(workflow.getState().stage, 'links');
  await workflow.resolveEntries({ authorized: true });
  assert.equal(workflow.getState().stage, 'review');
  assert.deepEqual([workflow.getState().validCount, workflow.getState().invalidCount], [2, 0]);
  await workflow.confirmAdd();
  assert.equal(workflow.getState().stage, 'complete');
  assert.equal(workflow.getState().addedCount, 2);
  workflow.setPasted('one two');
  assert.equal(workflow.getState().stage, 'links');
  assert.equal(workflow.getState().rows.length, 0);
});

test('resolve performs zero writes and confirm writes valid rows sequentially', async () => {
  const events: string[] = [];
  const source = adapter({
    resolve: async (entry) => {
      events.push(`resolve:${entry.url}`);
      return {
        valid: entry.url !== 'bad',
        kind: 'problem',
        label: entry.url,
        url: entry.url,
        ...(entry.url === 'bad' ? { reason: 'bad' } : { payload: { ...draft, url: entry.url } })
      } as ResolvedItem;
    },
    commit: async (item) => {
      events.push(`commit:${item.url}`);
      return { success: true };
    }
  });
  const workflow = createSubmissionWorkflow(adapters(source));
  workflow.setPasted('one bad two');
  await workflow.resolveEntries({ authorized: true });
  assert.deepEqual(events, ['resolve:one', 'resolve:bad', 'resolve:two']);
  assert.deepEqual([workflow.getState().validCount, workflow.getState().invalidCount], [2, 1]);
  await workflow.confirmAdd();
  assert.deepEqual(events.slice(3), ['commit:one', 'commit:two']);
});

test('resolving and committing remain sequential with accurate flags', async () => {
  let activeResolves = 0;
  let maxResolves = 0;
  let activeCommits = 0;
  let maxCommits = 0;
  const workflow = createSubmissionWorkflow(
    adapters(
      adapter({
        resolve: async (entry) => {
          activeResolves++;
          maxResolves = Math.max(maxResolves, activeResolves);
          await Promise.resolve();
          activeResolves--;
          return {
            valid: true,
            kind: 'problem',
            label: entry.url,
            url: entry.url,
            payload: { ...draft, url: entry.url }
          };
        },
        commit: async () => {
          activeCommits++;
          maxCommits = Math.max(maxCommits, activeCommits);
          await Promise.resolve();
          activeCommits--;
          return { success: true };
        }
      })
    )
  );
  workflow.setPasted('one two');
  const resolving = workflow.resolveEntries({ authorized: true });
  assert.equal(workflow.getState().resolving, true);
  await resolving;
  assert.equal(workflow.getState().resolving, false);
  const committing = workflow.confirmAdd();
  assert.equal(workflow.getState().committing, true);
  await committing;
  assert.equal(workflow.getState().committing, false);
  assert.deepEqual([maxResolves, maxCommits], [1, 1]);
});

test('route provider sync preserves previews while user switching resets them', async () => {
  const workflow = createSubmissionWorkflow(adapters());
  workflow.setPasted('one');
  await workflow.resolveEntries({ authorized: true });
  const sequence = workflow.getState().sequence;

  workflow.syncProviderFromRoute('kattis');
  assert.equal(workflow.getState().provider, 'kattis');
  assert.equal(workflow.getState().rows.length, 1);
  assert.equal(workflow.getState().sequence, sequence);
  workflow.syncProviderFromRoute('kattis');
  assert.equal(workflow.getState().sequence, sequence);

  workflow.selectProvider('codeforces');
  assert.equal(workflow.getState().provider, 'codeforces');
  assert.equal(workflow.getState().rows.length, 0);
  workflow.setPasted('two');
  assert.equal(workflow.getState().stage, 'links');
});

test('invalid duplicate rows are excluded from writes', async () => {
  let commits = 0;
  const workflow = createSubmissionWorkflow(
    adapters(
      adapter({
        resolve: async (entry) =>
          entry.url === 'duplicate'
            ? {
                valid: false,
                kind: 'problem',
                label: entry.url,
                url: entry.url,
                reason: 'Problem already exists in database'
              }
            : {
                valid: true,
                kind: 'problem',
                label: entry.url,
                url: entry.url,
                payload: { ...draft, url: entry.url }
              },
        commit: async () => ((commits += 1), { success: true })
      })
    )
  );
  workflow.setPasted('duplicate valid');
  await workflow.resolveEntries({ authorized: true });
  await workflow.confirmAdd();
  assert.equal(commits, 1);
});

test('removal changes the commit set', async () => {
  const committed: string[] = [];
  const workflow = createSubmissionWorkflow(
    adapters(adapter({ commit: async (item) => (committed.push(item.url), { success: true }) }))
  );
  workflow.setPasted('one two');
  await workflow.resolveEntries({ authorized: true });
  workflow.removeRow(workflow.getState().rows[0].id);
  await workflow.confirmAdd();
  assert.deepEqual(committed, ['two']);
});

test('thrown adapter errors become row failures without stopping the sequence', async () => {
  const workflow = createSubmissionWorkflow(
    adapters(
      adapter({
        resolve: async (entry) => {
          if (entry.url === 'one') throw new Error('resolve exploded');
          return {
            valid: true,
            kind: 'problem',
            label: entry.url,
            url: entry.url,
            payload: { ...draft, url: entry.url }
          };
        },
        commit: async () => {
          throw new Error('commit exploded');
        }
      })
    )
  );
  workflow.setPasted('one two');
  await workflow.resolveEntries({ authorized: true });
  const failedItem = workflow.getState().rows[0].item;
  assert.equal(failedItem.valid, false);
  if (failedItem.valid) assert.fail('expected failed resolution');
  assert.match(failedItem.reason, /resolve exploded/);
  await workflow.confirmAdd();
  assert.equal(workflow.getState().committedFailures, 1);
  assert.equal(workflow.getState().rows[1].message, 'commit exploded');
});

test('stale resolve results cannot restore a reset preview', async () => {
  let release!: (item: ResolvedItem) => void;
  const pending = new Promise<ResolvedItem>((resolve) => (release = resolve));
  const workflow = createSubmissionWorkflow(adapters(adapter({ resolve: async () => pending })));
  workflow.setPasted('one');
  const resolving = workflow.resolveEntries({ authorized: true });
  workflow.setPasted('two');
  release({
    valid: true,
    kind: 'problem',
    label: 'one',
    url: 'one',
    payload: { ...draft, url: 'one' }
  });
  assert.equal(await resolving, 'stale');
  assert.equal(workflow.getState().rows.length, 0);
  assert.equal(workflow.getState().pasted, 'two');
});

test('provider switches invalidate in-flight resolution', async () => {
  let release!: (item: ResolvedItem) => void;
  const pending = new Promise<ResolvedItem>((resolve) => (release = resolve));
  const workflow = createSubmissionWorkflow(adapters(adapter({ resolve: async () => pending })));
  workflow.setPasted('one');
  const resolving = workflow.resolveEntries({ authorized: true });
  workflow.selectProvider('kattis');
  release({
    valid: true,
    kind: 'problem',
    label: 'one',
    url: 'one',
    payload: { ...draft, url: 'one' }
  });
  assert.equal(await resolving, 'stale');
  assert.equal(workflow.getState().provider, 'kattis');
  assert.equal(workflow.getState().rows.length, 0);
});

test('stale commit results cannot restore cleared rows', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  const workflow = createSubmissionWorkflow(
    adapters(
      adapter({
        commit: async () => {
          await pending;
          return { success: true };
        }
      })
    )
  );
  workflow.setPasted('one');
  await workflow.resolveEntries({ authorized: true });
  const committing = workflow.confirmAdd();
  workflow.resetPreview();
  release();
  assert.equal(await committing, 'stale');
  assert.equal(workflow.getState().rows.length, 0);
  assert.equal(workflow.getState().done, false);
});

test('clear/start-another and handle validation preserve exact messages', async () => {
  const workflow = createSubmissionWorkflow(adapters());
  workflow.setHandle('!');
  workflow.setPasted('one');
  assert.equal(await workflow.resolveEntries({ authorized: true }), 'invalid-handle');
  assert.equal(workflow.getState().inlineError, 'Invalid Codeforces handle format.');
  workflow.setHandle('valid_handle');
  workflow.setPasted('');
  assert.equal(await workflow.resolveEntries({ authorized: true }), 'no-entries');
  assert.equal(
    workflow.getState().inlineError,
    'No valid Codeforces URLs found. Enter at least one valid URL.'
  );
  workflow.setPasted('one');
  await workflow.resolveEntries({ authorized: true });
  workflow.startAnother();
  assert.equal(workflow.getState().stage, 'source');
  assert.equal(workflow.getState().pasted, '');
  assert.equal(workflow.getState().rows.length, 0);
});

test('unauthorized resolve does not call the adapter', async () => {
  let extracted = false;
  const workflow = createSubmissionWorkflow(
    adapters(adapter({ extract: (): ExtractedEntry[] => ((extracted = true), []) }))
  );
  workflow.setPasted('one');
  assert.equal(await workflow.resolveEntries({ authorized: false }), 'unauthorized');
  assert.equal(extracted, false);
});
