import { describe, expect, it } from "vitest";
import { buildCalendarIcs } from "@/lib/calendar-ics";

describe("calendar iCalendar export", () => {
  it("exports event title, start, end, location, and stable UID in UTC", () => {
    const ics = buildCalendarIcs(
      [
        {
          id: "event-1",
          title: "Consulta",
          starts_at: "2026-11-21T15:30:00+03:00",
          ends_at: "2026-11-21T16:30:00+03:00",
          location: "Sala 3",
          kind: "compromisso",
        },
      ],
      { now: new Date("2026-11-20T10:00:00.000Z") },
    );

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("UID:event-1@ordys.academy");
    expect(ics).toContain("DTSTAMP:20261120T100000Z");
    expect(ics).toContain("DTSTART:20261121T123000Z");
    expect(ics).toContain("DTEND:20261121T133000Z");
    expect(ics).toContain("SUMMARY:Consulta");
    expect(ics).toContain("DESCRIPTION:compromisso");
    expect(ics).toContain("LOCATION:Sala 3");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("ACTION:DISPLAY");
    expect(ics).toContain("TRIGGER:-PT10M");
    expect(ics).toContain("DESCRIPTION:Consulta começa em 10 minutos");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("escapes RFC 5545 text delimiters and newlines", () => {
    const ics = buildCalendarIcs([
      {
        id: "event-2",
        title: "Revisão, parte 1; tópicos\\extras",
        starts_at: "2026-11-21T12:30:00.000Z",
        location: "Sala 1\nBloco B",
      },
    ]);

    expect(ics).toContain("SUMMARY:Revisão\\, parte 1\\; tópicos\\\\extras");
    expect(ics).toContain("LOCATION:Sala 1\\nBloco B");
  });

  it("sorts events by start time and skips invalid records", () => {
    const ics = buildCalendarIcs([
      { id: "later", title: "Mais tarde", starts_at: "2026-11-21T15:00:00.000Z" },
      { id: "invalid", title: "Sem data", starts_at: "invalid" },
      { id: "earlier", title: "Primeiro", starts_at: "2026-11-21T08:00:00.000Z" },
      { id: "blank", title: "  ", starts_at: "2026-11-21T09:00:00.000Z" },
    ]);

    expect(ics.indexOf("SUMMARY:Primeiro")).toBeLessThan(ics.indexOf("SUMMARY:Mais tarde"));
    expect(ics).not.toContain("Sem data");
    expect(ics).not.toContain("UID:blank@ordys.academy");
  });

  it("omits an invalid or non-positive event end time", () => {
    const ics = buildCalendarIcs([
      {
        id: "event-3",
        title: "Sem término válido",
        starts_at: "2026-11-21T12:30:00.000Z",
        ends_at: "2026-11-21T12:00:00.000Z",
      },
    ]);

    expect(ics).toContain("DTSTART:20261121T123000Z");
    expect(ics).not.toContain("DTEND:");
  });

  it("folds long UTF-8 content without exceeding 75 octets per physical line", () => {
    const ics = buildCalendarIcs([
      {
        id: "event-4",
        title: "Planejamento acadêmico ".repeat(12),
        starts_at: "2026-11-21T12:30:00.000Z",
      },
    ]);
    const encoder = new TextEncoder();

    expect(
      ics
        .split("\r\n")
        .filter(Boolean)
        .every((line) => encoder.encode(line).length <= 75),
    ).toBe(true);
    expect(ics).toContain("\r\n ");
  });
});
