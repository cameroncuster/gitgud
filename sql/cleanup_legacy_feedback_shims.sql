-- Remove the retired five-argument feedback RPC compatibility overloads.
--
-- Safe to rerun. This migration changes no application data. It fails and
-- rolls back unless both canonical two-argument RPCs exist, remain SECURITY
-- DEFINER with a pinned search_path, and are executable only by authenticated.
BEGIN;

DO $$
DECLARE
  function_name TEXT;
  canonical_oid OID;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'update_problem_feedback',
    'update_contest_feedback'
  ] LOOP
    canonical_oid := to_regprocedure(
      format('public.%I(uuid,boolean)', function_name)
    );

    IF canonical_oid IS NULL THEN
      RAISE EXCEPTION 'canonical %.%(uuid, boolean) is missing', 'public', function_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      WHERE p.oid = canonical_oid
        AND p.prosecdef
        AND EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS setting
          WHERE replace(setting, ' ', '') = 'search_path=public,pg_temp'
        )
    ) THEN
      RAISE EXCEPTION 'canonical %.% must be SECURITY DEFINER with search_path = public, pg_temp', 'public', function_name;
    END IF;

    IF NOT has_function_privilege('authenticated', canonical_oid, 'EXECUTE')
       OR has_function_privilege('anon', canonical_oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(
           COALESCE(p.proacl, acldefault('f', p.proowner))
         ) AS privilege
         WHERE p.oid = canonical_oid
           AND privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'canonical %.% must be executable by authenticated only', 'public', function_name;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.update_problem_feedback(UUID, UUID, BOOLEAN, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.update_contest_feedback(UUID, UUID, BOOLEAN, BOOLEAN, TEXT);

DO $$
DECLARE
  function_name TEXT;
  canonical_oid OID;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'update_problem_feedback',
    'update_contest_feedback'
  ] LOOP
    canonical_oid := to_regprocedure(
      format('public.%I(uuid,boolean)', function_name)
    );

    IF canonical_oid IS NULL THEN
      RAISE EXCEPTION 'canonical %.%(uuid, boolean) disappeared during cleanup', 'public', function_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = function_name
        AND p.oid <> canonical_oid
    ) THEN
      RAISE EXCEPTION 'unexpected overload remains for public.%', function_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      WHERE p.oid = canonical_oid
        AND p.prosecdef
        AND EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS setting
          WHERE replace(setting, ' ', '') = 'search_path=public,pg_temp'
        )
    ) THEN
      RAISE EXCEPTION 'canonical %.% lost its security configuration', 'public', function_name;
    END IF;

    IF NOT has_function_privilege('authenticated', canonical_oid, 'EXECUTE')
       OR has_function_privilege('anon', canonical_oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(
           COALESCE(p.proacl, acldefault('f', p.proowner))
         ) AS privilege
         WHERE p.oid = canonical_oid
           AND privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'canonical %.% has incorrect EXECUTE grants after cleanup', 'public', function_name;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS privilege
    WHERE privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('update_problem_feedback', 'update_contest_feedback')
ORDER BY p.proname;
