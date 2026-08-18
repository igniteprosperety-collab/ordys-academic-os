-- 1) Data API grants (deny-by-default: only authenticated + service_role, no anon)
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t.relname);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t.relname);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.relname);
  END LOOP;
END $$;

-- 2) Server-side ownership defaults: user_id never needs to come from the client
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='user_id' AND a.attnum>0 AND NOT a.attisdropped
           WHERE n.nspname='public' AND c.relkind='r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id SET DEFAULT auth.uid()', t.relname);
  END LOOP;
END $$;
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT auth.uid();

-- 3) Block ownership transfer on update (defence in depth alongside RLS WITH CHECK)
CREATE OR REPLACE FUNCTION public.prevent_owner_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'ownership change not allowed';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.prevent_owner_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='user_id' AND a.attnum>0 AND NOT a.attisdropped
           WHERE n.nspname='public' AND c.relkind='r'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.relname||'_owner_lock', t.relname);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_owner_change()', t.relname||'_owner_lock', t.relname);
  END LOOP;
END $$;

-- 4) Cross-user reference guard: a row may only point at parents owned by the same user
CREATE OR REPLACE FUNCTION public.enforce_same_owner_refs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i int; col text; parent text; ref uuid; owner uuid;
BEGIN
  i := 0;
  WHILE i < TG_NARGS LOOP
    col := TG_ARGV[i];
    parent := TG_ARGV[i+1];
    EXECUTE format('SELECT ($1).%I', col) INTO ref USING NEW;
    IF ref IS NOT NULL THEN
      EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1', parent) INTO owner USING ref;
      IF owner IS NULL OR owner IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'referenced record does not belong to the current user';
      END IF;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_same_owner_refs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_refs_guard ON public.tasks;
CREATE TRIGGER tasks_refs_guard BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects','topic_id','topics');

DROP TRIGGER IF EXISTS subtasks_refs_guard ON public.subtasks;
CREATE TRIGGER subtasks_refs_guard BEFORE INSERT OR UPDATE ON public.subtasks
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('task_id','tasks');

DROP TRIGGER IF EXISTS topics_refs_guard ON public.topics;
CREATE TRIGGER topics_refs_guard BEFORE INSERT OR UPDATE ON public.topics
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects');

DROP TRIGGER IF EXISTS exams_refs_guard ON public.exams;
CREATE TRIGGER exams_refs_guard BEFORE INSERT OR UPDATE ON public.exams
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects');

DROP TRIGGER IF EXISTS exam_topics_refs_guard ON public.exam_topics;
CREATE TRIGGER exam_topics_refs_guard BEFORE INSERT OR UPDATE ON public.exam_topics
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('exam_id','exams','topic_id','topics');

DROP TRIGGER IF EXISTS grades_refs_guard ON public.grades;
CREATE TRIGGER grades_refs_guard BEFORE INSERT OR UPDATE ON public.grades
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects','exam_id','exams');

DROP TRIGGER IF EXISTS attendance_refs_guard ON public.attendance_records;
CREATE TRIGGER attendance_refs_guard BEFORE INSERT OR UPDATE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects');

DROP TRIGGER IF EXISTS schedules_refs_guard ON public.subject_schedules;
CREATE TRIGGER schedules_refs_guard BEFORE INSERT OR UPDATE ON public.subject_schedules
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects');

DROP TRIGGER IF EXISTS focus_refs_guard ON public.focus_sessions;
CREATE TRIGGER focus_refs_guard BEFORE INSERT OR UPDATE ON public.focus_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects','topic_id','topics');

DROP TRIGGER IF EXISTS plan_refs_guard ON public.plan_sessions;
CREATE TRIGGER plan_refs_guard BEFORE INSERT OR UPDATE ON public.plan_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects','topic_id','topics','exam_id','exams','task_id','tasks');

DROP TRIGGER IF EXISTS reviews_refs_guard ON public.reviews;
CREATE TRIGGER reviews_refs_guard BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('topic_id','topics');

DROP TRIGGER IF EXISTS goals_refs_guard ON public.goals;
CREATE TRIGGER goals_refs_guard BEFORE INSERT OR UPDATE ON public.goals
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects');

DROP TRIGGER IF EXISTS events_refs_guard ON public.calendar_events;
CREATE TRIGGER events_refs_guard BEFORE INSERT OR UPDATE ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects');

DROP TRIGGER IF EXISTS checkins_refs_guard ON public.daily_checkins;
CREATE TRIGGER checkins_refs_guard BEFORE INSERT OR UPDATE ON public.daily_checkins
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('hardest_subject_id','subjects');

DROP TRIGGER IF EXISTS attempts_refs_guard ON public.quiz_attempts;
CREATE TRIGGER attempts_refs_guard BEFORE INSERT OR UPDATE ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('subject_id','subjects');

DROP TRIGGER IF EXISTS answers_refs_guard ON public.quiz_answers;
CREATE TRIGGER answers_refs_guard BEFORE INSERT OR UPDATE ON public.quiz_answers
FOR EACH ROW EXECUTE FUNCTION public.enforce_same_owner_refs('attempt_id','quiz_attempts','topic_id','topics');

-- 5) Rate limiting store for sensitive/expensive actions (AI, quizzes, notifications)
CREATE TABLE IF NOT EXISTS public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own usage events" ON public.usage_events;
CREATE POLICY "own usage events" ON public.usage_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert own usage events" ON public.usage_events;
CREATE POLICY "insert own usage events" ON public.usage_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS usage_events_user_kind_time ON public.usage_events (user_id, kind, created_at DESC);

-- 6) Account data deletion for the signed-in user only
CREATE OR REPLACE FUNCTION public.delete_own_data()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM public.quiz_answers WHERE user_id = uid;
  DELETE FROM public.quiz_attempts WHERE user_id = uid;
  DELETE FROM public.usage_events WHERE user_id = uid;
  DELETE FROM public.daily_checkins WHERE user_id = uid;
  DELETE FROM public.reviews WHERE user_id = uid;
  DELETE FROM public.plan_sessions WHERE user_id = uid;
  DELETE FROM public.focus_sessions WHERE user_id = uid;
  DELETE FROM public.goals WHERE user_id = uid;
  DELETE FROM public.grades WHERE user_id = uid;
  DELETE FROM public.attendance_records WHERE user_id = uid;
  DELETE FROM public.exam_topics WHERE user_id = uid;
  DELETE FROM public.exams WHERE user_id = uid;
  DELETE FROM public.subtasks WHERE user_id = uid;
  DELETE FROM public.tasks WHERE user_id = uid;
  DELETE FROM public.topics WHERE user_id = uid;
  DELETE FROM public.subject_schedules WHERE user_id = uid;
  DELETE FROM public.calendar_events WHERE user_id = uid;
  DELETE FROM public.calendar_connections WHERE user_id = uid;
  DELETE FROM public.subjects WHERE user_id = uid;
  DELETE FROM public.notifications WHERE user_id = uid;
  DELETE FROM public.push_subscriptions WHERE user_id = uid;
  DELETE FROM public.notification_preferences WHERE user_id = uid;
  DELETE FROM public.profiles WHERE id = uid;
END; $$;
REVOKE ALL ON FUNCTION public.delete_own_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_data() TO authenticated;