import { fetchLeaderboard } from '$lib/services/leaderboard';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
  const entries = await fetchLeaderboard();
  return { entries };
};
