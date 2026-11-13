-- Complete validation of academic profile range checks that were
-- installed as NOT VALID while production data was being reconciled.
-- A read-only production audit on 2026-10-30 found zero violations for
-- all five checks before this validation migration was prepared.

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_attendance_target_range;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_daily_load_limit_range;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_grade_pass_range;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_grade_scale_max_range;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_weekly_study_target_range;
