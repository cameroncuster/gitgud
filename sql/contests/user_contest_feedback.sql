-- Create user_contest_feedback table to store user likes/dislikes for contests
CREATE TABLE IF NOT EXISTS user_contest_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('like', 'dislike')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, contest_id)
);

-- Create RLS policies for user_contest_feedback table
ALTER TABLE user_contest_feedback ENABLE ROW LEVEL SECURITY;

-- Users can read all feedback (needed for displaying aggregated likes/dislikes)
DROP POLICY IF EXISTS "Anyone can read contest feedback" ON user_contest_feedback;
CREATE POLICY "Anyone can read contest feedback" ON user_contest_feedback FOR
SELECT USING (true);

-- Users can only insert/update their own feedback
DROP POLICY IF EXISTS "Users can insert their own contest feedback" ON user_contest_feedback;
CREATE POLICY "Users can insert their own contest feedback" ON user_contest_feedback FOR
INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own contest feedback" ON user_contest_feedback;
CREATE POLICY "Users can update their own contest feedback" ON user_contest_feedback FOR
UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own contest feedback" ON user_contest_feedback;
CREATE POLICY "Users can delete their own contest feedback" ON user_contest_feedback FOR 
DELETE USING (auth.uid() = user_id);

-- Create trigger for user_contest_feedback table
DROP TRIGGER IF EXISTS update_user_contest_feedback_updated_at ON user_contest_feedback;
CREATE TRIGGER update_user_contest_feedback_updated_at BEFORE
UPDATE ON user_contest_feedback FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
