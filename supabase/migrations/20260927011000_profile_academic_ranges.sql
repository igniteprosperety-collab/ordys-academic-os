-- Replace the broader legacy profile constraints with the current product limits.
-- This migration is deliberately safe to re-run because the production database may
-- already contain the DDL while its migration-history row is being reconciled.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_scale_range,
  DROP CONSTRAINT IF EXISTS profiles_pass_range,
  DROP CONSTRAINT IF EXISTS profiles_attendance_range,
  DROP CONSTRAINT IF EXISTS profiles_weekly_range,
  DROP CONSTRAINT IF EXISTS profiles_daily_range;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_grade_scale_max_range'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_grade_scale_max_range
      CHECK (grade_scale_max >= 1 AND grade_scale_max <= 100) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_grade_pass_range'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_grade_pass_range
      CHECK (grade_pass >= 0 AND grade_pass <= grade_scale_max) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_attendance_target_range'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_attendance_target_range
      CHECK (attendance_target >= 0 AND attendance_target <= 100) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_weekly_study_target_range'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_weekly_study_target_range
      CHECK (weekly_study_target_minutes >= 0 AND weekly_study_target_minutes <= 10080) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_daily_load_limit_range'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_daily_load_limit_range
      CHECK (daily_load_limit_minutes >= 0 AND daily_load_limit_minutes <= 1440) NOT VALID;
  END IF;
END $$;
