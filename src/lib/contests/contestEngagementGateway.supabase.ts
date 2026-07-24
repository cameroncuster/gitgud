import { getCurrentActor } from '../auth/currentActor';
import {
  fetchContestFeedback,
  fetchContestParticipation,
  mapContestRecord
} from '../queries/contestQueries';
import { supabase } from '../services/database';
import {
  createContestEngagementGateway,
  type ContestEngagementClient
} from './contestEngagementGateway';

export const contestEngagementGateway = createContestEngagementGateway({
  client: supabase as unknown as ContestEngagementClient,
  getCurrentUser: () => getCurrentActor().user,
  loadFeedback: fetchContestFeedback,
  loadParticipatedContestIds: fetchContestParticipation,
  mapContestRecord
});
