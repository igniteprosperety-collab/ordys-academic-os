-- Keep the profile UI and database aligned: fundamental is a supported ORDYS stage.
-- Preserve an existing correct constraint instead of dropping a validated rule
-- during production migration-history reconciliation.
DO $$
DECLARE
  stage_constraint_definition TEXT;
  stage_constraint_validated BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(oid), convalidated
  INTO stage_constraint_definition, stage_constraint_validated
  FROM pg_constraint
  WHERE conrelid = 'public.profiles'::regclass
    AND conname = 'profiles_stage_allowed'
    AND contype = 'c';

  IF stage_constraint_definition IS NULL
     OR stage_constraint_definition NOT ILIKE '%fundamental%'
     OR stage_constraint_definition NOT ILIKE '%medio%'
     OR stage_constraint_definition NOT ILIKE '%superior%'
     OR stage_constraint_definition NOT ILIKE '%pos%'
     OR stage_constraint_definition NOT ILIKE '%outro%' THEN
    ALTER TABLE public.profiles
      DROP CONSTRAINT IF EXISTS profiles_stage_allowed;

    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_stage_allowed
      CHECK (stage IN ('fundamental','medio','superior','pos','outro'))
      NOT VALID;

    stage_constraint_validated := FALSE;
  END IF;

  IF NOT COALESCE(stage_constraint_validated, FALSE) THEN
    ALTER TABLE public.profiles
      VALIDATE CONSTRAINT profiles_stage_allowed;
  END IF;
END $$;
