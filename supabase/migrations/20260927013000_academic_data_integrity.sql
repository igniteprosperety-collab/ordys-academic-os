-- Add integrity rules that are not already covered by the schema validation layer.
-- The existing migration already validates ranges/status values for most entities;
-- these two rules close the remaining grade-consistency gaps without duplicating
-- constraint names.
ALTER TABLE public.grades
  DROP CONSTRAINT IF EXISTS grades_score_not_above_max,
  DROP CONSTRAINT IF EXISTS grades_weight_positive;
ALTER TABLE public.grades
  ADD CONSTRAINT grades_score_not_above_max
    CHECK (score <= max_score) NOT VALID,
  ADD CONSTRAINT grades_weight_positive
    CHECK (weight > 0) NOT VALID;
