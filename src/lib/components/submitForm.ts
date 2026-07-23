// Shared types for the redesigned submit form (ProblemSubmitForm.svelte) and
// its provider pages. Kept in a plain module (not a Svelte `context="module"`
// block) so both the component and the /submit/* pages import them without a
// component-instance dependency.

// A single row in the progressive batch-status list. `kind` distinguishes
// problems from contests so the Codeforces path can badge contest rows; the
// Kattis path only ever emits 'problem'. `classification` is an intentionally
// empty placeholder slot the later Gemini PR fills with a per-item topic; it
// renders a muted "—" until then so the column exists and is exercised now.
export type SubmitItemStatus = 'pending' | 'working' | 'success' | 'error';
export type SubmitItemKind = 'problem' | 'contest';

export type SubmitItem = {
  url: string;
  status: SubmitItemStatus;
  kind: SubmitItemKind;
  message?: string;
  name?: string;
  details?: string;
  classification?: string;
};

// The result of processing a single URL, returned by the caller-supplied
// `processUrl`. Keeping this small and explicit lets both providers share the
// exact same UI and progressive-status machinery.
export type ProcessOutcome = {
  success: boolean;
  kind: SubmitItemKind;
  name?: string;
  message?: string;
  details?: string;
  classification?: string;
};
