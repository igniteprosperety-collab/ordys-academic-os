export type CalendarIcsEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  kind?: string | null;
};

type CalendarIcsOptions = {
  now?: Date;
};

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toIcsUtcDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function foldIcsLine(line: string) {
  const output: string[] = [];
  const encoder = new TextEncoder();
  let current = "";
  let byteLength = 0;

  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (byteLength + characterBytes > 75 && current) {
      output.push(current);
      current = ` ${character}`;
      byteLength = 1 + characterBytes;
    } else {
      current += character;
      byteLength += characterBytes;
    }
  }

  output.push(current);
  return output.join("\r\n");
}

export function buildCalendarIcs(events: CalendarIcsEvent[], options: CalendarIcsOptions = {}) {
  const stamp = toIcsUtcDate(options.now ?? new Date()) ?? toIcsUtcDate(new Date())!;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ORDYS Academy//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ORDYS Academy",
  ];

  const sortedEvents = [...events].sort((a, b) => {
    const aTime = new Date(a.starts_at).getTime();
    const bTime = new Date(b.starts_at).getTime();
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : 0;
    if (!Number.isFinite(bTime)) return -1;
    return aTime - bTime;
  });
  for (const event of sortedEvents) {
    const title = event.title.trim();
    const startsAt = toIcsUtcDate(event.starts_at);
    if (!event.id || !title || !startsAt) continue;

    const startMs = new Date(event.starts_at).getTime();
    const endMs = event.ends_at ? new Date(event.ends_at).getTime() : NaN;
    const endsAt = Number.isFinite(endMs) && endMs > startMs ? toIcsUtcDate(event.ends_at!) : null;

    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@ordys.academy`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${startsAt}`,
    );
    if (endsAt) lines.push(`DTEND:${endsAt}`);
    lines.push(`SUMMARY:${escapeIcsText(title)}`);

    const details = event.kind?.trim();
    if (details) lines.push(`DESCRIPTION:${escapeIcsText(details)}`);

    const location = event.location?.trim();
    if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);

    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(`${title} começa em 10 minutos`)}`,
      "TRIGGER:-PT10M",
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
