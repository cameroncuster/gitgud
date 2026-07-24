import { supabase } from '$lib/services/database';
import { getCurrentActor } from '$lib/auth/currentActor';
import { getProblemSource } from '$lib/services/problemSource';

export type Problem = {
  id?: string;
  name: string;
  tags: string[];
  difficulty?: number;
  url: string;
  solved: number;
  dateAdded: string;
  addedBy: string;
  addedByUrl: string;
  likes: number;
  dislikes: number;
  source: 'codeforces' | 'kattis';
  type?: string;
};

export type ProblemRecord = Omit<Problem, 'dateAdded' | 'addedBy' | 'addedByUrl' | 'source'> & {
  date_added: string;
  added_by: string;
  added_by_url: string;
};

export const PROBLEM_COLUMNS = [
  'id',
  'name',
  'tags',
  'difficulty',
  'url',
  'solved',
  'date_added',
  'added_by',
  'added_by_url',
  'likes',
  'dislikes',
  'type'
].join(', ');

export function mapProblemRecord(record: ProblemRecord): Problem {
  return {
    id: record.id,
    name: record.name,
    tags: record.tags || [],
    difficulty: record.difficulty,
    url: record.url,
    solved: record.solved || 0,
    dateAdded: record.date_added,
    addedBy: record.added_by,
    addedByUrl: record.added_by_url,
    likes: record.likes || 0,
    dislikes: record.dislikes || 0,
    source: getProblemSource(record.url),
    type: record.type
  };
}

export async function fetchProblems(): Promise<Problem[]> {
  try {
    const { data, error } = await supabase.from('problems').select(PROBLEM_COLUMNS);
    if (error) {
      console.error('Error fetching problems:', error);
      return [];
    }
    return (data as unknown as ProblemRecord[]).map(mapProblemRecord);
  } catch (error) {
    console.error('Failed to fetch problems:', error);
    return [];
  }
}

export async function fetchProblemById(problemId: string): Promise<Problem | undefined> {
  try {
    const { data, error } = await supabase
      .from('problems')
      .select('*')
      .eq('id', problemId)
      .single();
    if (error) {
      console.error(`Error fetching problem ${problemId}:`, error);
      return undefined;
    }
    return data ? mapProblemRecord(data as ProblemRecord) : undefined;
  } catch (error) {
    console.error(`Failed to fetch problem ${problemId}:`, error);
    return undefined;
  }
}

export async function fetchProblemFeedback(): Promise<Record<string, 'like' | 'dislike' | null>> {
  const user = getCurrentActor().user;
  if (!user) return {};

  try {
    const { data, error } = await supabase
      .from('user_problem_feedback')
      .select('problem_id, feedback_type')
      .eq('user_id', user.id);
    if (error) {
      console.error('Error fetching user feedback:', error);
      return {};
    }
    return Object.fromEntries(data.map((item) => [item.problem_id, item.feedback_type]));
  } catch (error) {
    console.error('Failed to fetch user feedback:', error);
    return {};
  }
}

export async function fetchSolvedProblems(): Promise<Set<string>> {
  const user = getCurrentActor().user;
  if (!user) return new Set();

  try {
    const { data, error } = await supabase
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

export async function fetchSolvedProblemsForUser(userId: string): Promise<Set<string>> {
  if (!userId) return new Set();

  try {
    const { data, error } = await supabase.rpc('get_user_solved_problems', {
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
