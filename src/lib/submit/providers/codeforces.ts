import { getCurrentActor, resolveCurrentActor } from '$lib/auth/currentActor';
import {
  createCodeforcesIngestion,
  type ProblemBatchResolver,
  type ProblemResolution
} from '$lib/providers/codeforces/ingestion';
import type { ResolvedProblem } from '$lib/services/codeforcesProblemset';
import type { ProviderAdapter, SubmissionPersistence } from '$lib/submit/types';

const resolveProblemBatch: ProblemBatchResolver = async (refs) => {
  const results = new Map<string, ProblemResolution>();
  if (refs.length === 0) return results;

  await resolveCurrentActor();
  const accessToken = getCurrentActor().session?.access_token;
  if (!accessToken) {
    for (const ref of refs) {
      results.set(`${ref.contestId}:${ref.index}`, { error: 'Authentication required' });
    }
    return results;
  }

  const response = await fetch('/api/codeforces/problems', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ problems: refs })
  });

  if (!response.ok) {
    let message = `Failed to resolve problems (HTTP ${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Preserve the HTTP fallback message.
    }
    for (const ref of refs) results.set(`${ref.contestId}:${ref.index}`, { error: message });
    return results;
  }

  const body = (await response.json()) as {
    results: Array<{
      contestId: string;
      index: string;
      problem?: ResolvedProblem;
      error?: string;
    }>;
  };
  for (const result of body.results) {
    results.set(`${result.contestId}:${result.index}`, {
      problem: result.problem,
      error: result.error
    });
  }
  return results;
};

export function createCodeforcesSubmitAdapter(persistence: SubmissionPersistence): ProviderAdapter {
  const ingestion = createCodeforcesIngestion({
    checkProblem: persistence.checkEquivalentProblemUrls,
    checkContest: persistence.checkContest,
    resolveProblemBatch
  });

  return {
    id: 'codeforces',
    name: 'Codeforces',
    icon: '/images/codeforces.png',
    placeholder:
      'https://codeforces.com/contest/1234/problem/A\n' +
      'https://codeforces.com/problemset/problem/1234/A\n' +
      'https://codeforces.com/gym/104427/problem/A\n' +
      'https://codeforces.com/contest/1234',
    help: 'Paste Codeforces problem or contest URLs. Problems and contests can be mixed; separate entries with spaces or new lines.',
    extract: ingestion.extract,
    resolve: ingestion.resolve,
    commit: (item) =>
      item.kind === 'contest'
        ? persistence.insertContest(item.payload)
        : persistence.insertProblem(item.payload)
  };
}
