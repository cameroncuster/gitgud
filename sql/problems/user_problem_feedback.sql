-- Create user_problem_feedback table to store user likes/dislikes
CREATE TABLE IF NOT EXISTS user_problem_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('like', 'dislike')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, problem_id)
);

-- Create RLS policies for user_problem_feedback table
ALTER TABLE user_problem_feedback ENABLE ROW LEVEL SECURITY;

-- Users can read all feedback (needed for displaying aggregated likes/dislikes)
DROP POLICY IF EXISTS "Anyone can read feedback" ON user_problem_feedback;
CREATE POLICY "Anyone can read feedback" ON user_problem_feedback FOR
SELECT USING (true);

-- Users can only insert/update their own feedback
DROP POLICY IF EXISTS "Users can insert their own feedback" ON user_problem_feedback;
CREATE POLICY "Users can insert their own feedback" ON user_problem_feedback FOR
INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own feedback" ON user_problem_feedback;
CREATE POLICY "Users can update their own feedback" ON user_problem_feedback FOR
UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own feedback" ON user_problem_feedback;
CREATE POLICY "Users can delete their own feedback" ON user_problem_feedback FOR 
DELETE USING (auth.uid() = user_id);

-- Create trigger for user_problem_feedback table
DROP TRIGGER IF EXISTS update_user_problem_feedback_updated_at ON user_problem_feedback;
CREATE TRIGGER update_user_problem_feedback_updated_at BEFORE
UPDATE ON user_problem_feedback FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
