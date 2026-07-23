-- Transactional forward migration for schema rerun hardening.
--
-- Safe to rerun. This migration changes no application data. It recreates the
-- canonical policies and triggers, pins auth SECURITY DEFINER functions, and
-- reapplies the least-privilege boundary before checking catalog postconditions.
\set ON_ERROR_STOP on
BEGIN;

\ir auth/user_roles.sql
\ir auth/user_triggers.sql
\ir auth/user_preferences.sql
\ir problems/problems.sql
\ir problems/user_problem_feedback.sql
\ir problems/user_solved_problems.sql
\ir problems/problem_functions.sql
\ir problems/get_user_solved_problems.sql
\ir contests/contests.sql
\ir contests/user_contest_participation.sql
\ir contests/user_contest_feedback.sql
\ir contests/contest_functions.sql
\ir leaderboard/leaderboard_functions.sql
\ir permissions.sql

DO $$
DECLARE
  missing_policies INT;
  misconfigured_definer_functions INT;
  missing_triggers INT;
  leaky_internal_functions INT;
BEGIN
  SELECT COUNT(*) INTO missing_policies
  FROM (VALUES
    ('user_roles', 'Users can read their own role'),
    ('user_roles', 'Only super admins can insert roles'),
    ('user_roles', 'Only super admins can update roles'),
    ('user_preferences', 'Users can read their own preferences'),
    ('user_preferences', 'Users can insert their own preferences'),
    ('user_preferences', 'Users can update their own preferences'),
    ('problems', 'Anyone can read problems'),
    ('problems', 'Only admins can insert problems'),
    ('problems', 'Only admins can update problems'),
    ('user_problem_feedback', 'Anyone can read feedback'),
    ('user_problem_feedback', 'Users can insert their own feedback'),
    ('user_problem_feedback', 'Users can update their own feedback'),
    ('user_problem_feedback', 'Users can delete their own feedback'),
    ('user_solved_problems', 'Anyone can read solved problems'),
    ('user_solved_problems', 'Users can mark their own solved problems'),
    ('user_solved_problems', 'Users can update their own solved problems'),
    ('user_solved_problems', 'Users can delete their own solved problems'),
    ('contests', 'Anyone can read contests'),
    ('contests', 'Only admins can insert contests'),
    ('contests', 'Only admins can update contests'),
    ('user_contest_participation', 'Anyone can read contest participation'),
    ('user_contest_participation', 'Users can register for contests'),
    ('user_contest_participation', 'Users can update their own participation'),
    ('user_contest_participation', 'Users can delete their own participation'),
    ('user_contest_feedback', 'Anyone can read contest feedback'),
    ('user_contest_feedback', 'Users can insert their own contest feedback'),
    ('user_contest_feedback', 'Users can update their own contest feedback'),
    ('user_contest_feedback', 'Users can delete their own contest feedback')
  ) AS expected(table_name, policy_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = expected.table_name
      AND p.policyname = expected.policy_name
  );
  IF missing_policies <> 0 THEN
    RAISE EXCEPTION '% canonical policies are missing after rerun hardening', missing_policies;
  END IF;

  SELECT COUNT(*) INTO misconfigured_definer_functions
  FROM (VALUES
    ('handle_new_user()', 'public.user_roles'),
    ('handle_new_user_preferences()', 'public.user_preferences'),
    ('get_leaderboard()', 'public.user_solved_problems'),
    ('get_user_solved_problems(uuid)', 'public.user_solved_problems'),
    ('update_problem_feedback(uuid,boolean)', 'public.user_problem_feedback'),
    ('update_contest_feedback(uuid,boolean)', 'public.user_contest_feedback')
  ) AS expected(signature, referenced_table)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.' || expected.signature)
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=public, pg_temp']::TEXT[]
      AND pg_get_functiondef(p.oid) LIKE '%' || expected.referenced_table || '%'
  );
  IF misconfigured_definer_functions <> 0 THEN
    RAISE EXCEPTION '% SECURITY DEFINER functions lack public qualification or the exact pinned search_path', misconfigured_definer_functions;
  END IF;

  SELECT COUNT(*) INTO missing_triggers
  FROM (VALUES
    ('auth', 'users', 'on_auth_user_created'),
    ('auth', 'users', 'on_auth_user_created_preferences'),
    ('public', 'user_problem_feedback', 'update_user_problem_feedback_updated_at'),
    ('public', 'user_contest_feedback', 'update_user_contest_feedback_updated_at')
  ) AS expected(schema_name, table_name, trigger_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = expected.schema_name
      AND c.relname = expected.table_name
      AND t.tgname = expected.trigger_name
  );
  IF missing_triggers <> 0 THEN
    RAISE EXCEPTION '% canonical triggers are missing after rerun hardening', missing_triggers;
  END IF;

  SELECT COUNT(*) INTO leaky_internal_functions
  FROM (VALUES
    ('handle_new_user()'),
    ('handle_new_user_preferences()'),
    ('update_updated_at_column()')
  ) AS expected(signature)
  JOIN pg_proc p
    ON p.oid = to_regprocedure('public.' || expected.signature)
  WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM aclexplode(
         COALESCE(p.proacl, acldefault('f', p.proowner))
       ) AS privilege
       WHERE privilege.grantee = 0
         AND privilege.privilege_type = 'EXECUTE'
     );
  IF leaky_internal_functions <> 0 THEN
    RAISE EXCEPTION '% internal functions remain executable by a client role or PUBLIC', leaky_internal_functions;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE grantee = 'anon'
      AND table_schema = 'public'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'anon retains an unexpected write grant after permissions reapply';
  END IF;
END $$;

COMMIT;
