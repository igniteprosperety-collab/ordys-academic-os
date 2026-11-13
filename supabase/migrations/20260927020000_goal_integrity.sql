-- Align database defaults with the current goal form.
-- Older goal rows remain untouched; existing schema constraints already enforce
-- allowed metric, period and target values.
ALTER TABLE public.goals
  ALTER COLUMN metric SET DEFAULT 'horas_estudo',
  ALTER COLUMN period SET DEFAULT 'semanal';
