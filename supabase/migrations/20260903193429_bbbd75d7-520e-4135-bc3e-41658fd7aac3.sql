-- =========================================================
-- Camada 3 do deny-by-default: validação de dados no banco.
-- Somente CHECK constraints. Nenhum dado é alterado ou removido.
-- =========================================================

-- PROFILES
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_name_len CHECK (full_name IS NULL OR char_length(full_name) <= 120),
  ADD CONSTRAINT profiles_stage_allowed CHECK (stage IN ('medio','superior','pos','outro')),
  ADD CONSTRAINT profiles_timezone_len CHECK (char_length(timezone) BETWEEN 1 AND 64),
  ADD CONSTRAINT profiles_scale_range CHECK (grade_scale_max > 0 AND grade_scale_max <= 1000),
  ADD CONSTRAINT profiles_pass_range CHECK (grade_pass >= 0 AND grade_pass <= grade_scale_max),
  ADD CONSTRAINT profiles_attendance_range CHECK (attendance_target >= 0 AND attendance_target <= 100),
  ADD CONSTRAINT profiles_weekly_range CHECK (weekly_study_target_minutes BETWEEN 0 AND 10080),
  ADD CONSTRAINT profiles_daily_range CHECK (daily_load_limit_minutes BETWEEN 0 AND 1440);

-- SUBJECTS
ALTER TABLE public.subjects
  ADD CONSTRAINT subjects_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT subjects_short_len CHECK (short_name IS NULL OR char_length(short_name) <= 24),
  ADD CONSTRAINT subjects_teacher_len CHECK (teacher IS NULL OR char_length(teacher) <= 120),
  ADD CONSTRAINT subjects_room_len CHECK (room IS NULL OR char_length(room) <= 60),
  ADD CONSTRAINT subjects_color_len CHECK (char_length(color) <= 40),
  ADD CONSTRAINT subjects_term_len CHECK (term IS NULL OR char_length(term) <= 40),
  ADD CONSTRAINT subjects_weekly_hours_range CHECK (weekly_hours IS NULL OR (weekly_hours >= 0 AND weekly_hours <= 168)),
  ADD CONSTRAINT subjects_grade_goal_range CHECK (grade_goal IS NULL OR (grade_goal >= 0 AND grade_goal <= 1000)),
  ADD CONSTRAINT subjects_attendance_goal_range CHECK (attendance_goal IS NULL OR (attendance_goal >= 0 AND attendance_goal <= 100));

-- SUBJECT SCHEDULES
ALTER TABLE public.subject_schedules
  ADD CONSTRAINT schedules_weekday_range CHECK (weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT schedules_time_order CHECK (end_time > start_time),
  ADD CONSTRAINT schedules_room_len CHECK (room IS NULL OR char_length(room) <= 60);

-- TOPICS
ALTER TABLE public.topics
  ADD CONSTRAINT topics_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT topics_status_allowed CHECK (status IN ('nao_estudado','estudando','estudado','precisa_revisar','dominado')),
  ADD CONSTRAINT topics_mastery_range CHECK (mastery BETWEEN 0 AND 100),
  ADD CONSTRAINT topics_notes_len CHECK (notes IS NULL OR char_length(notes) <= 8000),
  ADD CONSTRAINT topics_position_range CHECK (position BETWEEN 0 AND 100000);

-- TASKS
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT tasks_description_len CHECK (description IS NULL OR char_length(description) <= 8000),
  ADD CONSTRAINT tasks_priority_allowed CHECK (priority IN ('baixa','media','alta')),
  ADD CONSTRAINT tasks_status_allowed CHECK (status IN ('nao_iniciada','pendente','em_andamento','concluida','atrasada')),
  ADD CONSTRAINT tasks_estimated_range CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 0 AND 1440);

-- SUBTASKS
ALTER TABLE public.subtasks
  ADD CONSTRAINT subtasks_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200);

-- EXAMS
ALTER TABLE public.exams
  ADD CONSTRAINT exams_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT exams_weight_len CHECK (weight IS NULL OR char_length(weight) <= 40),
  ADD CONSTRAINT exams_content_len CHECK (content IS NULL OR char_length(content) <= 8000),
  ADD CONSTRAINT exams_kind_allowed CHECK (kind IN ('prova','trabalho','seminario','simulado','recuperacao','outro'));

-- GRADES
ALTER TABLE public.grades
  ADD CONSTRAINT grades_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT grades_score_range CHECK (score >= 0 AND score <= 100000),
  ADD CONSTRAINT grades_max_range CHECK (max_score > 0 AND max_score <= 100000),
  ADD CONSTRAINT grades_weight_range CHECK (weight >= 0 AND weight <= 1000),
  ADD CONSTRAINT grades_term_len CHECK (term IS NULL OR char_length(term) <= 40);

-- ATTENDANCE
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_status_allowed CHECK (status IN ('presente','falta','justificada')),
  ADD CONSTRAINT attendance_note_len CHECK (note IS NULL OR char_length(note) <= 1000);

-- FOCUS SESSIONS
ALTER TABLE public.focus_sessions
  ADD CONSTRAINT focus_planned_range CHECK (planned_minutes BETWEEN 1 AND 600),
  ADD CONSTRAINT focus_actual_range CHECK (actual_minutes IS NULL OR actual_minutes BETWEEN 0 AND 1440),
  ADD CONSTRAINT focus_status_allowed CHECK (status IN ('em_andamento','concluida','cancelada','pausada'));

-- PLAN SESSIONS
ALTER TABLE public.plan_sessions
  ADD CONSTRAINT plan_duration_range CHECK (duration_minutes BETWEEN 5 AND 600),
  ADD CONSTRAINT plan_priority_range CHECK (priority BETWEEN 0 AND 1000),
  ADD CONSTRAINT plan_kind_allowed CHECK (kind IN ('estudo','revisao','tarefa','simulado')),
  ADD CONSTRAINT plan_status_allowed CHECK (status IN ('planejada','em_andamento','concluida','perdida','cancelada')),
  ADD CONSTRAINT plan_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500);

-- REVIEWS
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500),
  ADD CONSTRAINT reviews_source_allowed CHECK (source IN ('manual','automatico')),
  ADD CONSTRAINT reviews_status_allowed CHECK (status IN ('pendente','concluida','cancelada'));

-- GOALS
ALTER TABLE public.goals
  ADD CONSTRAINT goals_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT goals_metric_allowed CHECK (metric IN ('horas_estudo','media','frequencia','tarefas')),
  ADD CONSTRAINT goals_period_allowed CHECK (period IN ('diario','semanal','mensal','bimestral','semestral')),
  ADD CONSTRAINT goals_target_range CHECK (target >= 0 AND target <= 100000);

-- NOTIFICATIONS
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_category_len CHECK (char_length(category) <= 40),
  ADD CONSTRAINT notifications_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  ADD CONSTRAINT notifications_body_len CHECK (body IS NULL OR char_length(body) <= 1000),
  ADD CONSTRAINT notifications_link_len CHECK (link IS NULL OR char_length(link) <= 300),
  ADD CONSTRAINT notifications_dedupe_len CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 200);

-- NOTIFICATION PREFERENCES
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT prefs_quiet_not_null CHECK (quiet_start IS NOT NULL AND quiet_end IS NOT NULL);

-- PUSH SUBSCRIPTIONS
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_endpoint_len CHECK (char_length(endpoint) BETWEEN 10 AND 1000),
  ADD CONSTRAINT push_p256dh_len CHECK (char_length(p256dh) <= 300),
  ADD CONSTRAINT push_auth_len CHECK (char_length(auth) <= 300),
  ADD CONSTRAINT push_agent_len CHECK (user_agent IS NULL OR char_length(user_agent) <= 400);

-- QUIZ ATTEMPTS
ALTER TABLE public.quiz_attempts
  ADD CONSTRAINT quiz_difficulty_allowed CHECK (difficulty IN ('facil','media','dificil')),
  ADD CONSTRAINT quiz_count_range CHECK (question_count BETWEEN 1 AND 100),
  ADD CONSTRAINT quiz_correct_range CHECK (correct_count IS NULL OR (correct_count >= 0 AND correct_count <= question_count)),
  ADD CONSTRAINT quiz_duration_range CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 0 AND 86400),
  ADD CONSTRAINT quiz_status_allowed CHECK (status IN ('em_andamento','concluido','abandonado'));

-- QUIZ ANSWERS
ALTER TABLE public.quiz_answers
  ADD CONSTRAINT answers_question_len CHECK (char_length(question) BETWEEN 1 AND 2000),
  ADD CONSTRAINT answers_correct_len CHECK (correct_answer IS NULL OR char_length(correct_answer) <= 600),
  ADD CONSTRAINT answers_given_len CHECK (given_answer IS NULL OR char_length(given_answer) <= 600),
  ADD CONSTRAINT answers_explanation_len CHECK (explanation IS NULL OR char_length(explanation) <= 2000),
  ADD CONSTRAINT answers_seconds_range CHECK (seconds_spent IS NULL OR seconds_spent BETWEEN 0 AND 86400);

-- CALENDAR EVENTS
ALTER TABLE public.calendar_events
  ADD CONSTRAINT events_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT events_location_len CHECK (location IS NULL OR char_length(location) <= 300),
  ADD CONSTRAINT events_kind_allowed CHECK (kind IN ('aula','prova','estudo','tarefa','evento')),
  ADD CONSTRAINT events_source_allowed CHECK (source IN ('manual','google','ics','apple','outlook')),
  ADD CONSTRAINT events_external_len CHECK (external_id IS NULL OR char_length(external_id) <= 300);

-- CALENDAR CONNECTIONS
ALTER TABLE public.calendar_connections
  ADD CONSTRAINT conn_provider_allowed CHECK (provider IN ('google','apple','outlook','ics')),
  ADD CONSTRAINT conn_email_len CHECK (account_email IS NULL OR char_length(account_email) <= 320),
  ADD CONSTRAINT conn_status_allowed CHECK (status IN ('conectado','desconectado','pendente','erro'));

-- DAILY CHECKINS
ALTER TABLE public.daily_checkins
  ADD CONSTRAINT checkins_completed_len CHECK (completed_plan IS NULL OR char_length(completed_plan) <= 40),
  ADD CONSTRAINT checkins_focus_range CHECK (focus_rating IS NULL OR focus_rating BETWEEN 1 AND 5),
  ADD CONSTRAINT checkins_minutes_range CHECK (studied_minutes IS NULL OR studied_minutes BETWEEN 0 AND 1440),
  ADD CONSTRAINT checkins_note_len CHECK (pending_note IS NULL OR char_length(pending_note) <= 2000);

-- USAGE EVENTS (rate limiting da IA)
ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_kind_len CHECK (char_length(kind) BETWEEN 1 AND 60);