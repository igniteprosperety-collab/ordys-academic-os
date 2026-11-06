// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

// Server logs retain diagnostic identifiers and stack frames, but never free-form
// exception messages or arbitrary objects that may contain request/user data.
const CAUSE_DEPTH_LIMIT = 5;
const DESCRIPTION_LENGTH_LIMIT = 8_000;
const STACK_FRAME_LIMIT = 12;
const STACK_FRAME_LENGTH_LIMIT = 300;

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT && current != null; depth++) {
    const label = depth === 0 ? "" : "caused by: ";
    if (!(current instanceof Error)) {
      parts.push(`${label}[non-error cause omitted]`);
      break;
    }

    const name = safeErrorName(current.name);
    const status = describeStatus(current);
    const frames = safeStackFrames(current);
    parts.push(`${label}${name}${status}${frames.length ? `\n${frames.join("\n")}` : ""}`);
    current = current.cause;
  }

  return parts.join("\n").slice(0, DESCRIPTION_LENGTH_LIMIT);
}

function safeErrorName(name: string) {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(name) ? name : "Error";
}

function redactStackFrame(line: string) {
  const queryStart = line.indexOf("?");
  if (queryStart < 0) return line.slice(0, STACK_FRAME_LENGTH_LIMIT);

  const hasClosingParen = line.endsWith(")");
  const location = hasClosingParen ? line.slice(0, -1) : line;
  const columnSeparator = location.lastIndexOf(":");
  const lineSeparator = location.lastIndexOf(":", columnSeparator - 1);
  const hasLineAndColumn =
    lineSeparator > queryStart &&
    /^\d+$/.test(location.slice(lineSeparator + 1, columnSeparator)) &&
    /^\d+$/.test(location.slice(columnSeparator + 1));
  const suffixStart = hasLineAndColumn
    ? lineSeparator
    : hasClosingParen
      ? line.length - 1
      : line.length;

  return (
    line.slice(0, queryStart) +
    "?[redacted]" +
    line.slice(suffixStart)
  ).slice(0, STACK_FRAME_LENGTH_LIMIT);
}

function safeStackFrames(error: Error) {
  if (typeof error.stack !== "string") return [];
  return error.stack
    .split("\n")
    .slice(1)
    .filter((line) => /^\s*at\s+/.test(line))
    .slice(0, STACK_FRAME_LIMIT)
    .map(redactStackFrame);
}

function describeStatus(error: Error): string {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" && Number.isFinite(value) ? ` (status ${value})` : "";
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

// Wrap console.error so h3 and application failures retain useful stack frames
// without serializing arbitrary objects or user/provider-controlled messages.
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const expanded = args.map((arg) => {
    if (isErrorLike(arg)) {
      record(arg);
      return describeError(arg);
    }
    if (
      arg === null ||
      arg === undefined ||
      typeof arg === "string" ||
      typeof arg === "number" ||
      typeof arg === "boolean"
    ) {
      return arg;
    }
    return "[non-error diagnostic omitted]";
  });
  originalConsoleError(...expanded);
};

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
