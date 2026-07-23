/**
 * Service for database operations related to programming contests
 */
import { supabase } from './database';
import { user } from './auth';
import { get } from 'svelte/store';

/**
 * Contest interface from our app's perspective
 */
export type Contest = {
  id?: string;
  name: string;
  url: string;
  durationSeconds: number;
  difficulty?: number;
  dateAdded: string;
  addedBy: string;
  addedByUrl: string;
  likes: number;
  dislikes: number;
  type?: string;
};

/**
 * Database record type from Supabase
 */
export type ContestRecord = Omit<
  Contest,
  'dateAdded' | 'addedBy' | 'addedByUrl' | 'durationSeconds'
> & {
  date_added: string;
  added_by: string;
  added_by_url: string;
  duration_seconds: number;
  type?: string;
};

/**
 * User participation type
 */
export type UserContestParticipation = {
  id: string;
  user_id: string;
  contest_id: string;
  participated_at: string;
};

/**
 * User feedback type
 */
export type UserContestFeedback = {
  user_id: string;
  contest_id: string;
  feedback_type: 'like' | 'dislike';
};

/**
 * Columns selected when reading contests for display. Kept explicit so we only
 * fetch what the UI needs instead of every row column.
 */
export const CONTEST_COLUMNS =
  'id, name, url, duration_seconds, difficulty, date_added, added_by, added_by_url, likes, dislikes, type';

/**
 * Maps a database contest record to the app's Contest type
 */
function mapContestRecord(record: ContestRecord): Contest {
  return {
    id: record.id,
    name: record.name,
    url: record.url,
    durationSeconds: record.duration_seconds,
    difficulty: record.difficulty,
    dateAdded: record.date_added,
    addedBy: record.added_by,
    addedByUrl: record.added_by_url,
    likes: record.likes || 0,
    dislikes: record.dislikes || 0,
    type: record.type
  };
}

/**
 * Fetches contests from the database
 * @returns Array of contests
 */
export async function fetchContests(): Promise<Contest[]> {
  try {
    const { data, error } = await supabase.from('contests').select(CONTEST_COLUMNS);

    if (error) {
      console.error('Error fetching contests:', error);
      return [];
    }

    // Transform database records to Contest type
    return (data as ContestRecord[]).map(mapContestRecord);
  } catch (err) {
    console.error('Failed to fetch contests:', err);
    return [];
  }
}

/**
 * Fetches user participation data for contests
 * @returns Set of contest IDs the user has participated in
 */
export async function fetchUserParticipation(): Promise<Set<string>> {
  const currentUser = get(user);
  if (!currentUser) {
    return new Set();
  }

  try {
    const { data, error } = await supabase
      .from('user_contest_participation')
      .select('contest_id')
      .eq('user_id', currentUser.id);

    if (error) {
      console.error('Error fetching user participation:', error);
      return new Set();
    }

    return new Set(data.map((item) => item.contest_id));
  } catch (err) {
    console.error('Failed to fetch user participation:', err);
    return new Set();
  }
}

/**
 * Toggles user participation in a contest
 * @param contestId - Contest ID
 * @param hasParticipated - Whether the user has participated
 * @returns Success status
 */
export async function toggleContestParticipation(
  contestId: string,
  hasParticipated: boolean
): Promise<boolean> {
  const currentUser = get(user);

  if (!currentUser) {
    console.error('Cannot toggle participation: User not authenticated');
    return false;
  }

  try {
    if (hasParticipated) {
      // Mark contest as participated
      const { error } = await supabase.from('user_contest_participation').insert({
        user_id: currentUser.id,
        contest_id: contestId
      });

      if (error) {
        // If the error is a duplicate key error, it means the contest is already marked as participated
        if (error.code === '23505') {
          // Postgres unique violation code
          return true; // Already participated, so consider it a success
        }
        console.error(`Error marking contest ${contestId} as participated:`, error);
        return false;
      }
    } else {
      // Mark contest as not participated (delete the record)
      const { error } = await supabase
        .from('user_contest_participation')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('contest_id', contestId);

      if (error) {
        console.error(`Error marking contest ${contestId} as not participated:`, error);
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error(`Failed to toggle participation for contest ${contestId}:`, err);
    return false;
  }
}

/**
 * Fetches user's feedback for all contests
 * @returns Record of contestId to feedback type ('like' | 'dislike' | null)
 */
export async function fetchUserFeedback(): Promise<Record<string, 'like' | 'dislike' | null>> {
  const currentUser = get(user);

  if (!currentUser) {
    return {};
  }

  try {
    const { data, error } = await supabase
      .from('user_contest_feedback')
      .select('contest_id, feedback_type')
      .eq('user_id', currentUser.id);

    if (error) {
      console.error('Error fetching user contest feedback:', error);
      return {};
    }

    const feedbackMap: Record<string, 'like' | 'dislike' | null> = {};

    data.forEach((item) => {
      feedbackMap[item.contest_id] = item.feedback_type as 'like' | 'dislike';
    });

    return feedbackMap;
  } catch (err) {
    console.error('Failed to fetch user contest feedback:', err);
    return {};
  }
}

/**
 * Updates a contest's likes or dislikes in the database
 * @param contestId - Contest ID
 * @param isLike - Whether it's a like (true) or dislike (false)
 * @param isUndo - Whether this is an undo operation
 * @param previousFeedback - The user's previous feedback (if any)
 * @returns Promise with the updated contest
 */
export async function updateContestFeedback(
  contestId: string,
  isLike: boolean,
  isUndo: boolean = false,
  previousFeedback: 'like' | 'dislike' | null = null
): Promise<Contest | null> {
  const currentUser = get(user);

  if (!currentUser) {
    console.error('Cannot update feedback: User not authenticated');
    return null;
  }

  try {
    // Call the stored procedure to handle the transaction
    const { data, error } = await supabase.rpc('update_contest_feedback', {
      p_contest_id: contestId,
      p_user_id: currentUser.id,
      p_is_like: isLike,
      p_is_undo: isUndo,
      p_previous_feedback: previousFeedback
    });

    if (error) {
      console.error(`Error updating feedback for contest ${contestId}:`, error);
      return null;
    }

    if (!data || data.length === 0) {
      console.error('No data returned from stored procedure');
      return null;
    }

    // The stored procedure returns the updated contest record
    const record = data[0] as ContestRecord;
    return {
      id: record.id,
      name: record.name,
      url: record.url,
      durationSeconds: record.duration_seconds,
      difficulty: record.difficulty,
      dateAdded: record.date_added,
      addedBy: record.added_by,
      addedByUrl: record.added_by_url,
      likes: record.likes || 0,
      dislikes: record.dislikes || 0,
      type: record.type
    };
  } catch (err) {
    console.error(`Failed to update contest ${contestId}:`, err);
    return null;
  }
}

/**
 * Format duration in seconds to a human-readable string
 * @param durationSeconds - Duration in seconds
 * @returns Formatted duration string (e.g., "2h 30m" or "45m")
 */
export function formatDuration(durationSeconds: number): string {
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  } else {
    return `${minutes}m`;
  }
}

/**
 * Extract contest information from a Codeforces URL
 * @param contestUrl - Codeforces contest URL
 * @returns Contest info or null if invalid URL
 */
export function extractCodeforcesContestInfo(contestUrl: string): {
  contestId: string;
  isGym: boolean;
  url: string;
} | null {
  // First normalize the URL to remove http/https/www and ensure it starts with a domain
  const normalizedUrl = contestUrl.trim();

  // Remove http/https/www if present
  const cleanUrl = normalizedUrl.replace(/^(https?:\/\/)?(www\.)?/, '');

  // Support both codeforces.com and mirror.codeforces.com
  const contestPattern = /(?:mirror\.)?codeforces\.com\/contest\/(\d+)(?!\/problem\/)/;
  const gymPattern = /(?:mirror\.)?codeforces\.com\/gym\/(\d+)(?!\/problem\/)/;

  const contestMatch = cleanUrl.match(contestPattern);
  const gymMatch = cleanUrl.match(gymPattern);

  // Use whichever pattern matched
  if (contestMatch) {
    return {
      contestId: contestMatch[1],
      isGym: false,
      url: `https://codeforces.com/contest/${contestMatch[1]}`
    };
  }

  if (gymMatch) {
    return {
      contestId: gymMatch[1],
      isGym: true,
      url: `https://codeforces.com/gym/${gymMatch[1]}`
    };
  }

  return null;
}

/**
 * Fetch contest data from Codeforces API
 * @param contestInfo - Contest information
 * @param submitterHandle - Handle of the person submitting the contest
 * @returns Contest data
 */
export async function fetchCodeforcesContestData(
  contestInfo: {
    contestId: string;
    isGym: boolean;
    url: string;
  },
  submitterHandle: string = 'tourist'
): Promise<{
  success: boolean;
  message?: string;
  contest?: Omit<Contest, 'id' | 'dateAdded'>;
}> {
  try {
    // Check if contest already exists in our database by URL
    const { data: existingContests, error: checkError } = await supabase
      .from('contests')
      .select('id')
      .eq('url', contestInfo.url);

    if (checkError) {
      return {
        success: false,
        message: `Error checking if contest exists: ${checkError.message}`
      };
    }

    if (existingContests && existingContests.length > 0) {
      return {
        success: false,
        message: 'Contest already exists in database'
      };
    }

    // Define the interface for Codeforces contest data
    interface CodeforcesContest {
      id: number;
      name: string;
      type: string;
      phase: string;
      frozen: boolean;
      durationSeconds: number;
      startTimeSeconds?: number;
      relativeTimeSeconds?: number;
      preparedBy?: string;
      websiteUrl?: string;
      description?: string;
      difficulty?: number;
      kind?: string;
      icpcRegion?: string;
      country?: string;
      city?: string;
      season?: string;
    }

    // Fetch contest data from Codeforces API
    const apiUrl = contestInfo.isGym
      ? `https://codeforces.com/api/contest.standings?contestId=${contestInfo.contestId}&from=1&count=1&gym=true`
      : `https://codeforces.com/api/contest.list?gym=false`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.status !== 'OK') {
      throw new Error('Failed to fetch contest data from Codeforces API');
    }

    let contestData: CodeforcesContest | null = null;

    if (contestInfo.isGym) {
      // For gym contests, the data is in the contest field
      contestData = data.result.contest;
    } else {
      // For regular contests, we need to find the contest in the list
      contestData = data.result.find(
        (c: CodeforcesContest) => c.id.toString() === contestInfo.contestId
      );
    }

    if (!contestData) {
      throw new Error('Contest not found in Codeforces API response');
    }

    // Determine contest type
    let contestType = 'Codeforces';
    if (contestInfo.isGym) {
      contestType = 'ICPC'; // Default for gym contests
      // Try to extract more specific type from name or kind
      if (contestData.kind && contestData.kind.includes('ICPC')) {
        contestType = 'ICPC';
      }
    } else if (
      contestData.name.includes('ICPC') ||
      (contestData.kind && contestData.kind.includes('ICPC'))
    ) {
      contestType = 'ICPC';
    }

    return {
      success: true,
      contest: {
        name: contestData.name,
        url: contestInfo.url,
        durationSeconds: contestData.durationSeconds,
        difficulty: contestData.difficulty,
        addedBy: submitterHandle || 'tourist',
        addedByUrl: submitterHandle
          ? `https://codeforces.com/profile/${submitterHandle}`
          : 'https://codeforces.com/profile/tourist',
        likes: 0,
        dislikes: 0,
        type: contestType
      }
    };
  } catch (err) {
    console.error('Error fetching contest data:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Insert a contest into the database
 * @param contest - Contest data to insert
 * @returns Object with success flag and optional message
 */
export async function insertContest(contest: Omit<Contest, 'id' | 'dateAdded'>): Promise<{
  success: boolean;
  message?: string;
  id?: string;
}> {
  try {
    // Map camelCase field names to snake_case column names
    const dbContest = {
      name: contest.name,
      url: contest.url,
      type: contest.type,
      duration_seconds: contest.durationSeconds,
      added_by: contest.addedBy,
      added_by_url: contest.addedByUrl,
      likes: contest.likes,
      dislikes: contest.dislikes
    };

    // Create a properly typed object with optional fields
    interface DbContest {
      name: string;
      url: string;
      type: string | undefined;
      duration_seconds: number;
      added_by: string;
      added_by_url: string;
      likes: number;
      dislikes: number;
      difficulty?: number;
    }

    // Add difficulty only if defined
    const dbContestWithOptionals: DbContest = dbContest as DbContest;
    if (contest.difficulty !== undefined) {
      dbContestWithOptionals.difficulty = contest.difficulty;
    }

    // Check if the contest already exists by URL
    const { data: existingContests, error: checkError } = await supabase
      .from('contests')
      .select('id')
      .eq('url', contest.url);

    if (checkError) {
      return {
        success: false,
        message: `Error checking if contest exists: ${checkError.message}`
      };
    }

    if (existingContests && existingContests.length > 0) {
      return {
        success: false,
        message: 'Contest already exists in database'
      };
    }

    // Insert the contest
    const { data, error } = await supabase
      .from('contests')
      .insert(dbContestWithOptionals)
      .select('id')
      .single();

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
    console.error('Error inserting contest:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Unknown error inserting contest'
    };
  }
}
