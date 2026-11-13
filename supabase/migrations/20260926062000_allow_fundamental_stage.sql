-- Allow the education stage used by the profile UI for the project's full target range.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_stage_allowed;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_stage_allowed
  CHECK (stage IN ('fundamental','medio','superior','pos','outro'));
