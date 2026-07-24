import { createKattisIngestion } from '$lib/providers/kattis/ingestion';
import type { ProviderAdapter, SubmissionPersistence } from '$lib/submit/types';

async function fetchKattisPage(url: string): Promise<string> {
  const response = await fetch(`/api/kattis?url=${encodeURIComponent(url)}`);
  const data = (await response.json()) as { html?: string; error?: string };
  if (!response.ok) throw new Error(data.error || 'Failed to fetch problem');
  return data.html ?? '';
}

export function createKattisSubmitAdapter(persistence: SubmissionPersistence): ProviderAdapter {
  const ingestion = createKattisIngestion({
    checkProblem: async (url) => persistence.checkEquivalentProblemUrls(url),
    fetchPage: fetchKattisPage
  });

  return {
    id: 'kattis',
    name: 'Kattis',
    icon: '/images/kattis.png',
    placeholder:
      'open.kattis.com/problems/hello\nopen.kattis.com/problems/twostones\ncustomscontrols',
    help: 'Paste Kattis problem URLs or bare problem IDs. Separate entries with spaces or new lines.',
    extract: ingestion.extract,
    resolve: ingestion.resolve,
    commit: (item) =>
      item.kind === 'problem'
        ? persistence.insertProblem(item.payload)
        : Promise.resolve({ success: false, message: 'Failed to add entry' })
  };
}
