-- Align the quiz_attempts database default with the values used by the app.
-- The existing CHECK constraint accepts 'facil', 'media', and 'dificil'.
-- The previous default 'medio' violated that constraint for inserts that omit difficulty.
BEGIN;

ALTER TABLE public.quiz_attempts
  ALTER COLUMN difficulty SET DEFAULT 'media';

COMMIT;
