-- Create a function to get leaderboard data
CREATE OR REPLACE FUNCTION get_leaderboard() RETURNS TABLE (
    user_id UUID,
    username TEXT,
    avatar_url TEXT,
    github_url TEXT,
    problems_solved BIGINT,
    earliest_solves_sum BIGINT,
    rank BIGINT
  ) AS $$ WITH user_stats AS (
    SELECT u.id AS user_id,
      u.raw_user_meta_data->>'user_name' AS username,
      u.raw_user_meta_data->>'avatar_url' AS avatar_url,
      CASE
        WHEN u.raw_user_meta_data->>'html_url' IS NOT NULL THEN u.raw_user_meta_data->>'html_url'
        ELSE 'https://github.com/' || (u.raw_user_meta_data->>'user_name')
      END AS github_url,
      COUNT(usp.problem_id)::BIGINT AS problems_solved,
      COALESCE(
        SUM(
          EXTRACT(
            EPOCH
            FROM usp.solved_at
          )::BIGINT
        ),
        0
      ) AS earliest_solves_sum
    FROM auth.users u
      LEFT JOIN public.user_solved_problems usp ON u.id = usp.user_id
      LEFT JOIN public.user_preferences up ON u.id = up.user_id
    WHERE COALESCE(up.hide_from_leaderboard, false) = false
    GROUP BY u.id,
      u.raw_user_meta_data
    HAVING COUNT(usp.problem_id) > 0
  )
SELECT user_stats.user_id,
  user_stats.username,
  user_stats.avatar_url,
  user_stats.github_url,
  user_stats.problems_solved,
  user_stats.earliest_solves_sum,
  ROW_NUMBER() OVER (
    ORDER BY user_stats.problems_solved DESC,
      user_stats.earliest_solves_sum ASC
  )::BIGINT AS rank
FROM user_stats
ORDER BY user_stats.problems_solved DESC,
  user_stats.earliest_solves_sum ASC;
$$ LANGUAGE SQL SECURITY DEFINER
SET search_path = public, pg_temp;
