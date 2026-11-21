export type CalendarEventFormInput = {
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  kind: string;
  subjectId: string;
};

export type CalendarEventPayload = {
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  kind: string;
  source: "ordys";
  subject_id: string | null;
};

export type CalendarEventFormResult = { valid: true; values: CalendarEventPayload } | { valid: false; error: string };

export function buildCalendarEventPayload(form: CalendarEventFormInput): CalendarEventFormResult {
  const title = form.title.trim();
  if (!title) {
    return { valid: false, error: "Informe o título do evento." };
  }

  const startsAt = new Date(form.startsAt);
  if (!form.startsAt || !Number.isFinite(startsAt.getTime())) {
    return { valid: false, error: "Informe uma data e horário de início válidos." };
  }

  const endsAt = form.endsAt ? new Date(form.endsAt) : null;
  if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime())) {
    return {
      valid: false,
      error: "O horário de término deve ser posterior ao início.",
    };
  }

  return {
    valid: true,
    values: {
      title,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt?.toISOString() ?? null,
      location: form.location.trim() || null,
      kind: form.kind,
      source: "ordys",
      subject_id: form.subjectId || null,
    },
  };
}
