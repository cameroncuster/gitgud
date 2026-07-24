import type { Contest, ContestRecord } from '../queries/contestQueries.ts';
import type { Reaction } from '../engagement/reactionTransition.ts';

export type ContestFeedback = Record<string, Reaction>;

type DatabaseError = { code?: string };
type QueryResult<T> = { data: T; error: DatabaseError | null };
type DeleteQuery = PromiseLike<QueryResult<null>> & {
  eq: (column: string, value: string) => DeleteQuery;
};
type EngagementTable = {
  insert: (values: Record<string, string>) => PromiseLike<QueryResult<null>>;
  delete: () => DeleteQuery;
};

export type ContestEngagementClient = {
  from: (table: 'user_contest_participation') => EngagementTable;
  rpc: (
    name: 'update_contest_feedback',
    parameters: { p_contest_id: string; p_is_like: boolean }
  ) => PromiseLike<QueryResult<unknown>>;
};

export type ContestEngagementGateway = {
  loadFeedback: () => Promise<ContestFeedback>;
  loadParticipatedContestIds: () => Promise<Set<string>>;
  updateFeedback: (contestId: string, isLike: boolean) => Promise<Contest | null>;
  setParticipation: (contestId: string, hasParticipated: boolean) => Promise<boolean>;
};

export type CreateContestEngagementGatewayOptions = {
  client: ContestEngagementClient;
  getCurrentUser: () => { id: string } | null;
  loadFeedback: () => Promise<ContestFeedback>;
  loadParticipatedContestIds: () => Promise<Set<string>>;
  mapContestRecord: (record: ContestRecord) => Contest;
};

export function createContestEngagementGateway({
  client,
  getCurrentUser,
  loadFeedback,
  loadParticipatedContestIds,
  mapContestRecord
}: CreateContestEngagementGatewayOptions): ContestEngagementGateway {
  async function setParticipation(contestId: string, hasParticipated: boolean): Promise<boolean> {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      console.error('Cannot toggle participation: User not authenticated');
      return false;
    }

    try {
      if (hasParticipated) {
        const { error } = await client.from('user_contest_participation').insert({
          user_id: currentUser.id,
          contest_id: contestId
        });
        if (error) {
          if (error.code === '23505') return true;
          console.error(`Error marking contest ${contestId} as participated:`, error);
          return false;
        }
      } else {
        const { error } = await client
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
    } catch (error) {
      console.error(`Failed to toggle participation for contest ${contestId}:`, error);
      return false;
    }
  }

  async function updateFeedback(contestId: string, isLike: boolean): Promise<Contest | null> {
    if (!getCurrentUser()) {
      console.error('Cannot update feedback: User not authenticated');
      return null;
    }

    try {
      const { data, error } = await client.rpc('update_contest_feedback', {
        p_contest_id: contestId,
        p_is_like: isLike
      });
      if (error) {
        console.error(`Error updating feedback for contest ${contestId}:`, error);
        return null;
      }
      if (!Array.isArray(data) || data.length === 0) {
        console.error('No data returned from stored procedure');
        return null;
      }
      return mapContestRecord(data[0] as ContestRecord);
    } catch (error) {
      console.error(`Failed to update contest ${contestId}:`, error);
      return null;
    }
  }

  return { loadFeedback, loadParticipatedContestIds, updateFeedback, setParticipation };
}
