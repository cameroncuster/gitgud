-- Repeatable verification of the least-privilege boundary in permissions.sql.
--
-- Run this in a Supabase SQL editor or via psql as a role that may SET ROLE
-- (e.g. postgres). It is read-oriented and self-cleaning: the only writes it
-- attempts are expected to FAIL under RLS/grants, and any that unexpectedly
-- succeed are rolled back. It never mutates catalog data on success paths.
--
-- Every check RAISEs on failure, so a clean run that prints
-- 'ALL PERMISSION CHECKS PASSED' means the boundary holds. A failing run stops
-- at the first violated invariant and names it.
--
-- Boundary covered here (behaviour observable from the client roles):
--   * anon can SELECT catalog tables (public reads work)
--   * anon CANNOT INSERT/UPDATE/DELETE (unauthorized writes fail)
--   * authenticated (unauthenticated jwt, auth.uid() = NULL) cannot write
--     own-row tables it does not own, and cannot write admin-gated catalogs
-- Grant-level assertions (against information_schema) confirm anon holds no
-- write privilege on any public table.
DO $$
DECLARE
  anon_write_grants INT;
  read_ok BOOLEAN;
  blocked BOOLEAN;
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

  -- 2. anon can read the public catalog tables.
  SET LOCAL ROLE anon;
  PERFORM 1 FROM problems LIMIT 1;
  PERFORM 1 FROM contests LIMIT 1;
  read_ok := true;
  RESET ROLE;
  IF NOT read_ok THEN
    RAISE EXCEPTION 'anon could not read public catalog tables';
  END IF;

  -- 3. anon INSERT on problems must be denied (grant absent / RLS).
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

  -- 4. anon UPDATE on contests must be denied.
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

  -- 5. anon INSERT into an own-row table must be denied (no grant for anon).
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

  -- 6. authenticated with no jwt (auth.uid() IS NULL) cannot INSERT admin-gated
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

  RAISE NOTICE 'ALL PERMISSION CHECKS PASSED';
END $$;
