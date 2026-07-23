-- Create problems table if it doesn't exist
CREATE TABLE IF NOT EXISTS problems (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  tags TEXT [] NOT NULL DEFAULT '{}',
  difficulty INTEGER,
  url TEXT NOT NULL,
  type TEXT,
  solved INTEGER DEFAULT 0,
  date_added TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  added_by TEXT NOT NULL,
  added_by_url TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  dislikes INTEGER DEFAULT 0
);

-- Create RLS policies for problems table
ALTER TABLE problems ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read problems
DROP POLICY IF EXISTS "Anyone can read problems" ON problems;
CREATE POLICY "Anyone can read problems" ON problems FOR
SELECT USING (true);

-- Only admins can insert problems
DROP POLICY IF EXISTS "Only admins can insert problems" ON problems;
CREATE POLICY "Only admins can insert problems" ON problems FOR
INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- Only admins can update problems
DROP POLICY IF EXISTS "Only admins can update problems" ON problems;
CREATE POLICY "Only admins can update problems" ON problems FOR
UPDATE USING (
    EXISTS (
      SELECT 1
      FROM user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- Disable deletion of problems entirely
-- We don't want to allow deletion of problems at all
