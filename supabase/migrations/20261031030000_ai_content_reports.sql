-- Store only AI content that a signed-in student explicitly reports.
-- Reports are private moderation records: clients cannot SELECT, INSERT, UPDATE or DELETE.
-- The authenticated Edge Function validates the owner and writes with service_role.
CREATE TABLE public.ai_content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('assistant', 'quiz')),
  reason TEXT NOT NULL CHECK (
    reason IN ('offensive', 'unsafe', 'inaccurate', 'personal_data', 'other')
  ),
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 20000),
  details TEXT CHECK (details IS NULL OR char_length(details) <= 600),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_content_reports_user_created_idx
  ON public.ai_content_reports (user_id, created_at DESC);

ALTER TABLE public.ai_content_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_content_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.ai_content_reports TO service_role;

-- Serialize per-account reports so simultaneous requests cannot bypass the hourly cap.
-- This is SECURITY INVOKER: only service_role has EXECUTE and table privileges.
CREATE OR REPLACE FUNCTION public.insert_ai_content_report(
  p_user_id UUID,
  p_source TEXT,
  p_reason TEXT,
  p_content TEXT,
  p_details TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  report_id UUID;
  reports_in_window INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'AI_CONTENT_REPORT_INVALID_USER';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  SELECT count(*)::INTEGER
    INTO reports_in_window
    FROM public.ai_content_reports
   WHERE user_id = p_user_id
     AND created_at >= now() - interval '1 hour';

  IF reports_in_window >= 10 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.ai_content_reports (user_id, source, reason, content, details)
  VALUES (p_user_id, p_source, p_reason, p_content, p_details)
  RETURNING id INTO report_id;

  RETURN report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_ai_content_report(UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_ai_content_report(UUID, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
