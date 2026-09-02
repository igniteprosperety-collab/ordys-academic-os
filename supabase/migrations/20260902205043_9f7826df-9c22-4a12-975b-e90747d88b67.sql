REVOKE ALL ON public.usage_events FROM anon;
GRANT SELECT, INSERT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;