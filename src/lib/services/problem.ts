/**
 * Service for database operations related to programming problems
 */
import { supabase } from './database';
import { user } from './auth';
import { get } from 'svelte/store';

/**
 * Problem interface from our app's perspective
 */
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

/**
 * Database record type from Supabase
 */
export type ProblemRecord = Omit<Problem, 'dateAdded' | 'addedBy' | 'addedByUrl' | 'source'> & {
  date_added: string;
  added_by: string;
  added_by_url: string;
};

/**
 * User feedback type
 */
export type UserFeedback = {
  user_id: string;
  problem_id: string;
  feedback_type: 'like' | 'dislike';
};

/**
 * User solved problem type
 */
export type UserSolvedProblem = {
  id: string;
  user_id: string;
  problem_id: string;
  solved_at: string;
};

/**
 * Determine the problem source based on URL
 */
export function getProblemSource(url: string): 'codeforces' | 'kattis' {
  return url.includes('kattis.com') ? 'kattis' : 'codeforces';
}

/**
 * Columns selected when reading problems for display. Kept explicit so we only
 * fetch what the UI needs instead of every row column.
 */
export const PROBLEM_COLUMNS =
  'id, name, tags, difficulty, url, solved, date_added, added_by, added_by_url, likes, dislikes, type';

/**
 * Maps a database problem record to the app's Problem type
 */
function mapProblemRecord(record: ProblemRecord): Problem {
  return {
    id: record.id,
    name: record.name,
    tags: record.tags,
    difficulty: record.difficulty,
    url: record.url,
    solved: record.solved || 0,
    dateAdded: record.date_added,
    addedBy: record.added_by,
    addedByUrl: record.added_by_url,
    likes: record.likes,
    dislikes: record.dislikes,
    source: getProblemSource(record.url),
    type: record.type
  };
}

/**
 * Check if a problem already exists in the database
 * @param url - Problem URL
 * @returns Object with success flag and optional message
 */
export async function checkProblemExists(url: string): Promise<{
  exists: boolean;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.from('problems').select('id').eq('url', url);

    if (error) {
      return {
        exists: false,
        error: `Database query error: ${error.message}`
      };
    }

    return {
      exists: data && data.length > 0
    };
  } catch (err) {
    console.error('Error checking if problem exists:', err);
    return {
      exists: false,
      error: err instanceof Error ? err.message : 'Unknown error checking problem existence'
    };
  }
}

/**
 * Insert a problem into the database
 * @param problem - Problem data to insert
 * @returns Object with success flag and optional message
 */
export async function insertProblem(problem: Omit<Problem, 'source'>): Promise<{
  success: boolean;
  message?: string;
  id?: string;
}> {
  try {
    // Map camelCase field names to snake_case column names
    // Omit the id field to let the database generate a UUID
    const dbProblem: ProblemRecord = {
      name: problem.name,
      tags: problem.tags,
      url: problem.url,
      solved: problem.solved,
      date_added: problem.dateAdded,
      added_by: problem.addedBy,
      added_by_url: problem.addedByUrl,
      likes: problem.likes,
      dislikes: problem.dislikes,
      type: problem.type
    };

    // Add difficulty only if defined
    if (problem.difficulty !== undefined) {
      dbProblem.difficulty = problem.difficulty;
    }

    // First check if the problem already exists by URL
    const { exists, error: checkError } = await checkProblemExists(problem.url);

    if (checkError) {
      return {
        success: false,
        message: `Error checking if problem exists: ${checkError}`
      };
    }

    if (exists) {
      return {
        success: false,
        message: 'Problem already exists in database'
      };
    }

    // Insert the problem
    const { data, error } = await supabase.from('problems').insert(dbProblem).select('id').single();

    if (error) {
      return {
        success: false,
        message: `Database error: ${error.message}`
      };
    }

    return {
      success: true,
      id: data?.id
    };
  } catch (err) {
    console.error('Error inserting problem:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Unknown error inserting problem'
    };
  }
}

/**
 * Fetches problems from the database
 * @returns Array of problems
 */
export async function fetchProblems(): Promise<Problem[]> {
  try {
    const { data, error } = await supabase.from('problems').select(PROBLEM_COLUMNS);

    if (error) {
      console.error('Error fetching problems:', error);
      return [];
    }

    // Transform database records to Problem type
    return (data as ProblemRecord[]).map(mapProblemRecord);
  } catch (err) {
    console.error('Failed to fetch problems:', err);
    return [];
  }
}

/**
 * Fetches user's feedback for all problems
 * @returns Record of problemId to feedback type ('like' | 'dislike' | null)
 */
export async function fetchUserFeedback(): Promise<Record<string, 'like' | 'dislike' | null>> {
  const currentUser = get(user);

  if (!currentUser) {
    return {};
  }

  try {
    const { data, error } = await supabase
      .from('user_problem_feedback')
      .select('problem_id, feedback_type')
      .eq('user_id', currentUser.id);

    if (error) {
      console.error('Error fetching user feedback:', error);
      return {};
    }

    const feedbackMap: Record<string, 'like' | 'dislike' | null> = {};

    data.forEach((item) => {
      feedbackMap[item.problem_id] = item.feedback_type as 'like' | 'dislike';
    });

    return feedbackMap;
  } catch (err) {
    console.error('Failed to fetch user feedback:', err);
    return {};
  }
}

/**
 * Fetches user's solved problems
 * @returns Set of solved problem IDs
 */
export async function fetchUserSolvedProblems(): Promise<Set<string>> {
  const currentUser = get(user);

  if (!currentUser) {
    return new Set();
  }

  try {
    const { data, error } = await supabase
      .from('user_solved_problems')
      .select('problem_id')
      .eq('user_id', currentUser.id);

    if (error) {
      console.error('Error fetching user solved problems:', error);
      return new Set();
    }

    return new Set(data.map((item) => item.problem_id));
  } catch (err) {
    console.error('Failed to fetch user solved problems:', err);
    return new Set();
  }
}

/**
 * Fetches solved problems for a specific user
 * @param userId - User ID to fetch solved problems for
 * @returns Set of solved problem IDs
 */
export async function fetchUserSolvedProblemsByUserId(userId: string): Promise<Set<string>> {
  if (!userId) {
    return new Set();
  }

  try {
    // Use the RPC function to get solved problems for a user who isn't hidden from the leaderboard
    const { data, error } = await supabase.rpc('get_user_solved_problems', {
      p_user_id: userId
    });

    if (error) {
      console.error(`Error fetching solved problems for user ${userId}:`, error);
      return new Set();
    }

    return new Set(data.map((item: { problem_id: string }) => item.problem_id));
  } catch (err) {
    console.error(`Failed to fetch solved problems for user ${userId}:`, err);
    return new Set();
  }
}

/**
 * Marks a problem as solved or unsolved by the current user
 * @param problemId - Problem ID
 * @param isSolved - Whether to mark as solved (true) or unsolved (false)
 * @returns Promise with success flag
 */
export async function toggleProblemSolved(problemId: string, isSolved: boolean): Promise<boolean> {
  const currentUser = get(user);

  if (!currentUser) {
    console.error('Cannot update solved status: User not authenticated');
    return false;
  }

  try {
    if (isSolved) {
      // Mark problem as solved
      const { error } = await supabase.from('user_solved_problems').insert({
        user_id: currentUser.id,
        problem_id: problemId
      });

      if (error) {
        // If the error is a duplicate key error, it means the problem is already marked as solved
        if (error.code === '23505') {
          // Postgres unique violation code
          return true; // Already solved, so consider it a success
        }
        console.error(`Error marking problem ${problemId} as solved:`, error);
        return false;
      }
    } else {
      // Mark problem as unsolved (delete the record)
      const { error } = await supabase
        .from('user_solved_problems')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('problem_id', problemId);

      if (error) {
        console.error(`Error marking problem ${problemId} as unsolved:`, error);
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error(`Failed to update solved status for problem ${problemId}:`, err);
    return false;
  }
}

/**
 * Updates the current user's like/dislike for a problem.
 *
 * The server derives the user's identity from the authenticated session and
 * reads the actual current feedback to decide between new/switch/undo, so the
 * client only needs to send the target problem and the requested reaction.
 * @param problemId - Problem ID
 * @param isLike - Whether it's a like (true) or dislike (false)
 * @returns Promise with the updated problem
 */
export async function updateProblemFeedback(
  problemId: string,
  isLike: boolean
): Promise<Problem | null> {
  const currentUser = get(user);

  if (!currentUser) {
    console.error('Cannot update feedback: User not authenticated');
    return null;
  }

  try {
    // Call the stored procedure to handle the transaction
    const { data, error } = await supabase.rpc('update_problem_feedback', {
      p_problem_id: problemId,
      p_is_like: isLike
    });

    if (error) {
      console.error(`Error updating feedback for problem ${problemId}:`, error);
      return null;
    }

    if (!data || data.length === 0) {
      console.error('No data returned from stored procedure');
      return null;
    }

    // The stored procedure returns the updated problem record
    const record = data[0] as ProblemRecord;
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
  } catch (err) {
    console.error(`Failed to update problem ${problemId}:`, err);
    return null;
  }
}

/**
 * Fetches a specific problem by ID
 * @param problemId - Problem ID
 * @returns Promise with problem details
 */
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

    if (!data) return undefined;

    const record = data as ProblemRecord;
    return {
      id: record.id,
      name: record.name,
      tags: record.tags,
      difficulty: record.difficulty,
      url: record.url,
      solved: record.solved || 0,
      dateAdded: record.date_added,
      addedBy: record.added_by,
      addedByUrl: record.added_by_url,
      likes: record.likes,
      dislikes: record.dislikes,
      source: getProblemSource(record.url),
      type: record.type
    };
  } catch (err) {
    console.error(`Failed to fetch problem ${problemId}:`, err);
    return undefined;
  }
}
