-- Stored procedure for updating contest feedback in a single transaction.
--
-- Security model: this is SECURITY DEFINER, so it runs with the owner's rights
-- and RLS on user_contest_feedback does NOT apply. The function must therefore
-- enforce identity and integrity itself:
--   * Identity is taken from auth.uid(), never from a caller argument, so a
--     caller cannot write feedback as another user.
--   * The current feedback row is locked and read inside the transaction, and
--     the new/switch/undo transition (and the resulting like/dislike deltas) is
--     derived from that actual state, not from caller-supplied "previous
--     feedback"/"undo" flags. Repeated or forged calls therefore cannot drive
--     the counters away from the true feedback rows.
-- search_path is pinned so object resolution cannot be hijacked by the caller.
CREATE OR REPLACE FUNCTION update_contest_feedback(
    p_contest_id UUID,
    p_is_like BOOLEAN
  ) RETURNS SETOF public.contests
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

  -- Lock the contest row so concurrent feedback serializes on it.
  PERFORM 1 FROM public.contests WHERE id = p_contest_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contest with ID % not found', p_contest_id;
  END IF;

  -- Lock and read the caller's ACTUAL current feedback for this contest.
  SELECT feedback_type INTO v_current
  FROM public.user_contest_feedback
  WHERE user_id = v_user_id
    AND contest_id = p_contest_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    -- New feedback: add the requested reaction.
    INSERT INTO public.user_contest_feedback (user_id, contest_id, feedback_type)
    VALUES (v_user_id, p_contest_id, v_requested);

    IF p_is_like THEN
      UPDATE public.contests SET likes = likes + 1 WHERE id = p_contest_id;
    ELSE
      UPDATE public.contests SET dislikes = dislikes + 1 WHERE id = p_contest_id;
    END IF;

  ELSIF v_current = v_requested THEN
    -- Same reaction repeated: undo it.
    DELETE FROM public.user_contest_feedback
    WHERE user_id = v_user_id
      AND contest_id = p_contest_id;

    IF p_is_like THEN
      UPDATE public.contests SET likes = GREATEST(0, likes - 1) WHERE id = p_contest_id;
    ELSE
      UPDATE public.contests SET dislikes = GREATEST(0, dislikes - 1) WHERE id = p_contest_id;
    END IF;

  ELSE
    -- Switching between like and dislike.
    UPDATE public.user_contest_feedback
    SET feedback_type = v_requested
    WHERE user_id = v_user_id
      AND contest_id = p_contest_id;

    IF p_is_like THEN
      UPDATE public.contests
      SET likes = likes + 1,
          dislikes = GREATEST(0, dislikes - 1)
      WHERE id = p_contest_id;
    ELSE
      UPDATE public.contests
      SET likes = GREATEST(0, likes - 1),
          dislikes = dislikes + 1
      WHERE id = p_contest_id;
    END IF;
  END IF;

  -- Return the updated contest.
  RETURN QUERY
  SELECT *
  FROM public.contests
  WHERE id = p_contest_id;
END;
$$;
