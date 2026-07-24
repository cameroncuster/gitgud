export type ProviderId = 'codeforces' | 'kattis';
export type SubmitItemKind = 'problem' | 'contest';
export type WorkflowStage = 'source' | 'links' | 'review' | 'complete';

export type ProblemDraft = {
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
  type?: string;
};

export type ContestDraft = {
  name: string;
  url: string;
  durationSeconds: number;
  difficulty?: number;
  addedBy: string;
  addedByUrl: string;
  likes: number;
  dislikes: number;
  type?: string;
};

export type ExtractedEntry = {
  kind: SubmitItemKind;
  url: string;
};

export type ResolvedItem =
  | {
      valid: true;
      kind: 'problem';
      label: string;
      url: string;
      payload: ProblemDraft;
    }
  | {
      valid: true;
      kind: 'contest';
      label: string;
      url: string;
      payload: ContestDraft;
    }
  | {
      valid: false;
      kind: SubmitItemKind;
      label: string;
      url: string;
      reason: string;
    };

export type ValidResolvedItem = Extract<ResolvedItem, { valid: true }>;

export type CommitResult = {
  success: boolean;
  message?: string;
  id?: string;
};

export type ProviderAdapter = {
  id: ProviderId;
  name: string;
  icon: string;
  placeholder: string;
  help: string;
  extract: (text: string) => ExtractedEntry[];
  resolve: (entry: ExtractedEntry, handle: string) => Promise<ResolvedItem>;
  commit: (item: ValidResolvedItem) => Promise<CommitResult>;
};

export type ProviderAdapters = Record<ProviderId, ProviderAdapter>;

export type PreviewRow = {
  id: number;
  item: ResolvedItem;
  status: 'staged' | 'committing' | 'added' | 'failed';
  message?: string;
};

export type SubmissionWorkflowState = {
  provider: ProviderId;
  handle: string;
  pasted: string;
  rows: PreviewRow[];
  resolving: boolean;
  committing: boolean;
  done: boolean;
  inlineError: string | null;
  sequence: number;
  stage: WorkflowStage;
  validCount: number;
  invalidCount: number;
  addedCount: number;
  committedFailures: number;
};

export type SubmissionPersistence = {
  checkEquivalentProblemUrls: (
    canonicalUrl: string,
    alternateUrls?: readonly string[]
  ) => Promise<DuplicateCheckResult>;
  checkContest: (url: string) => Promise<DuplicateCheckResult>;
  insertProblem: (draft: ProblemDraft) => Promise<CommitResult>;
  insertContest: (draft: ContestDraft) => Promise<CommitResult>;
};

export type DuplicateCheckResult = {
  duplicate: boolean;
  message?: string;
  error?: string;
};
