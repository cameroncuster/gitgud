import type { Problem, ProblemRecord } from '../queries/problemQueries.ts';
import type { Reaction } from '../engagement/reactionTransition.ts';

export type ProblemFeedback = Record<string, Reaction>;

type DatabaseError = { code?: string };
type QueryResult<T> = { data: T; error: DatabaseError | null };
type DeleteQuery = PromiseLike<QueryResult<null>> & {
  eq: (column: string, value: string) => DeleteQuery;
};
type EngagementTable = {
  insert: (values: Record<string, string>) => PromiseLike<QueryResult<null>>;
  delete: () => DeleteQuery;
};

export type ProblemEngagementClient = {
  from: (table: 'user_solved_problems') => EngagementTable;
  rpc: (
    name: 'update_problem_feedback',
    parameters: { p_problem_id: string; p_is_like: boolean }
  ) => PromiseLike<QueryResult<unknown>>;
};

export type ProblemEngagementGateway = {
  loadFeedback: () => Promise<ProblemFeedback>;
  loadSolvedProblemIds: () => Promise<Set<string>>;
  updateFeedback: (problemId: string, isLike: boolean) => Promise<Problem | null>;
  setSolved: (problemId: string, isSolved: boolean) => Promise<boolean>;
};

export type CreateProblemEngagementGatewayOptions = {
  client: ProblemEngagementClient;
  getCurrentUser: () => { id: string } | null;
  loadFeedback: () => Promise<ProblemFeedback>;
  loadSolvedProblemIds: () => Promise<Set<string>>;
  mapProblemRecord: (record: ProblemRecord) => Problem;
};

export function createProblemEngagementGateway({
  client,
  getCurrentUser,
  loadFeedback,
  loadSolvedProblemIds,
  mapProblemRecord
}: CreateProblemEngagementGatewayOptions): ProblemEngagementGateway {
  async function setSolved(problemId: string, isSolved: boolean): Promise<boolean> {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      console.error('Cannot update solved status: User not authenticated');
      return false;
    }

    try {
      if (isSolved) {
        const { error } = await client.from('user_solved_problems').insert({
          user_id: currentUser.id,
          problem_id: problemId
        });
        if (error) {
          if (error.code === '23505') return true;
          console.error(`Error marking problem ${problemId} as solved:`, error);
          return false;
        }
      } else {
        const { error } = await client
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
    } catch (error) {
      console.error(`Failed to update solved status for problem ${problemId}:`, error);
      return false;
    }
  }

  async function updateFeedback(problemId: string, isLike: boolean): Promise<Problem | null> {
    if (!getCurrentUser()) {
      console.error('Cannot update feedback: User not authenticated');
      return null;
    }

    try {
      const { data, error } = await client.rpc('update_problem_feedback', {
        p_problem_id: problemId,
        p_is_like: isLike
      });
      if (error) {
        console.error(`Error updating feedback for problem ${problemId}:`, error);
        return null;
      }
      if (!Array.isArray(data) || data.length === 0) {
        console.error('No data returned from stored procedure');
        return null;
      }
      return mapProblemRecord(data[0] as ProblemRecord);
    } catch (error) {
      console.error(`Failed to update problem ${problemId}:`, error);
      return null;
    }
  }

  return { loadFeedback, loadSolvedProblemIds, updateFeedback, setSolved };
}
