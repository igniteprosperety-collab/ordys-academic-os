-- Usage events are internal accounting data. Clients must not be able to
-- read or insert rows; only trusted Edge Functions write them.
REVOKE ALL ON public.usage_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.usage_events TO service_role;

DROP POLICY IF EXISTS "own usage events" ON public.usage_events;
DROP POLICY IF EXISTS "insert own usage events" ON public.usage_events;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
