-- Stored procedure for updating problem feedback in a single transaction.
--
-- Security model: this is SECURITY DEFINER, so it runs with the owner's rights
-- and RLS on user_problem_feedback does NOT apply. The function must therefore
-- enforce identity and integrity itself:
--   * Identity is taken from auth.uid(), never from a caller argument, so a
--     caller cannot write feedback as another user.
--   * The current feedback row is locked and read inside the transaction, and
--     the new/switch/undo transition (and the resulting like/dislike deltas) is
--     derived from that actual state, not from caller-supplied "previous
--     feedback"/"undo" flags. Repeated or forged calls therefore cannot drive
--     the counters away from the true feedback rows.
-- search_path is pinned so object resolution cannot be hijacked by the caller.
--
-- Rollout note: the canonical function is the 2-argument (p_problem_id,
-- p_is_like) signature below. A legacy 5-argument compatibility shim is kept
-- TEMPORARILY at the bottom of this file so an old client (still sending
-- p_user_id / p_is_undo / p_previous_feedback) keeps working across a
-- non-atomic DB/client deploy. That shim ignores the caller-supplied identity
-- and state and delegates here, so it inherits every guarantee. It MUST be
-- dropped once all clients have rolled over -- see
-- sql/cleanup_legacy_feedback_shims.sql for the cleanup migration.
CREATE OR REPLACE FUNCTION update_problem_feedback(
    p_problem_id UUID,
    p_is_like BOOLEAN
  ) RETURNS SETOF problems
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_current TEXT;
  v_requested TEXT := CASE WHEN p_is_like THEN 'like' ELSE 'dislike' END;
BEGIN
  -- Identity comes from the authenticated session, never from the caller.
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lock the problem row so concurrent feedback serializes on it.
  PERFORM 1 FROM problems WHERE id = p_problem_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Problem with ID % not found', p_problem_id;
  END IF;

  -- Lock and read the caller's ACTUAL current feedback for this problem.
  SELECT feedback_type INTO v_current
  FROM user_problem_feedback
  WHERE user_id = v_user_id
    AND problem_id = p_problem_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    -- New feedback: add the requested reaction.
    INSERT INTO user_problem_feedback (user_id, problem_id, feedback_type)
    VALUES (v_user_id, p_problem_id, v_requested);

    IF p_is_like THEN
      UPDATE problems SET likes = likes + 1 WHERE id = p_problem_id;
    ELSE
      UPDATE problems SET dislikes = dislikes + 1 WHERE id = p_problem_id;
    END IF;

  ELSIF v_current = v_requested THEN
    -- Same reaction repeated: undo it.
    DELETE FROM user_problem_feedback
    WHERE user_id = v_user_id
      AND problem_id = p_problem_id;

    IF p_is_like THEN
      UPDATE problems SET likes = GREATEST(0, likes - 1) WHERE id = p_problem_id;
    ELSE
      UPDATE problems SET dislikes = GREATEST(0, dislikes - 1) WHERE id = p_problem_id;
    END IF;

  ELSE
    -- Switching between like and dislike.
    UPDATE user_problem_feedback
    SET feedback_type = v_requested
    WHERE user_id = v_user_id
      AND problem_id = p_problem_id;

    IF p_is_like THEN
      UPDATE problems
      SET likes = likes + 1,
          dislikes = GREATEST(0, dislikes - 1)
      WHERE id = p_problem_id;
    ELSE
      UPDATE problems
      SET likes = GREATEST(0, likes - 1),
          dislikes = dislikes + 1
      WHERE id = p_problem_id;
    END IF;
  END IF;

  -- Return the updated problem.
  RETURN QUERY
  SELECT *
  FROM problems
  WHERE id = p_problem_id;
END;
$$;

-- Ensure the function is accessible to authenticated users
GRANT EXECUTE ON FUNCTION update_problem_feedback(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- TEMPORARY backward-compatibility shim (remove after clients roll over).
--
-- Old clients call update_problem_feedback with 5 arguments
-- (p_problem_id, p_user_id, p_is_like, p_is_undo, p_previous_feedback). We keep
-- this signature ONLY so a client deployed before the DB migration keeps
-- working; we do NOT trust any of its identity/state arguments. p_user_id,
-- p_is_undo and p_previous_feedback are accepted and then IGNORED: the shim
-- delegates to the secured 2-argument function, which derives identity from
-- auth.uid() and the new/switch/undo transition from the locked current row.
-- It is therefore exactly as resistant to impersonation and counter drift as
-- the 2-argument function.
--
-- CLEANUP: once all clients send the 2-argument form, drop this shim by running
-- the forward migration sql/cleanup_legacy_feedback_shims.sql (which runs
--   DROP FUNCTION IF EXISTS update_problem_feedback(UUID, UUID, BOOLEAN, BOOLEAN, TEXT);
-- ) and then remove this definition and its grant.
CREATE OR REPLACE FUNCTION update_problem_feedback(
    p_problem_id UUID,
    p_user_id UUID,
    p_is_like BOOLEAN,
    p_is_undo BOOLEAN DEFAULT FALSE,
    p_previous_feedback TEXT DEFAULT NULL
  ) RETURNS SETOF problems
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- Deliberately ignore p_user_id / p_is_undo / p_previous_feedback: identity
  -- and the transition are derived inside the 2-argument function from
  -- auth.uid() and the actual stored feedback row.
  RETURN QUERY
  SELECT * FROM update_problem_feedback(p_problem_id, p_is_like);
END;
$$;

GRANT EXECUTE ON FUNCTION update_problem_feedback(UUID, UUID, BOOLEAN, BOOLEAN, TEXT) TO authenticated;
