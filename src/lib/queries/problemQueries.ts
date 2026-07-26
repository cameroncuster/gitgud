import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '$lib/services/database';
import { getCurrentActor } from '$lib/auth/currentActor';
import { getProblemSource } from '$lib/services/problemSource';
import type { Database } from '$lib/types/database';

export type Problem = {
  id?: string;
  name: string;
  difficulty?: number;
  url: string;
  addedBy: string;
  addedByUrl: string;
  likes: number;
  dislikes: number;
  source: 'codeforces' | 'kattis';
  type?: string;
};

export type ProblemRecord = {
  id?: string;
  name: string;
  difficulty: number | null;
  url: string;
  added_by: string;
  added_by_url: string;
  likes: number;
  dislikes: number;
  type: string | null;
};

export type ProblemsQueryResult =
  { successful: true; problems: Problem[] } | { successful: false; problems: [] };

export const PROBLEM_COLUMNS = [
  'id',
  'name',
  'difficulty',
  'url',
  'added_by',
  'added_by_url',
  'likes',
  'dislikes',
  'type'
].join(', ');

export function mapProblemRecord(
  record: ProblemRecord,
  resolveProblemSource: typeof getProblemSource = getProblemSource
): Problem {
  return {
    id: record.id,
    name: record.name,
    difficulty: record.difficulty ?? undefined,
    url: record.url,
    addedBy: record.added_by,
    addedByUrl: record.added_by_url,
    likes: record.likes || 0,
    dislikes: record.dislikes || 0,
    source: resolveProblemSource(record.url),
    type: record.type ?? undefined
  };
}

type ProblemQueryDependencies = {
  client: SupabaseClient<Database>;
  getCurrentUser: () => { id: string } | null;
  resolveProblemSource: typeof getProblemSource;
};

export function createProblemQueries({
  client,
  getCurrentUser,
  resolveProblemSource
}: ProblemQueryDependencies) {
  const mapRecord = (record: ProblemRecord): Problem =>
    mapProblemRecord(record, resolveProblemSource);

  async function fetchProblemsResult(): Promise<ProblemsQueryResult> {
    try {
      const { data, error } = await client.from('problems').select(PROBLEM_COLUMNS);
      if (error) {
        console.error('Error fetching problems:', error);
        return { successful: false, problems: [] };
      }
      return {
        successful: true,
        problems: (data as unknown as ProblemRecord[]).map(mapRecord)
      };
    } catch (error) {
      console.error('Failed to fetch problems:', error);
      return { successful: false, problems: [] };
    }
  }

  async function fetchProblems(): Promise<Problem[]> {
    return (await fetchProblemsResult()).problems;
  }

  async function fetchProblemById(problemId: string): Promise<Problem | undefined> {
    try {
      const { data, error } = await client
        .from('problems')
        .select(PROBLEM_COLUMNS)
        .eq('id', problemId)
        .single();
      if (error) {
        console.error(`Error fetching problem ${problemId}:`, error);
        return undefined;
      }
      return data ? mapRecord(data as unknown as ProblemRecord) : undefined;
    } catch (error) {
      console.error(`Failed to fetch problem ${problemId}:`, error);
      return undefined;
    }
  }

  async function fetchProblemFeedback(): Promise<Record<string, 'like' | 'dislike' | null>> {
    const user = getCurrentUser();
    if (!user) return {};

    try {
      const { data, error } = await client
        .from('user_problem_feedback')
        .select('problem_id, feedback_type')
        .eq('user_id', user.id);
      if (error) {
        console.error('Error fetching user feedback:', error);
        throw new Error('Failed to load problem feedback');
      }
      return Object.fromEntries(
        data.map((item) => [item.problem_id, item.feedback_type as 'like' | 'dislike' | null])
      );
    } catch (error) {
      console.error('Failed to fetch user feedback:', error);
      throw error;
    }
  }

  async function fetchSolvedProblems(): Promise<Set<string>> {
    const user = getCurrentUser();
    if (!user) return new Set();

    try {
      const { data, error } = await client
        .from('user_solved_problems')
        .select('problem_id')
        .eq('user_id', user.id);
      if (error) {
        console.error('Error fetching user solved problems:', error);
        return new Set();
      }
      return new Set(data.map((item) => item.problem_id));
    } catch (error) {
      console.error('Failed to fetch user solved problems:', error);
      return new Set();
    }
  }

  async function fetchSolvedProblemsForUser(userId: string): Promise<Set<string>> {
    if (!userId) return new Set();

    try {
      const { data, error } = await client.rpc('get_user_solved_problems', {
        p_user_id: userId
      });
      if (error) {
        console.error(`Error fetching solved problems for user ${userId}:`, error);
        return new Set();
      }
      return new Set(data.map((item: { problem_id: string }) => item.problem_id));
    } catch (error) {
      console.error(`Failed to fetch solved problems for user ${userId}:`, error);
      return new Set();
    }
  }

  return {
    fetchProblems,
    fetchProblemsResult,
    fetchProblemById,
    fetchProblemFeedback,
    fetchSolvedProblems,
    fetchSolvedProblemsForUser
  };
}

export const {
  fetchProblems,
  fetchProblemsResult,
  fetchProblemById,
  fetchProblemFeedback,
  fetchSolvedProblems,
  fetchSolvedProblemsForUser
} = createProblemQueries({
  client: supabase,
  getCurrentUser: () => getCurrentActor().user,
  resolveProblemSource: getProblemSource
});
