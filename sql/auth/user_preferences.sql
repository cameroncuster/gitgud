-- Create user_preferences table to store user settings
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hide_from_leaderboard BOOLEAN NOT NULL DEFAULT false,
  theme TEXT NOT NULL DEFAULT 'light',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);
-- Create RLS policies for user_preferences table
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
-- Users can read their own preferences
DROP POLICY IF EXISTS "Users can read their own preferences" ON user_preferences;
CREATE POLICY "Users can read their own preferences" ON user_preferences FOR
SELECT USING (auth.uid() = user_id);
-- Users can insert their own preferences
DROP POLICY IF EXISTS "Users can insert their own preferences" ON user_preferences;
CREATE POLICY "Users can insert their own preferences" ON user_preferences FOR
INSERT WITH CHECK (auth.uid() = user_id);
-- Users can update their own preferences
DROP POLICY IF EXISTS "Users can update their own preferences" ON user_preferences;
CREATE POLICY "Users can update their own preferences" ON user_preferences FOR
UPDATE USING (auth.uid() = user_id);
-- Create function to automatically create user preferences on new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user_preferences() RETURNS TRIGGER AS $$ BEGIN
INSERT INTO public.user_preferences (user_id, hide_from_leaderboard, theme)
VALUES (NEW.id, false, 'light');
RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;
-- Create trigger to call the function when a new user is created
DROP TRIGGER IF EXISTS on_auth_user_created_preferences ON auth.users;
CREATE TRIGGER on_auth_user_created_preferences
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_preferences();