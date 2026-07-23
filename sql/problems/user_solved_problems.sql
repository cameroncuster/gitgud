-- Create user_solved_problems table to track which problems users have solved
CREATE TABLE IF NOT EXISTS user_solved_problems (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  solved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, problem_id)
);

-- Create RLS policies for user_solved_problems table
ALTER TABLE user_solved_problems ENABLE ROW LEVEL SECURITY;

-- Users can read all solved problems (needed for displaying statistics)
DROP POLICY IF EXISTS "Anyone can read solved problems" ON user_solved_problems;
CREATE POLICY "Anyone can read solved problems" ON user_solved_problems FOR
SELECT USING (true);

-- Users can only mark their own problems as solved
DROP POLICY IF EXISTS "Users can mark their own solved problems" ON user_solved_problems;
CREATE POLICY "Users can mark their own solved problems" ON user_solved_problems FOR
INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only update their own solved problems
DROP POLICY IF EXISTS "Users can update their own solved problems" ON user_solved_problems;
CREATE POLICY "Users can update their own solved problems" ON user_solved_problems FOR
UPDATE USING (auth.uid() = user_id);

-- Users can only delete their own solved problems
DROP POLICY IF EXISTS "Users can delete their own solved problems" ON user_solved_problems;
CREATE POLICY "Users can delete their own solved problems" ON user_solved_problems FOR 
DELETE USING (auth.uid() = user_id);
