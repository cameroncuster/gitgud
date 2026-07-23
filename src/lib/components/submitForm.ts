// Shared types for the unified /submit workspace (src/routes/submit/+page.svelte)
// and its provider adapters. Kept in a plain module (not a Svelte
// `context="module"` block) so the page and the provider adapter modules import
// them without a component-instance dependency.
//
// The workspace runs a strict two-phase flow so nothing is ever written to the
// database before the admin's final confirmation:
//   1. resolve — parse pasted text into URLs, then fetch each entry's metadata
//      and run the duplicate check. This is READ-ONLY: it produces preview rows
//      and never inserts.
//   2. confirm — insert only the still-present, valid preview rows.
// The provider adapters own the provider-specific work (URL extraction,
// metadata fetch, duplicate detection, insert) behind this small contract, so
// the workspace UI, auth gate, staging, validation, and completion summary are
// shared across providers.

// The providers the workspace supports. The compact selector switches between
// them and the deep links (/submit/codeforces, /submit/kattis) preselect one.
export type ProviderId = 'codeforces' | 'kattis';

// Whether a resolved entry is a problem or a contest. Only the Codeforces
// adapter ever emits 'contest'; Kattis always emits 'problem'.
export type SubmitItemKind = 'problem' | 'contest';

// The outcome of resolving a single URL: either a valid entry ready to commit,
// or an invalid one carrying the reason it cannot be submitted. `payload` is the
// adapter's opaque, pre-fetched insert data — the workspace never inspects it,
// it only hands it back to `commit` on confirm — so no metadata is re-fetched
// between preview and write.
export type ResolvedItem =
  | {
      valid: true;
      kind: SubmitItemKind;
      // Human label shown in the preview row (e.g. "CF 1234A - Two Stones").
      label: string;
      // The canonical, normalized URL the row links to.
      url: string;
      // Opaque insert payload the adapter's `commit` consumes.
      payload: unknown;
    }
  | {
      valid: false;
      kind: SubmitItemKind;
      label: string;
      url: string;
      // Why this entry cannot be submitted (duplicate, not found, provider
      // error, invalid URL). Rendered on the row and excluded from the write.
      reason: string;
    };

// The result of committing (inserting) one resolved entry on confirm.
export type CommitResult = {
  success: boolean;
  // A short note for the completion summary on failure (e.g. a late duplicate).
  message?: string;
};

// A provider adapter: the small, provider-specific surface the shared workspace
// drives. Everything provider-specific (extraction, metadata fetch, duplicate
// detection, insert) lives behind these three members so the UI stays shared.
export type ProviderAdapter = {
  id: ProviderId;
  name: string;
  icon: string;
  // Placeholder + quiet help text for the paste textarea.
  placeholder: string;
  help: string;
  // Parse pasted text into a flat, de-duplicated list of canonical URLs. Pure
  // and read-only; no network, no writes.
  extract: (text: string) => string[];
  // Resolve one URL into a preview row: fetch metadata and run the duplicate
  // check. READ-ONLY — must never insert. `handle` credits the submission.
  resolve: (url: string, handle: string) => Promise<ResolvedItem>;
  // Insert one previously-resolved, still-valid entry. Called only on the
  // admin's final confirmation, once per surviving valid row.
  commit: (item: Extract<ResolvedItem, { valid: true }>) => Promise<CommitResult>;
};

// A staged preview row in the workspace's Review stage. Wraps a `ResolvedItem`
// with a stable id (for keyed rendering and removal) and its post-commit status.
export type PreviewRow = {
  id: number;
  item: ResolvedItem;
  // 'staged' until confirm; then 'committing' -> 'added' | 'failed'.
  status: 'staged' | 'committing' | 'added' | 'failed';
  message?: string;
};

// The workspace's linear stages, surfaced as a visible Source → Links → Review
// progress indicator.
export type Stage = 'source' | 'links' | 'review';
