import { describe, expect, it } from "vitest";
import { buildCalendarEventPayload } from "@/lib/calendar-event-form";

const validForm = {
  title: "  Revisão de matemática  ",
  startsAt: "2026-11-21T09:00",
  endsAt: "2026-11-21T10:00",
  location: "  Sala 12  ",
  kind: "evento",
  subjectId: "subject-1",
};

describe("calendar event form validation", () => {
  it("normalizes valid input into the database payload", () => {
    const result = buildCalendarEventPayload(validForm);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.values).toMatchObject({
      title: "Revisão de matemática",
      location: "Sala 12",
      kind: "evento",
      source: "ordys",
      subject_id: "subject-1",
    });
    expect(result.values.starts_at).toBe(new Date(validForm.startsAt).toISOString());
    expect(result.values.ends_at).toBe(new Date(validForm.endsAt).toISOString());
  });

  it("rejects an empty title", () => {
    expect(buildCalendarEventPayload({ ...validForm, title: "  " })).toEqual({
      valid: false,
      error: "Informe o título do evento.",
    });
  });

  it("rejects a missing or invalid start timestamp", () => {
    expect(buildCalendarEventPayload({ ...validForm, startsAt: "" }).valid).toBe(false);
    expect(buildCalendarEventPayload({ ...validForm, startsAt: "invalid" }).valid).toBe(false);
  });

  it("rejects an end timestamp that is invalid or not after the start", () => {
    expect(buildCalendarEventPayload({ ...validForm, endsAt: "invalid" }).valid).toBe(false);
    expect(
      buildCalendarEventPayload({ ...validForm, endsAt: "2026-11-21T08:59" }).valid,
    ).toBe(false);
    expect(
      buildCalendarEventPayload({ ...validForm, endsAt: validForm.startsAt }).valid,
    ).toBe(false);
  });

  it("allows no end time and normalizes optional fields", () => {
    const result = buildCalendarEventPayload({
      ...validForm,
      endsAt: "",
      location: "  ",
      subjectId: "",
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.values.ends_at).toBeNull();
    expect(result.values.location).toBeNull();
    expect(result.values.subject_id).toBeNull();
  });
});
