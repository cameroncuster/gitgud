import { getCurrentActor } from '$lib/auth/currentActor';
import { supabase } from '$lib/services/database';

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

export type ContestRecord = Omit<
  Contest,
  'dateAdded' | 'addedBy' | 'addedByUrl' | 'durationSeconds'
> & {
  date_added: string;
  added_by: string;
  added_by_url: string;
  duration_seconds: number;
};

export const CONTEST_COLUMNS = [
  'id',
  'name',
  'url',
  'duration_seconds',
  'difficulty',
  'date_added',
  'added_by',
  'added_by_url',
  'likes',
  'dislikes',
  'type'
].join(', ');

export function mapContestRecord(record: ContestRecord): Contest {
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

export async function fetchContests(): Promise<Contest[]> {
  try {
    const { data, error } = await supabase.from('contests').select(CONTEST_COLUMNS);
    if (error) {
      console.error('Error fetching contests:', error);
      return [];
    }
    return (data as unknown as ContestRecord[]).map(mapContestRecord);
  } catch (error) {
    console.error('Failed to fetch contests:', error);
    return [];
  }
}

export async function fetchContestParticipation(): Promise<Set<string>> {
  const user = getCurrentActor().user;
  if (!user) return new Set();

  try {
    const { data, error } = await supabase
      .from('user_contest_participation')
      .select('contest_id')
      .eq('user_id', user.id);
    if (error) {
      console.error('Error fetching user participation:', error);
      return new Set();
    }
    return new Set(data.map((item) => item.contest_id));
  } catch (error) {
    console.error('Failed to fetch user participation:', error);
    return new Set();
  }
}

export async function fetchContestFeedback(): Promise<Record<string, 'like' | 'dislike' | null>> {
  const user = getCurrentActor().user;
  if (!user) return {};

  try {
    const { data, error } = await supabase
      .from('user_contest_feedback')
      .select('contest_id, feedback_type')
      .eq('user_id', user.id);
    if (error) {
      console.error('Error fetching user contest feedback:', error);
      return {};
    }
    return Object.fromEntries(data.map((item) => [item.contest_id, item.feedback_type]));
  } catch (error) {
    console.error('Failed to fetch user contest feedback:', error);
    return {};
  }
}
