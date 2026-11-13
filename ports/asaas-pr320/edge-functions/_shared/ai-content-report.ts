export type AiContentReportSource = "assistant" | "quiz";
export type AiContentReportReason =
  | "offensive"
  | "unsafe"
  | "inaccurate"
  | "personal_data"
  | "other";

export type AiContentReport = {
  source: AiContentReportSource;
  reason: AiContentReportReason;
  content: string;
  details: string | null;
};

const SOURCES = new Set<AiContentReportSource>(["assistant", "quiz"]);
const REASONS = new Set<AiContentReportReason>([
  "offensive",
  "unsafe",
  "inaccurate",
  "personal_data",
  "other",
]);

export const AI_CONTENT_REPORT_LIMITS = {
  requestBytes: 96 * 1024,
  contentChars: 20_000,
  detailsChars: 600,
  perUserPerHour: 10,
} as const;

export function parseAiContentReport(value: unknown):
  | { ok: true; report: AiContentReport }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Invalid report payload." };
  }

  const row = value as Record<string, unknown>;
  const source = typeof row["source"] === "string" ? row["source"] : "";
  const reason = typeof row["reason"] === "string" ? row["reason"] : "";
  const content = typeof row["content"] === "string" ? row["content"].trim() : "";
  const details = typeof row["details"] === "string" ? row["details"].trim() : "";
  if (row["details"] !== undefined && row["details"] !== null && typeof row["details"] !== "string") {
    return { ok: false, error: "Additional details must be text." };
  }

  if (!SOURCES.has(source as AiContentReportSource)) {
    return { ok: false, error: "Invalid report source." };
  }
  if (!REASONS.has(reason as AiContentReportReason)) {
    return { ok: false, error: "Invalid report reason." };
  }
  if (!content || content.length > AI_CONTENT_REPORT_LIMITS.contentChars) {
    return { ok: false, error: "Reported content is empty or too long." };
  }
  if (details.length > AI_CONTENT_REPORT_LIMITS.detailsChars) {
    return { ok: false, error: "Additional details are too long." };
  }

  return {
    ok: true,
    report: {
      source: source as AiContentReportSource,
      reason: reason as AiContentReportReason,
      content,
      details: details || null,
    },
  };
}
