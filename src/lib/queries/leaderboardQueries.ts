import { supabase } from '$lib/services/database';

export type LeaderboardEntry = {
  userId: string;
  username: string;
  avatarUrl: string;
  githubUrl: string;
  problemsSolved: number;
  earliestSolvesSum: number;
  rank: number;
};

type LeaderboardRecord = {
  user_id: string;
  username: string;
  avatar_url: string;
  github_url: string;
  problems_solved: number;
  earliest_solves_sum: number;
  rank: number;
};

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const { data, error } = await supabase.rpc('get_leaderboard');
    if (error) {
      console.error('Error fetching leaderboard:', error);
      return [];
    }
    return (data as LeaderboardRecord[]).map((record) => ({
      userId: record.user_id,
      username: record.username,
      avatarUrl: record.avatar_url,
      githubUrl: record.github_url,
      problemsSolved: record.problems_solved,
      earliestSolvesSum: record.earliest_solves_sum,
      rank: record.rank
    }));
  } catch (error) {
    console.error('Failed to fetch leaderboard:', error);
    return [];
  }
}
