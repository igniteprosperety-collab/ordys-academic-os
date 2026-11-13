-- Ownership registry for long-running Assistente Ordys responses.
-- The response id is only usable by the account that created it.
CREATE TABLE IF NOT EXISTS public.assistant_jobs (
  response_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS assistant_jobs_user_idx
  ON public.assistant_jobs(user_id, created_at DESC);

REVOKE ALL ON public.assistant_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.assistant_jobs TO service_role;

ALTER TABLE public.assistant_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own assistant jobs" ON public.assistant_jobs;
CREATE POLICY "own assistant jobs"
  ON public.assistant_jobs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS assistant_jobs_expiry_idx
  ON public.assistant_jobs(expires_at);
