import { fetchContests } from '$lib/queries/contestQueries';
import type { PageServerLoad } from './$types';

// Server-only load: SSR ships the initial contests in the HTML and the
// serialized data is reused on the client during hydration, so the page makes
// no duplicate contests query after hydration. The client-side fetch in
// +page.svelte remains only as a fallback/retry path.
export const load: PageServerLoad = async () => {
  const contests = await fetchContests();
  return { contests };
};
