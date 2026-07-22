-- gitgud Database Schema Initialization
-- This file includes all the necessary SQL files to set up the database schema
-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Common utility functions
\ i common / utility_functions.sql -- Authentication and user management
\ i auth / user_roles.sql \ i auth / user_triggers.sql \ i auth / user_preferences.sql -- Problem-related tables and functions
\ i problems / problems.sql \ i problems / user_problem_feedback.sql \ i problems / user_solved_problems.sql \ i problems / problem_functions.sql \ i problems / get_user_solved_problems.sql -- Contest-related tables and functions
\ i contests / contests.sql \ i contests / user_contest_participation.sql \ i contests / user_contest_feedback.sql \ i contests / contest_functions.sql -- Leaderboard functions
\ i leaderboard / leaderboard_functions.sql -- Grant least-privilege permissions (run last, after all objects exist)
\ i permissions.sql