import { getCurrentActor } from '../auth/currentActor';
import {
  fetchProblemFeedback,
  fetchSolvedProblems,
  mapProblemRecord
} from '../queries/problemQueries';
import { supabase } from '../services/database';
import {
  createProblemEngagementGateway,
  type ProblemEngagementClient
} from './problemEngagementGateway';

export const problemEngagementGateway = createProblemEngagementGateway({
  client: supabase as unknown as ProblemEngagementClient,
  getCurrentUser: () => getCurrentActor().user,
  loadFeedback: fetchProblemFeedback,
  loadSolvedProblemIds: fetchSolvedProblems,
  mapProblemRecord
});
