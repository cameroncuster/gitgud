import { fetchLeaderboard } from '$lib/queries/leaderboardQueries';
import type { PageServerLoad } from './$types';

// Server-only load: SSR ships the initial leaderboard rows in the HTML and the
// serialized data is reused on the client during hydration, so the page makes
// no duplicate leaderboard query after hydration. The client-side fetch in
// +page.svelte remains only as a retry path (the "Try Again" button).
export const load: PageServerLoad = async () => {
  const entries = await fetchLeaderboard();
  return { entries };
};
