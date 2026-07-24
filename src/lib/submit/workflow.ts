import type {
  ExtractedEntry,
  PreviewRow,
  ProviderAdapters,
  ProviderId,
  ResolvedItem,
  SubmissionWorkflowState,
  WorkflowStage
} from './types.ts';

const HANDLE_PATTERN = /^[a-zA-Z0-9._-]{2,24}$/;

type Subscriber = (state: SubmissionWorkflowState) => void;

export type ResolveOptions = {
  authorized: boolean;
  onReviewReady?: () => void | Promise<void>;
};

export type ResolveOutcome =
  'resolved' | 'unauthorized' | 'invalid-handle' | 'no-entries' | 'stale';

export function providerFromUrl(url: URL): ProviderId | undefined {
  const provider = url.searchParams.get('provider');
  return provider === 'codeforces' || provider === 'kattis' ? provider : undefined;
}

function deriveState(
  state: Omit<
    SubmissionWorkflowState,
    'stage' | 'validCount' | 'invalidCount' | 'addedCount' | 'committedFailures'
  >
): SubmissionWorkflowState {
  const validCount = state.rows.filter((row) => row.item.valid).length;
  const stage: WorkflowStage = state.done
    ? 'complete'
    : state.rows.length > 0
      ? 'review'
      : state.pasted.trim().length > 0
        ? 'links'
        : 'source';

  return {
    ...state,
    stage,
    validCount,
    invalidCount: state.rows.length - validCount,
    addedCount: state.rows.filter((row) => row.status === 'added').length,
    committedFailures: state.rows.filter((row) => row.status === 'failed').length
  };
}

function failedResolution(entry: ExtractedEntry, error: unknown): ResolvedItem {
  return {
    valid: false,
    kind: 'problem',
    label: entry.url,
    url: entry.url,
    reason: error instanceof Error ? error.message : 'Failed to resolve URL'
  };
}

export function createSubmissionWorkflow(
  adapters: ProviderAdapters,
  initialProvider: ProviderId = 'codeforces'
) {
  let rowSequence = 0;
  let state = deriveState({
    provider: initialProvider,
    handle: '',
    pasted: '',
    rows: [],
    resolving: false,
    committing: false,
    done: false,
    inlineError: null,
    sequence: 0
  });
  const subscribers = new Set<Subscriber>();

  function publish(
    update: Partial<
      Omit<
        SubmissionWorkflowState,
        'stage' | 'validCount' | 'invalidCount' | 'addedCount' | 'committedFailures'
      >
    >
  ) {
    state = deriveState({ ...state, ...update });
    for (const subscriber of subscribers) subscriber(state);
  }

  function invalidatePreview() {
    publish({
      rows: [],
      resolving: false,
      committing: false,
      done: false,
      inlineError: null,
      sequence: state.sequence + 1
    });
  }

  function subscribe(subscriber: Subscriber) {
    subscriber(state);
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
    };
  }

  function selectProvider(provider: ProviderId) {
    if (provider === state.provider) return;
    publish({
      provider,
      rows: [],
      resolving: false,
      committing: false,
      done: false,
      inlineError: null,
      sequence: state.sequence + 1
    });
  }

  function syncProviderFromRoute(provider: ProviderId) {
    if (provider === state.provider) return;
    publish({ provider });
  }

  function setHandle(handle: string) {
    publish({ handle });
  }

  function setPasted(pasted: string) {
    const shouldReset = state.rows.length > 0 || state.done || state.resolving || state.committing;
    if (pasted === state.pasted) {
      if (shouldReset) invalidatePreview();
      return;
    }
    publish({ pasted });
    if (shouldReset) invalidatePreview();
  }

  async function resolveEntries(options: ResolveOptions): Promise<ResolveOutcome> {
    if (state.resolving || state.committing) return 'stale';
    publish({ inlineError: null });

    const adapter = adapters[state.provider];
    if (!options.authorized) return 'unauthorized';
    if (state.handle && !HANDLE_PATTERN.test(state.handle)) {
      publish({ inlineError: `Invalid ${adapter.name} handle format.` });
      return 'invalid-handle';
    }

    const entries = adapter.extract(state.pasted);
    if (entries.length === 0) {
      publish({
        inlineError: `No valid ${adapter.name} URLs found. Enter at least one valid URL.`
      });
      return 'no-entries';
    }

    const requestSequence = state.sequence + 1;
    const rows: PreviewRow[] = entries.map((entry) => ({
      id: ++rowSequence,
      status: 'staged',
      item: {
        valid: false,
        kind: 'problem',
        label: entry.url,
        url: entry.url,
        reason: 'Resolving…'
      }
    }));
    publish({
      sequence: requestSequence,
      resolving: true,
      done: false,
      rows
    });
    try {
      await options.onReviewReady?.();
      if (state.sequence !== requestSequence) return 'stale';

      for (let index = 0; index < entries.length; index++) {
        let resolved: ResolvedItem;
        try {
          resolved = await adapter.resolve(entries[index], state.handle);
        } catch (error) {
          resolved = failedResolution(entries[index], error);
        }
        if (state.sequence !== requestSequence) return 'stale';

        const rowId = rows[index].id;
        publish({
          rows: state.rows.map((row) => (row.id === rowId ? { ...row, item: resolved } : row))
        });
      }
      return 'resolved';
    } finally {
      if (state.sequence === requestSequence) publish({ resolving: false });
    }
  }

  function removeRow(id: number) {
    const rows = state.rows.filter((row) => row.id !== id);
    if (rows.length === 0) {
      invalidatePreview();
      return;
    }
    publish({ rows });
  }

  async function confirmAdd(): Promise<'complete' | 'ignored' | 'stale'> {
    if (state.committing || state.resolving || state.validCount === 0) return 'ignored';

    const requestSequence = state.sequence + 1;
    const adapter = adapters[state.provider];
    const commitRows = [...state.rows];
    publish({ sequence: requestSequence, committing: true, inlineError: null });

    try {
      for (const originalRow of commitRows) {
        if (!originalRow.item.valid) continue;
        if (state.sequence !== requestSequence) return 'stale';

        publish({
          rows: state.rows.map((row) =>
            row.id === originalRow.id ? { ...row, status: 'committing' } : row
          )
        });

        let result;
        try {
          result = await adapter.commit(originalRow.item);
        } catch (error) {
          result = {
            success: false,
            message: error instanceof Error ? error.message : 'Failed to add entry'
          };
        }
        if (state.sequence !== requestSequence) return 'stale';

        publish({
          rows: state.rows.map((row) =>
            row.id === originalRow.id
              ? {
                  ...row,
                  status: result.success ? 'added' : 'failed',
                  message: result.message
                }
              : row
          )
        });
      }
      publish({ done: true });
      return 'complete';
    } finally {
      if (state.sequence === requestSequence) publish({ committing: false });
    }
  }

  function resetPreview() {
    invalidatePreview();
  }

  function startAnother() {
    publish({ pasted: '' });
    invalidatePreview();
  }

  return {
    subscribe,
    getState: () => state,
    selectProvider,
    syncProviderFromRoute,
    setHandle,
    setPasted,
    resolveEntries,
    removeRow,
    confirmAdd,
    resetPreview,
    startAnother
  };
}

export type SubmissionWorkflow = ReturnType<typeof createSubmissionWorkflow>;
