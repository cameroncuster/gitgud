-- Create user_roles table for managing admin users
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create RLS policies for user_roles table
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own role
DROP POLICY IF EXISTS "Users can read their own role" ON user_roles;
CREATE POLICY "Users can read their own role" ON user_roles FOR
SELECT USING (auth.uid() = user_id);

-- Only allow super admins to insert/update roles
-- Note: The first admin will need to be created manually by a database administrator
DROP POLICY IF EXISTS "Only super admins can insert roles" ON user_roles;
CREATE POLICY "Only super admins can insert roles" ON user_roles FOR
INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Only super admins can update roles" ON user_roles;
CREATE POLICY "Only super admins can update roles" ON user_roles FOR
UPDATE USING (
    EXISTS (
      SELECT 1
      FROM user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- Disable deletion of user roles entirely
-- We don't want to allow deletion of user roles at all
