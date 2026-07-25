import { fetchProblemsResult, type ProblemsQueryResult } from '$lib/queries/problemQueries';
import type { PageServerLoad } from './$types';

const PUBLIC_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const PRIVATE_CACHE = 'private, no-store';

type HomepageLoadDependencies = {
  fetchProblemsResult: () => Promise<ProblemsQueryResult>;
};

type HomepageLoadEvent = {
  setHeaders: (headers: Record<string, string>) => void;
};

export function _createHomepageLoad({ fetchProblemsResult }: HomepageLoadDependencies) {
  return async ({ setHeaders }: HomepageLoadEvent) => {
    const result = await fetchProblemsResult();
    setHeaders({ 'cache-control': result.successful ? PUBLIC_CACHE : PRIVATE_CACHE });
    return { problems: result.problems };
  };
}

// SSR data is reused during hydration, avoiding a duplicate problems request.
export const load: PageServerLoad = _createHomepageLoad({ fetchProblemsResult });
