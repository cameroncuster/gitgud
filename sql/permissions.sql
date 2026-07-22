-- Least-privilege grants for the anon and authenticated roles
-- Run last, after every table and function in init.sql exists.
--
-- Row Level Security is the primary control on every table; these grants are a
-- fail-closed second layer that narrows the table-level privilege surface to
-- exactly what the app uses. Reads are public (anon + authenticated SELECT).
-- Writes are granted only where an RLS policy exists to scope them, so no grant
-- is broader than the policy that governs it. service_role keeps full access
-- because it is a server-side/admin credential and is never exposed to clients.
--
-- Revoke-then-grant makes this idempotent and fail-closed: re-running it always
-- lands on exactly this privilege set regardless of prior grants.
-- Schema usage: both client roles need USAGE to reference any object
GRANT USAGE ON SCHEMA public TO anon,
  authenticated,
  service_role;
-- Start from a clean slate for the two client-facing roles
REVOKE ALL ON ALL TABLES IN SCHEMA public
FROM anon,
  authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public
FROM anon,
  authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public
FROM anon,
  authenticated;
-- service_role is the trusted server-side credential: keep full access
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
-- Public reads: anon and authenticated may SELECT every table.
-- RLS SELECT policies still apply (own-row tables restrict rows accordingly).
GRANT SELECT ON problems,
  contests,
  user_roles,
  user_preferences,
  user_problem_feedback,
  user_solved_problems,
  user_contest_feedback,
  user_contest_participation TO anon,
  authenticated;
-- Catalog tables (problems, contests): INSERT/UPDATE are admin-gated by RLS.
-- Grant those writes to authenticated only; there is no DELETE policy, so DELETE
-- is intentionally not granted. anon gets no write access.
GRANT INSERT,
  UPDATE ON problems,
  contests TO authenticated;
-- Own-row tables with full self-service RLS (INSERT/UPDATE/DELETE own rows):
-- grant the matching writes to authenticated only.
GRANT INSERT,
  UPDATE,
  DELETE ON user_problem_feedback,
  user_solved_problems,
  user_contest_feedback,
  user_contest_participation TO authenticated;
-- Own-row table with insert/update RLS but no delete policy: no DELETE grant.
GRANT INSERT,
  UPDATE ON user_preferences TO authenticated;
-- user_roles has no client-facing write path (roles are assigned by
-- SECURITY DEFINER triggers, which bypass these grants); SELECT above is
-- sufficient for the app's admin check.
-- Sequences: the app never reads sequences directly (all PKs default to
-- uuid_generate_v4()), so no sequence grants are needed for client roles.
-- Functions: grant EXECUTE only on the RPCs each role actually calls.
-- anon-facing read RPCs (leaderboard + solved-problem lookup):
GRANT EXECUTE ON FUNCTION get_leaderboard() TO anon,
  authenticated;
GRANT EXECUTE ON FUNCTION get_user_solved_problems(UUID) TO anon,
  authenticated;
-- authenticated-only feedback RPCs (SECURITY DEFINER; write behind checks):
GRANT EXECUTE ON FUNCTION update_problem_feedback(UUID, UUID, BOOLEAN, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_contest_feedback(UUID, UUID, BOOLEAN, BOOLEAN, TEXT) TO authenticated;
