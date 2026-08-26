import { createDmojIngestion } from '$lib/providers/dmoj/ingestion';
import type { ProviderAdapter, SubmissionPersistence } from '$lib/submit/types';

async function fetchDmojProblem(url: string, fetchProblem: typeof fetch = fetch): Promise<unknown> {
  const response = await fetchProblem(`/api/dmoj?url=${encodeURIComponent(url)}`);
  const data = (await response.json()) as { problem?: unknown; error?: string };
  if (!response.ok) throw new Error(data.error || 'Failed to fetch problem');
  return data.problem;
}

export function createDmojSubmitAdapter(
  persistence: SubmissionPersistence,
  fetchProblem: typeof fetch = fetch
): ProviderAdapter {
  const ingestion = createDmojIngestion({
    checkProblem: async (url) => persistence.checkEquivalentProblemUrls(url),
    fetchProblem: (url) => fetchDmojProblem(url, fetchProblem)
  });

  return {
    id: 'dmoj',
    name: 'DMOJ',
    icon: '/images/dmoj.svg',
    placeholder: 'https://dmoj.ca/problem/ciw26p2\nhttps://dmoj.ca/problem/helloworld',
    help: 'Paste DMOJ problem URLs. Separate entries with spaces or new lines.',
    extract: ingestion.extract,
    resolve: ingestion.resolve,
    commit: (item) =>
      item.kind === 'problem'
        ? persistence.insertProblem(item.payload)
        : Promise.resolve({ success: false, message: 'Failed to add entry' })
  };
}
