-- Normalize the name copied from Auth metadata before creating the profile.
-- Google/OAuth metadata can bypass the account form, so the trigger must enforce
-- the same profile-name bound server-side.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate TEXT;
BEGIN
  candidate := btrim(coalesce(NEW.raw_user_meta_data->>'full_name', split_part(coalesce(NEW.email, ''), '@', 1)));
  candidate := left(candidate, 120);

  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NULLIF(candidate, ''))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
