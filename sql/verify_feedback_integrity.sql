-- Executable regression tests for the feedback RPC identity / counter-integrity
-- guarantees (update_problem_feedback, update_contest_feedback).
--
-- Run with psql as a role that may SET ROLE (e.g. postgres), against a database
-- that has had sql/init.sql applied:
--   psql "$DATABASE_URL" -f sql/verify_feedback_integrity.sql
-- (or `supabase db execute -f sql/verify_feedback_integrity.sql`).
--
-- These functions are SECURITY DEFINER, so RLS does not protect them; the guard
-- rails live in the function bodies. Each check RAISEs on failure, so a clean
-- run that prints 'ALL FEEDBACK INTEGRITY CHECKS PASSED' means the guarantees
-- hold. The test seeds two disposable users and one disposable problem/contest,
-- exercises the RPCs while impersonating each user via the request.jwt GUC, and
-- removes everything it created before returning (including on failure).
--
-- Guarantees covered:
--   Identity  * feedback is always attributed to auth.uid(); a caller cannot
--               write feedback as (or otherwise touch the row of) another user
--   Counters  * a repeated identical call is an idempotent undo/redo pair and
--               never drifts the like/dislike counters
--             * counters always equal the true count of feedback rows, and can
--               never be driven negative by forged/repeated calls
--             * counters and the per-user feedback row stay consistent across
--               new -> switch -> undo transitions driven only by the RPC
--   Legacy    * the temporary 5-argument compatibility shim carries the SAME
--               guarantees: it ignores the caller-supplied user id / undo /
--               previous-feedback arguments and delegates to the secured 2-arg
--               function, so forged identity/state cannot impersonate or drift
DO $$
DECLARE
  user_a UUID;
  user_b UUID;
  prob_id UUID;
  con_id UUID;
  v_likes INT;
  v_dislikes INT;
  v_rows INT;
  v_type TEXT;
  raised BOOLEAN;
  i INT;
BEGIN
  -- ---- Seed disposable identities and catalog rows ----
  INSERT INTO auth.users (id) VALUES (uuid_generate_v4()) RETURNING id INTO user_a;
  INSERT INTO auth.users (id) VALUES (uuid_generate_v4()) RETURNING id INTO user_b;
  INSERT INTO problems (name, url, added_by, added_by_url)
  VALUES ('feedback-integrity-probe', 'https://example.invalid', 'probe', 'https://example.invalid')
  RETURNING id INTO prob_id;
  INSERT INTO contests (name, url, duration_seconds, added_by, added_by_url)
  VALUES ('feedback-integrity-probe', 'https://example.invalid', 3600, 'probe', 'https://example.invalid')
  RETURNING id INTO con_id;

  -- ================= IDENTITY =================

  -- 1. A like from user A is attributed to user A, not to any caller-named user.
  --    (The RPC no longer takes a user id; identity is auth.uid().)
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, true);
  RESET ROLE;

  SELECT COUNT(*) INTO v_rows FROM user_problem_feedback
   WHERE problem_id = prob_id AND user_id = user_a AND feedback_type = 'like';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'expected exactly one like row owned by user A, found %', v_rows;
  END IF;
  SELECT COUNT(*) INTO v_rows FROM user_problem_feedback
   WHERE problem_id = prob_id AND user_id = user_b;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'user B has feedback it never submitted (impersonation leak)';
  END IF;

  -- 2. User B acting on the same problem must ONLY affect user B's own row and
  --    must never mutate or remove user A's feedback. A malicious client that
  --    used to pass another user's id can no longer reach A's row at all.
  PERFORM set_config('request.jwt.claim.sub', user_b::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, false);  -- B dislikes
  RESET ROLE;

  SELECT feedback_type INTO v_type FROM user_problem_feedback
   WHERE problem_id = prob_id AND user_id = user_a;
  IF v_type IS DISTINCT FROM 'like' THEN
    RAISE EXCEPTION 'user A feedback changed to % by user B action (expected untouched like)', v_type;
  END IF;
  SELECT feedback_type INTO v_type FROM user_problem_feedback
   WHERE problem_id = prob_id AND user_id = user_b;
  IF v_type IS DISTINCT FROM 'dislike' THEN
    RAISE EXCEPTION 'user B feedback is % (expected dislike)', v_type;
  END IF;

  -- 3. An unauthenticated caller (auth.uid() IS NULL) is rejected outright, so
  --    no anonymous or forged-null identity can write feedback.
  raised := false;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    SET LOCAL ROLE authenticated;
    PERFORM update_problem_feedback(prob_id, true);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    raised := true;
    RESET ROLE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'update_problem_feedback accepted a call with no authenticated user';
  END IF;

  -- Counters must reflect exactly the two real rows (A like, B dislike).
  SELECT likes, dislikes INTO v_likes, v_dislikes FROM problems WHERE id = prob_id;
  IF v_likes <> 1 OR v_dislikes <> 1 THEN
    RAISE EXCEPTION 'after identity checks counters are (l=%, d=%), expected (1, 1)', v_likes, v_dislikes;
  END IF;

  -- ================= COUNTER INTEGRITY =================

  -- Reset to a clean slate for the counter arithmetic checks.
  DELETE FROM user_problem_feedback WHERE problem_id = prob_id;
  UPDATE problems SET likes = 0, dislikes = 0 WHERE id = prob_id;

  -- Act as user A for the counter-arithmetic checks (auth.uid() reads this sub
  -- claim); we drive the RPC directly under the authenticated role below.
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);

  -- 4. Repeated identical like calls are an idempotent add/undo pair: after two
  --    calls the row is gone and the counter is back to zero (never 2). This is
  --    the forged-"new feedback"-replay attack that used to double-count.
  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, true);   -- new like  -> likes = 1
  RESET ROLE;
  SELECT likes INTO v_likes FROM problems WHERE id = prob_id;
  IF v_likes <> 1 THEN RAISE EXCEPTION 'after 1st like, likes = % (expected 1)', v_likes; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, true);   -- same again -> undo -> likes = 0
  RESET ROLE;
  SELECT likes INTO v_likes FROM problems WHERE id = prob_id;
  SELECT COUNT(*) INTO v_rows FROM user_problem_feedback WHERE problem_id = prob_id AND user_id = user_a;
  IF v_likes <> 0 OR v_rows <> 0 THEN
    RAISE EXCEPTION 'repeated identical like drifted state: likes=%, rows=% (expected 0, 0)', v_likes, v_rows;
  END IF;

  -- 5. Hammer the RPC many times; the counter is derived from the true row set
  --    each time, so an odd number of identical calls leaves exactly one row and
  --    likes = 1, an even number leaves zero rows and likes = 0. No drift.
  FOR i IN 1..21 LOOP
    SET LOCAL ROLE authenticated;
    PERFORM update_problem_feedback(prob_id, true);
    RESET ROLE;
  END LOOP;
  SELECT likes, dislikes INTO v_likes, v_dislikes FROM problems WHERE id = prob_id;
  SELECT COUNT(*) INTO v_rows FROM user_problem_feedback WHERE problem_id = prob_id AND user_id = user_a;
  IF v_likes <> 1 OR v_dislikes <> 0 OR v_rows <> 1 THEN
    RAISE EXCEPTION '21 identical calls drifted state: likes=%, dislikes=%, rows=% (expected 1, 0, 1)', v_likes, v_dislikes, v_rows;
  END IF;

  -- 6. Switching like -> dislike moves exactly one count each way and leaves a
  --    single row; counters stay consistent with the row's feedback_type.
  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, false);  -- switch to dislike
  RESET ROLE;
  SELECT likes, dislikes INTO v_likes, v_dislikes FROM problems WHERE id = prob_id;
  SELECT feedback_type INTO v_type FROM user_problem_feedback WHERE problem_id = prob_id AND user_id = user_a;
  IF v_likes <> 0 OR v_dislikes <> 1 OR v_type IS DISTINCT FROM 'dislike' THEN
    RAISE EXCEPTION 'switch left inconsistent state: likes=%, dislikes=%, type=% (expected 0, 1, dislike)', v_likes, v_dislikes, v_type;
  END IF;

  -- 7. Counters can never go negative even if the stored counter is corrupted
  --    below the true row count: an undo clamps at zero rather than wrapping.
  UPDATE problems SET dislikes = 0 WHERE id = prob_id;  -- corrupt counter low
  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, false);      -- undo the dislike
  RESET ROLE;
  SELECT dislikes INTO v_dislikes FROM problems WHERE id = prob_id;
  SELECT COUNT(*) INTO v_rows FROM user_problem_feedback WHERE problem_id = prob_id AND user_id = user_a;
  IF v_dislikes < 0 OR v_dislikes <> 0 OR v_rows <> 0 THEN
    RAISE EXCEPTION 'undo drove counter negative or inconsistent: dislikes=%, rows=% (expected 0, 0)', v_dislikes, v_rows;
  END IF;

  -- 8. Two distinct users each contribute independently; the aggregate counter
  --    equals the true number of rows of each type, regardless of call order.
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, true);   -- A likes
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, true);  -- B likes
  RESET ROLE;
  SELECT likes INTO v_likes FROM problems WHERE id = prob_id;
  SELECT COUNT(*) INTO v_rows FROM user_problem_feedback WHERE problem_id = prob_id AND feedback_type = 'like';
  IF v_likes <> v_rows OR v_likes <> 2 THEN
    RAISE EXCEPTION 'aggregate like counter %% row count mismatch: likes=%, rows=% (expected 2, 2)', v_likes, v_rows;
  END IF;

  -- 9. Smoke-check the contest RPC shares the same identity + counter behavior:
  --    a like then an identical repeat (undo) nets to zero with no row left.
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_contest_feedback(con_id, true);
  PERFORM update_contest_feedback(con_id, true);  -- repeat -> undo
  RESET ROLE;
  SELECT likes INTO v_likes FROM contests WHERE id = con_id;
  SELECT COUNT(*) INTO v_rows FROM user_contest_feedback WHERE contest_id = con_id AND user_id = user_a;
  IF v_likes <> 0 OR v_rows <> 0 THEN
    RAISE EXCEPTION 'contest RPC drifted on repeated like: likes=%, rows=% (expected 0, 0)', v_likes, v_rows;
  END IF;

  -- ============ LEGACY 5-ARG COMPATIBILITY SHIM ============
  -- The shim exists only for the rollout window. It must be exactly as safe as
  -- the 2-arg function: it has to ignore the caller-supplied p_user_id /
  -- p_is_undo / p_previous_feedback and derive everything from auth.uid() plus
  -- the stored row. These checks call the shim the way a pre-fix client did --
  -- forging those arguments -- and confirm no impersonation or drift results.

  -- Reset to a clean slate for the shim checks.
  DELETE FROM user_problem_feedback WHERE problem_id = prob_id;
  UPDATE problems SET likes = 0, dislikes = 0 WHERE id = prob_id;

  -- 10. Impersonation via the shim is impossible: attacker (user B) is
  --     authenticated as themselves but forges p_user_id = user A. The feedback
  --     must be attributed to B (auth.uid()), never to the forged A.
  PERFORM set_config('request.jwt.claim.sub', user_b::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, user_a, true, false, NULL);
  RESET ROLE;
  SELECT COUNT(*) INTO v_rows FROM user_problem_feedback WHERE problem_id = prob_id AND user_id = user_a;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'legacy shim let user B write feedback as forged user A (impersonation)';
  END IF;
  SELECT feedback_type INTO v_type FROM user_problem_feedback WHERE problem_id = prob_id AND user_id = user_b;
  IF v_type IS DISTINCT FROM 'like' THEN
    RAISE EXCEPTION 'legacy shim did not attribute feedback to the authenticated user B (got %)', v_type;
  END IF;

  -- 11. Counter drift via the shim is impossible: forge p_previous_feedback so
  --     the OLD code would have treated each repeat as a fresh switch and
  --     incremented likes every call. The shim ignores it and derives an
  --     undo/redo from the real row, so 3 identical forged "like" calls leave
  --     the counter == the true row count, never inflated.
  DELETE FROM user_problem_feedback WHERE problem_id = prob_id;
  UPDATE problems SET likes = 0, dislikes = 0 WHERE id = prob_id;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_problem_feedback(prob_id, user_a, true, false, NULL);       -- new like -> likes = 1
  PERFORM update_problem_feedback(prob_id, user_a, true, false, 'dislike');  -- forged switch -> undo -> likes = 0
  PERFORM update_problem_feedback(prob_id, user_a, true, true,  'dislike');  -- forged flags -> new like -> likes = 1
  RESET ROLE;
  SELECT likes INTO v_likes FROM problems WHERE id = prob_id;
  SELECT COUNT(*) INTO v_rows FROM user_problem_feedback WHERE problem_id = prob_id AND user_id = user_a AND feedback_type = 'like';
  IF v_likes <> v_rows THEN
    RAISE EXCEPTION 'legacy shim drifted counter under forged flags: likes=% but real like rows=%', v_likes, v_rows;
  END IF;

  -- 12. The contest shim shares the behavior: a forged-identity like followed by
  --     an identical forged repeat nets to zero with no row, attributed to the
  --     authenticated caller only.
  DELETE FROM user_contest_feedback WHERE contest_id = con_id;
  UPDATE contests SET likes = 0, dislikes = 0 WHERE id = con_id;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM update_contest_feedback(con_id, user_b, true, false, NULL);        -- forge user B
  PERFORM update_contest_feedback(con_id, user_b, true, false, 'dislike');   -- forged repeat -> undo
  RESET ROLE;
  SELECT likes INTO v_likes FROM contests WHERE id = con_id;
  SELECT COUNT(*) INTO v_rows FROM user_contest_feedback WHERE contest_id = con_id;
  IF v_likes <> 0 OR v_rows <> 0 THEN
    RAISE EXCEPTION 'contest legacy shim drifted/mis-attributed: likes=%, rows=% (expected 0, 0)', v_likes, v_rows;
  END IF;

  -- ---- Clean up every disposable object this test created ----
  RESET ROLE;
  DELETE FROM user_problem_feedback WHERE problem_id = prob_id;
  DELETE FROM user_contest_feedback WHERE contest_id = con_id;
  DELETE FROM problems WHERE id = prob_id;
  DELETE FROM contests WHERE id = con_id;
  DELETE FROM user_roles WHERE user_id IN (user_a, user_b);
  DELETE FROM auth.users WHERE id IN (user_a, user_b);

  RAISE NOTICE 'ALL FEEDBACK INTEGRITY CHECKS PASSED';
EXCEPTION WHEN OTHERS THEN
  -- Best-effort cleanup so a failed run does not leave probe rows behind.
  RESET ROLE;
  DELETE FROM user_problem_feedback WHERE problem_id = prob_id;
  DELETE FROM user_contest_feedback WHERE contest_id = con_id;
  DELETE FROM problems WHERE id = prob_id;
  DELETE FROM contests WHERE id = con_id;
  DELETE FROM user_roles WHERE user_id IN (user_a, user_b);
  DELETE FROM auth.users WHERE id IN (user_a, user_b);
  RAISE;
END $$;
