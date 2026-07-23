-- Create contests table to track programming contests
CREATE TABLE IF NOT EXISTS contests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT,
  duration_seconds INTEGER NOT NULL,
  difficulty INTEGER,
  added_by TEXT NOT NULL,
  added_by_url TEXT NOT NULL,
  date_added TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  likes INTEGER DEFAULT 0,
  dislikes INTEGER DEFAULT 0
);

-- Create RLS policies for contests table
ALTER TABLE contests ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read contests
DROP POLICY IF EXISTS "Anyone can read contests" ON contests;
CREATE POLICY "Anyone can read contests" ON contests FOR
SELECT USING (true);

-- Only admins can insert contests
DROP POLICY IF EXISTS "Only admins can insert contests" ON contests;
CREATE POLICY "Only admins can insert contests" ON contests FOR
INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- Only admins can update contests
DROP POLICY IF EXISTS "Only admins can update contests" ON contests;
CREATE POLICY "Only admins can update contests" ON contests FOR
UPDATE USING (
    EXISTS (
      SELECT 1
      FROM user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
    )
  );
