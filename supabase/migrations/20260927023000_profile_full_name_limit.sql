-- Keep server-created profile names within the same bound used by the account UI.
-- The base schema already owns the `profiles_full_name_len` constraint (max 120).
-- This separate constraint adds the non-blank requirement without duplicating
-- the existing constraint name.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_full_name_nonblank;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_name_nonblank
  CHECK (full_name IS NULL OR char_length(btrim(full_name)) BETWEEN 1 AND 120)
  NOT VALID;

-- Reject the migration if historical data violates the new rule; do not leave
-- the production constraint unvalidated after a successful deployment.
ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_full_name_nonblank;
