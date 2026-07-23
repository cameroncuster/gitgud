-- Create user_contest_participation table to track which contests users have participated in
CREATE TABLE IF NOT EXISTS user_contest_participation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  participated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, contest_id)
);

-- Create RLS policies for user_contest_participation table
ALTER TABLE user_contest_participation ENABLE ROW LEVEL SECURITY;

-- Users can read all contest participation data
DROP POLICY IF EXISTS "Anyone can read contest participation" ON user_contest_participation;
CREATE POLICY "Anyone can read contest participation" ON user_contest_participation FOR
SELECT USING (true);

-- Users can only register themselves for contests
DROP POLICY IF EXISTS "Users can register for contests" ON user_contest_participation;
CREATE POLICY "Users can register for contests" ON user_contest_participation FOR
INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only update their own participation data
DROP POLICY IF EXISTS "Users can update their own participation" ON user_contest_participation;
CREATE POLICY "Users can update their own participation" ON user_contest_participation FOR
UPDATE USING (auth.uid() = user_id);

-- Users can only delete their own participation data
DROP POLICY IF EXISTS "Users can delete their own participation" ON user_contest_participation;
CREATE POLICY "Users can delete their own participation" ON user_contest_participation FOR 
DELETE USING (auth.uid() = user_id);
