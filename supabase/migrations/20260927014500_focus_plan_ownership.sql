-- Complete the ownership boundary for focus sessions linked to a generated plan.
-- The previous migration created the same foreign key under an interim name;
-- remove that redundant constraint before installing the final canonical one.
ALTER TABLE public.focus_sessions
  DROP CONSTRAINT IF EXISTS focus_plan_session_fk,
  DROP CONSTRAINT IF EXISTS focus_sessions_plan_session_fk;

ALTER TABLE public.focus_sessions
  ADD CONSTRAINT focus_sessions_plan_session_fk
    FOREIGN KEY (plan_session_id)
    REFERENCES public.plan_sessions(id)
    ON DELETE SET NULL
    NOT VALID;

-- Existing production data was checked for orphaned and cross-owner links.
-- Validate the foreign key now so the schema is fully enforced for old rows too.
ALTER TABLE public.focus_sessions
  VALIDATE CONSTRAINT focus_sessions_plan_session_fk;

DROP TRIGGER IF EXISTS focus_refs_guard ON public.focus_sessions;
CREATE TRIGGER focus_refs_guard
BEFORE INSERT OR UPDATE ON public.focus_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_same_owner_refs(
  'subject_id','subjects',
  'topic_id','topics',
  'plan_session_id','plan_sessions'
);
