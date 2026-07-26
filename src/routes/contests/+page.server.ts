import { fetchContests } from '$lib/queries/contestQueries';
import type { PageServerLoad } from './$types';

type ContestsLoadEvent = {
  setHeaders: (headers: Record<string, string>) => void;
};

export function _createContestsLoad(loadContests: typeof fetchContests) {
  return async ({ setHeaders }: ContestsLoadEvent) => {
    setHeaders({ 'cache-control': 'no-store' });
    return { contests: await loadContests() };
  };
}

// Server-only load: SSR ships the initial contests in the HTML and the
// serialized data is reused on the client during hydration, so the page makes
// no duplicate contests query after hydration. The client-side fetch in
// +page.svelte remains only as a fallback/retry path.
export const load: PageServerLoad = _createContestsLoad(fetchContests);
