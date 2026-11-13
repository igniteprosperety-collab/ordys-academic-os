-- Keep focus-session links referentially valid and scoped to the same owner.
-- This migration can be replayed safely while production migration history is reconciled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.focus_sessions'::regclass
      AND conname IN ('focus_plan_session_fk', 'focus_sessions_plan_session_fk')
  ) THEN
    ALTER TABLE public.focus_sessions
      ADD CONSTRAINT focus_plan_session_fk
        FOREIGN KEY (plan_session_id)
        REFERENCES public.plan_sessions(id)
        ON DELETE SET NULL
        NOT VALID;
  END IF;
END $$;

DROP TRIGGER IF EXISTS focus_refs_guard ON public.focus_sessions;
CREATE TRIGGER focus_refs_guard BEFORE INSERT OR UPDATE ON public.focus_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs(
  'subject_id','subjects',
  'topic_id','topics',
  'plan_session_id','plan_sessions'
);
