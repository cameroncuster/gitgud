import { supabase } from '$lib/services/database';
import {
  createSubmissionPersistence,
  type SubmissionClient
} from '$lib/submit/submissionPersistence';
import type { ProviderAdapters } from '$lib/submit/types';
import { createCodeforcesSubmitAdapter } from './codeforces';
import { createKattisSubmitAdapter } from './kattis';

export function createProviderAdapters(): ProviderAdapters {
  const persistence = createSubmissionPersistence(supabase as unknown as SubmissionClient);
  return {
    codeforces: createCodeforcesSubmitAdapter(persistence),
    kattis: createKattisSubmitAdapter(persistence)
  };
}

export const providerOrder = ['codeforces', 'kattis'] as const;
