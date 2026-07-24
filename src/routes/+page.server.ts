import { fetchProblems } from '$lib/queries/problemQueries';
import type { PageServerLoad } from './$types';

// Server-only load: SSR ships the initial problems in the HTML and the
// serialized data is reused on the client during hydration, so the homepage
// makes no duplicate /rest/v1/problems request after hydration.
export const load: PageServerLoad = async () => {
  const problems = await fetchProblems();
  return { problems };
};
