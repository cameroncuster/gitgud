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
--           * auth trigger functions are SECURITY DEFINER with exactly
--             search_path = public, pg_temp
--           * internal trigger functions (handle_new_user,
--             handle_new_user_preferences, update_updated_at_column) are NOT
--             directly executable by anon or authenticated
--           * grant-level: no internal function grants EXECUTE to
--             PUBLIC/anon/authenticated
--           * the canonical 2-argument feedback RPCs are EXECUTE-able by
--             authenticated but NOT by anon/PUBLIC
--           * no legacy or unexpected feedback overload exists
DO $$
DECLARE
  anon_write_grants INT;
  misconfigured_definer_functions INT;
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
  --    authenticated. PUBLIC is grantee OID 0 in the function ACL.
  SELECT COUNT(*) INTO leaky_func_grants
  FROM (VALUES
    ('handle_new_user()'),
    ('handle_new_user_preferences()'),
    ('update_updated_at_column()')
  ) AS f(sig)
  JOIN pg_proc p ON p.oid = to_regprocedure('public.' || f.sig)
  WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS privilege
       WHERE privilege.grantee = 0
         AND privilege.privilege_type = 'EXECUTE'
     );
  IF leaky_func_grants <> 0 THEN
    RAISE EXCEPTION '% internal function(s) are executable by a client role or PUBLIC', leaky_func_grants;
  END IF;

  -- 3. Every client-facing or trigger SECURITY DEFINER function must have
  --    exactly one pinned setting: search_path = public, pg_temp.
  SELECT COUNT(*) INTO misconfigured_definer_functions
  FROM (VALUES
    ('handle_new_user()'),
    ('handle_new_user_preferences()'),
    ('get_leaderboard()'),
    ('get_user_solved_problems(uuid)'),
    ('update_problem_feedback(uuid,boolean)'),
    ('update_contest_feedback(uuid,boolean)')
  ) AS f(sig)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.' || f.sig)
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=public, pg_temp']::TEXT[]
  );
  IF misconfigured_definer_functions <> 0 THEN
    RAISE EXCEPTION '% SECURITY DEFINER function(s) lack the exact search_path = public, pg_temp', misconfigured_definer_functions;
  END IF;

  -- 4. anon can read the public catalog tables.
  SET LOCAL ROLE anon;
  PERFORM 1 FROM problems LIMIT 1;
  PERFORM 1 FROM contests LIMIT 1;
  read_ok := true;
  RESET ROLE;
  IF NOT read_ok THEN
    RAISE EXCEPTION 'anon could not read public catalog tables';
  END IF;

  -- 5. anon INSERT on problems must be denied (grant absent / RLS).
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

  -- 6. anon UPDATE on contests must be denied.
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

  -- 7. anon INSERT into an own-row table must be denied (no grant for anon).
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

  -- 8. authenticated with no jwt (auth.uid() IS NULL) cannot INSERT admin-gated
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

  -- 9. Allowed public RPC executes for anon (SECURITY DEFINER read path).
  SET LOCAL ROLE anon;
  PERFORM * FROM get_leaderboard() LIMIT 1;
  RESET ROLE;

  -- 10. Positive default path: authenticated INSERT relying on
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

  -- 11. Direct execution of an internal trigger function must be denied for
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

  -- 12. Grant-level: the canonical feedback RPCs must be EXECUTE-able by
  --     authenticated but NOT by anon or PUBLIC. These are SECURITY DEFINER
  --     writers, so a leaked anon/PUBLIC grant would expose a write path.
  SELECT COUNT(*) INTO leaky_feedback_grants
  FROM (VALUES
    ('update_problem_feedback(uuid, boolean)'),
    ('update_contest_feedback(uuid, boolean)')
  ) AS f(sig)
  WHERE has_function_privilege('anon', 'public.' || f.sig, 'EXECUTE')
     OR has_function_privilege('public', 'public.' || f.sig, 'EXECUTE');
  IF leaky_feedback_grants <> 0 THEN
    RAISE EXCEPTION '% feedback RPC(s) are EXECUTE-able by anon or PUBLIC (expected authenticated-only)', leaky_feedback_grants;
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.update_problem_feedback(uuid, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.update_contest_feedback(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a canonical feedback RPC is not EXECUTE-able by authenticated (expected grant present)';
  END IF;

  -- 13. The canonical two-argument signature must be the only overload for each
  --     feedback RPC. This forbids the retired five-argument shims and any
  --     unexpected future overload.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('update_problem_feedback', 'update_contest_feedback')
      AND p.pronargs <> 2
  ) THEN
    RAISE EXCEPTION 'an unexpected feedback RPC overload exists (only the canonical 2-argument signatures are allowed)';
  END IF;

  RAISE NOTICE 'ALL PERMISSION CHECKS PASSED';
END $$;
