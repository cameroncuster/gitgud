import { fetchProblems } from '$lib/services/problem';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
  const problems = await fetchProblems();
  return { problems };
};
