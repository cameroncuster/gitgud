import { fetchContests } from '$lib/services/contest';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
  const contests = await fetchContests();
  return { contests };
};
