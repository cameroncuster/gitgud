import { fetchProblemsResult, type ProblemsQueryResult } from '$lib/queries/problemQueries';
import type { PageServerLoad } from './$types';

const MUTABLE_DATA_CACHE = 'no-store';

type HomepageLoadDependencies = {
  fetchProblemsResult: () => Promise<ProblemsQueryResult>;
};

type HomepageLoadEvent = {
  setHeaders: (headers: Record<string, string>) => void;
};

export function _createHomepageLoad({ fetchProblemsResult }: HomepageLoadDependencies) {
  return async ({ setHeaders }: HomepageLoadEvent) => {
    const result = await fetchProblemsResult();
    setHeaders({ 'cache-control': MUTABLE_DATA_CACHE });
    return { problems: result.problems };
  };
}

// SSR data is reused during hydration, avoiding a duplicate problems request.
export const load: PageServerLoad = _createHomepageLoad({ fetchProblemsResult });
