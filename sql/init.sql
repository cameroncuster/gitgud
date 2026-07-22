-- gitgud Database Schema Initialization
-- Apply the full schema with psql from the sql/ directory:
--   psql "$DATABASE_URL" -f sql/init.sql
-- Each \ir include resolves relative to THIS file, so the command works from
-- any working directory. These are psql meta-commands: run them through psql,
-- NOT by pasting into the Supabase dashboard SQL editor, which does not
-- interpret \ir.
-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Common utility functions
\ir common/utility_functions.sql
-- Authentication and user management
\ir auth/user_roles.sql
\ir auth/user_triggers.sql
\ir auth/user_preferences.sql
-- Problem-related tables and functions
\ir problems/problems.sql
\ir problems/user_problem_feedback.sql
\ir problems/user_solved_problems.sql
\ir problems/problem_functions.sql
\ir problems/get_user_solved_problems.sql
-- Contest-related tables and functions
\ir contests/contests.sql
\ir contests/user_contest_participation.sql
\ir contests/user_contest_feedback.sql
\ir contests/contest_functions.sql
-- Leaderboard functions
\ir leaderboard/leaderboard_functions.sql
-- Least-privilege grants (run last, after all objects exist)
\ir permissions.sql
