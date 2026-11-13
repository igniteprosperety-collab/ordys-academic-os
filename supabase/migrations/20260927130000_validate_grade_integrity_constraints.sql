-- Validate the historical grade-integrity checks only after confirming
-- that existing rows satisfy them. This migration never edits student data.
-- If legacy rows violate either rule, fail with counts so the operator can
-- review and correct those records deliberately before retrying.

DO $$
DECLARE
  invalid_score_count BIGINT;
  invalid_weight_count BIGINT;
BEGIN
  SELECT count(*)
  INTO invalid_score_count
  FROM public.grades
  WHERE score > max_score;

  SELECT count(*)
  INTO invalid_weight_count
  FROM public.grades
  WHERE weight <= 0;

  IF invalid_score_count > 0 OR invalid_weight_count > 0 THEN
    RAISE EXCEPTION
      'Grade integrity validation blocked: % rows have score above max_score; % rows have non-positive weight. No data was changed.',
      invalid_score_count,
      invalid_weight_count;
  END IF;
END $$;

ALTER TABLE public.grades
  VALIDATE CONSTRAINT grades_score_not_above_max;

ALTER TABLE public.grades
  VALIDATE CONSTRAINT grades_weight_positive;
