import type {
  CommitResult,
  ContestDraft,
  DuplicateCheckResult,
  ProblemDraft,
  SubmissionPersistence
} from './types.ts';

type DatabaseError = { message: string };
type IdRow = { id?: string };
type QueryResult<T> = { data: T; error: DatabaseError | null };

type DuplicateQuery = {
  eq: (column: 'url', value: string) => Promise<QueryResult<IdRow[] | null>>;
};

type InsertQuery = {
  select: (column: 'id') => {
    single: () => Promise<QueryResult<IdRow | null>>;
  };
};

type SubmissionTable = {
  select: (column: 'id') => DuplicateQuery;
  insert: (draft: ProblemInsert | ContestInsert) => InsertQuery;
};

export type SubmissionClient = {
  from: (table: 'problems' | 'contests') => SubmissionTable;
};

type ProblemInsert = {
  name: string;
  tags: string[];
  difficulty?: number;
  url: string;
  solved: number;
  date_added: string;
  added_by: string;
  added_by_url: string;
  likes: number;
  dislikes: number;
  type?: string;
};

type ContestInsert = {
  name: string;
  url: string;
  type?: string;
  duration_seconds: number;
  difficulty?: number;
  added_by: string;
  added_by_url: string;
  likes: number;
  dislikes: number;
};

export function createSubmissionPersistence(client: SubmissionClient): SubmissionPersistence {
  async function queryProblem(url: string): Promise<{ exists: boolean; error?: string }> {
    try {
      const { data, error } = await client.from('problems').select('id').eq('url', url);
      if (error) return { exists: false, error: `Database query error: ${error.message}` };
      return { exists: Boolean(data && data.length > 0) };
    } catch (error) {
      console.error('Error checking if problem exists:', error);
      return {
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error checking problem existence'
      };
    }
  }

  async function checkEquivalentProblemUrls(
    canonicalUrl: string,
    alternateUrls: readonly string[] = []
  ): Promise<DuplicateCheckResult> {
    const canonical = await queryProblem(canonicalUrl);
    if (canonical.error)
      return { duplicate: false, error: canonical.error, message: canonical.error };
    if (canonical.exists) {
      return { duplicate: true, message: 'Problem already exists in database' };
    }

    for (const alternateUrl of alternateUrls) {
      if (alternateUrl === canonicalUrl) continue;
      const alternate = await queryProblem(alternateUrl);
      if (alternate.exists) {
        return {
          duplicate: true,
          message: 'Problem already exists in database (with alternate URL)'
        };
      }
    }
    return { duplicate: false };
  }

  async function checkContest(url: string): Promise<DuplicateCheckResult> {
    try {
      const { data, error } = await client.from('contests').select('id').eq('url', url);
      if (error) {
        const message = `Error checking if contest exists: ${error.message}`;
        return { duplicate: false, error: message, message };
      }
      if (data && data.length > 0) {
        return { duplicate: true, message: 'Contest already exists in database' };
      }
      return { duplicate: false };
    } catch (error) {
      console.error('Error checking if contest exists:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { duplicate: false, error: message, message };
    }
  }

  async function insertProblem(problem: ProblemDraft): Promise<CommitResult> {
    try {
      const duplicate = await checkEquivalentProblemUrls(problem.url);
      if (duplicate.error) {
        return {
          success: false,
          message: `Error checking if problem exists: ${duplicate.error}`
        };
      }
      if (duplicate.duplicate) return { success: false, message: duplicate.message };

      const draft: ProblemInsert = {
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
      if (problem.difficulty !== undefined) draft.difficulty = problem.difficulty;

      const { data, error } = await client.from('problems').insert(draft).select('id').single();
      if (error) return { success: false, message: `Database error: ${error.message}` };
      return { success: true, id: data?.id };
    } catch (error) {
      console.error('Error inserting problem:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error inserting problem'
      };
    }
  }

  async function insertContest(contest: ContestDraft): Promise<CommitResult> {
    try {
      const duplicate = await checkContest(contest.url);
      if (duplicate.error || duplicate.duplicate) {
        return { success: false, message: duplicate.message };
      }

      const draft: ContestInsert = {
        name: contest.name,
        url: contest.url,
        type: contest.type,
        duration_seconds: contest.durationSeconds,
        added_by: contest.addedBy,
        added_by_url: contest.addedByUrl,
        likes: contest.likes,
        dislikes: contest.dislikes
      };
      if (contest.difficulty !== undefined) draft.difficulty = contest.difficulty;

      const { data, error } = await client.from('contests').insert(draft).select('id').single();
      if (error) return { success: false, message: `Database error: ${error.message}` };
      return { success: true, id: data?.id };
    } catch (error) {
      console.error('Error inserting contest:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error inserting contest'
      };
    }
  }

  return {
    checkEquivalentProblemUrls,
    checkContest,
    insertProblem,
    insertContest
  };
}
