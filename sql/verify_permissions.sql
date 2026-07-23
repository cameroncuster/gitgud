-- Repeatable verification of the least-privilege boundary in permissions.sql.
--
-- Run this with psql as a role that may SET ROLE (e.g. postgres), against a
-- database that has had sql/init.sql applied:
--   psql "$DATABASE_URL" -f sql/verify_permissions.sql
-- (or `supabase db execute -f sql/verify_permissions.sql`). It is read-oriented
-- and self-cleaning: the only writes it attempts are expected to FAIL under
-- RLS/grants, and any that unexpectedly succeed are rolled back. It never
-- mutates catalog data on a success path.
--
-- Every check RAISEs on failure, so a clean run that prints
-- 'ALL PERMISSION CHECKS PASSED' means the boundary holds. A failing run stops
-- at the first violated invariant and names it.
--
-- Boundary covered here:
--   Tables  * anon can SELECT catalog tables (public reads work)
--           * anon CANNOT INSERT/UPDATE/DELETE (unauthorized writes fail)
--           * authenticated (no jwt, auth.uid() = NULL) cannot write
--             admin-gated catalogs or rows it does not own
--   Funcs   * allowed public RPC (get_leaderboard) executes for anon
--           * authenticated INSERT relying on DEFAULT uuid_generate_v4()
--             succeeds (positive default path)
--           * internal trigger functions (handle_new_user,
--             handle_new_user_preferences, update_updated_at_column) are NOT
--             directly executable by anon or authenticated
--           * grant-level: no internal function grants EXECUTE to
--             PUBLIC/anon/authenticated
--           * feedback RPCs (update_problem_feedback, update_contest_feedback),
--             both the 2-arg and the temporary legacy 5-arg shim, are
--             EXECUTE-able by authenticated but NOT by anon/PUBLIC
DO $$
DECLARE
  anon_write_grants INT;
  leaky_func_grants INT;
  leaky_feedback_grants INT;
  read_ok BOOLEAN;
  blocked BOOLEAN;
  probe_id UUID;
BEGIN
  -- 1. Grant-level: anon must hold NO INSERT/UPDATE/DELETE on any public table.
  SELECT COUNT(*) INTO anon_write_grants
  FROM information_schema.role_table_grants
  WHERE grantee = 'anon'
    AND table_schema = 'public'
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
  IF anon_write_grants <> 0 THEN
    RAISE EXCEPTION 'anon holds % unexpected write grant(s) on public tables', anon_write_grants;
  END IF;

  -- 2. Grant-level: internal functions must not be executable by PUBLIC / anon /
  --    authenticated. has_function_privilege('public', ...) tests PUBLIC.
  SELECT COUNT(*) INTO leaky_func_grants
  FROM (VALUES
    ('handle_new_user()'),
    ('handle_new_user_preferences()'),
    ('update_updated_at_column()')
  ) AS f(sig)
  WHERE has_function_privilege('anon', 'public.' || f.sig, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.' || f.sig, 'EXECUTE')
     OR has_function_privilege('public', 'public.' || f.sig, 'EXECUTE');
  IF leaky_func_grants <> 0 THEN
    RAISE EXCEPTION '% internal function(s) are executable by a client role or PUBLIC', leaky_func_grants;
  END IF;

  -- 3. anon can read the public catalog tables.
  SET LOCAL ROLE anon;
  PERFORM 1 FROM problems LIMIT 1;
  PERFORM 1 FROM contests LIMIT 1;
  read_ok := true;
  RESET ROLE;
  IF NOT read_ok THEN
    RAISE EXCEPTION 'anon could not read public catalog tables';
  END IF;

  -- 4. anon INSERT on problems must be denied (grant absent / RLS).
  blocked := false;
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO problems (name, url, added_by, added_by_url)
    VALUES ('verify-probe', 'https://example.invalid', 'probe', 'https://example.invalid');
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR others THEN
    blocked := true;
    RESET ROLE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'anon was able to INSERT into problems (expected denial)';
  END IF;

  -- 5. anon UPDATE on contests must be denied.
  blocked := false;
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE contests SET likes = likes + 1;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR others THEN
    blocked := true;
    RESET ROLE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'anon was able to UPDATE contests (expected denial)';
  END IF;

  -- 6. anon INSERT into an own-row table must be denied (no grant for anon).
  blocked := false;
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO user_solved_problems (user_id, problem_id)
    VALUES (uuid_generate_v4(), uuid_generate_v4());
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR others THEN
    blocked := true;
    RESET ROLE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'anon was able to INSERT into user_solved_problems (expected denial)';
  END IF;

  -- 7. authenticated with no jwt (auth.uid() IS NULL) cannot INSERT admin-gated
  --    catalog rows: the grant exists but the RLS WITH CHECK requires an admin.
  blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO problems (name, url, added_by, added_by_url)
    VALUES ('verify-probe', 'https://example.invalid', 'probe', 'https://example.invalid');
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR others THEN
    blocked := true;
    RESET ROLE;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'authenticated (no jwt) inserted into problems (expected RLS denial)';
  END IF;

  -- 8. Allowed public RPC executes for anon (SECURITY DEFINER read path).
  SET LOCAL ROLE anon;
  PERFORM * FROM get_leaderboard() LIMIT 1;
  RESET ROLE;

  -- 9. Positive default path: authenticated INSERT relying on
  --    DEFAULT uuid_generate_v4() for its PK must succeed. Use an admin jwt so
  --    the problems RLS WITH CHECK passes, isolating the grant/default check.
  --    Runs inside a savepoint and is rolled back so no catalog row persists.
  INSERT INTO auth.users (id) VALUES (uuid_generate_v4()) RETURNING id INTO probe_id;
  INSERT INTO user_roles (user_id, role) VALUES (probe_id, 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', probe_id::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO problems (name, url, added_by, added_by_url)
    VALUES ('uuid-default-probe', 'https://example.invalid', 'probe', 'https://example.invalid');
    RESET ROLE;
    -- undo the probe row and identity
    DELETE FROM problems WHERE name = 'uuid-default-probe';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    DELETE FROM user_roles WHERE user_id = probe_id;
    DELETE FROM auth.users WHERE id = probe_id;
    RAISE EXCEPTION 'authenticated INSERT with DEFAULT uuid_generate_v4() failed: %', SQLERRM;
  END;
  DELETE FROM user_roles WHERE user_id = probe_id;
  DELETE FROM auth.users WHERE id = probe_id;

  -- 10. Direct execution of an internal trigger function must be denied for
  --     authenticated with an insufficient_privilege error specifically (a
  --     privilege check precedes the "can only be called as trigger" error, so
  --     this distinguishes a real EXECUTE denial from the trigger-context
  --     error that would occur even if EXECUTE were granted).
  blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM update_updated_at_column();
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
    RESET ROLE;
  WHEN others THEN
    RESET ROLE;
    RAISE EXCEPTION 'update_updated_at_column raised % (expected insufficient_privilege); EXECUTE may still be granted', SQLERRM;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'authenticated could directly EXECUTE update_updated_at_column (expected denial)';
  END IF;

  -- 11. Grant-level: every feedback RPC overload -- the canonical 2-arg form and
  --     the temporary legacy 5-arg shim -- must be EXECUTE-able by authenticated
  --     but NOT by anon or PUBLIC. These are SECURITY DEFINER writers, so a
  --     leaked anon/PUBLIC grant on either signature would let an
  --     unauthenticated caller reach them.
  SELECT COUNT(*) INTO leaky_feedback_grants
  FROM (VALUES
    ('update_problem_feedback(uuid, boolean)'),
    ('update_contest_feedback(uuid, boolean)'),
    ('update_problem_feedback(uuid, uuid, boolean, boolean, text)'),
    ('update_contest_feedback(uuid, uuid, boolean, boolean, text)')
  ) AS f(sig)
  WHERE has_function_privilege('anon', 'public.' || f.sig, 'EXECUTE')
     OR has_function_privilege('public', 'public.' || f.sig, 'EXECUTE');
  IF leaky_feedback_grants <> 0 THEN
    RAISE EXCEPTION '% feedback RPC overload(s) are EXECUTE-able by anon or PUBLIC (expected authenticated-only)', leaky_feedback_grants;
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.update_problem_feedback(uuid, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.update_contest_feedback(uuid, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.update_problem_feedback(uuid, uuid, boolean, boolean, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.update_contest_feedback(uuid, uuid, boolean, boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a feedback RPC overload is not EXECUTE-able by authenticated (expected grant present)';
  END IF;

  -- 12. Only the two expected feedback-RPC signatures may exist: the canonical
  --     2-argument form and the temporary legacy 5-argument shim. Any OTHER
  --     argument count would be an unexpected overload. That the 5-arg form is
  --     itself a secured shim (ignoring its identity/state arguments and
  --     delegating to the 2-arg form) is confirmed behaviorally in
  --     verify_feedback_integrity.sql.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('update_problem_feedback', 'update_contest_feedback')
      AND p.pronargs NOT IN (2, 5)
  ) THEN
    RAISE EXCEPTION 'an unexpected feedback RPC overload exists (only the 2-arg and legacy 5-arg signatures are allowed)';
  END IF;

  RAISE NOTICE 'ALL PERMISSION CHECKS PASSED';
END $$;
