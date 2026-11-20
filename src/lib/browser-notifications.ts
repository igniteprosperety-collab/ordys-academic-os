export type BrowserNotificationRow = {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
};

export type BrowserNotificationStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_PREFIX = "ordys_browser_notifications_v1:";
const MAX_SEEN_IDS = 200;
const MAX_DELIVERY_AGE_MS = 3 * 60 * 1000;

function resolveStorage(storage?: BrowserNotificationStorage | null) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readSeenIds(storage: BrowserNotificationStorage, key: string) {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { initialized: false, ids: [] as string[] };
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
      return { initialized: false, ids: [] as string[] };
    }
    return { initialized: true, ids: value as string[] };
  } catch {
    return { initialized: false, ids: [] as string[] };
  }
}

/**
 * Establishes a per-account baseline on first use, then returns only fresh
 * notification rows that have not previously been delivered by this browser.
 * Older notifications remain available in the in-app center but are not replayed.
 */
export function collectFreshBrowserNotifications(
  userId: string,
  rows: readonly BrowserNotificationRow[],
  storage?: BrowserNotificationStorage | null,
  nowMs = Date.now(),
): BrowserNotificationRow[] {
  if (!userId) return [];
  const target = resolveStorage(storage);
  if (!target) return [];

  const key = `${STORAGE_PREFIX}${userId}`;
  const state = readSeenIds(target, key);
  const seen = new Set(state.ids);
  const fresh = state.initialized
    ? rows.filter((row) => {
        if (!row.id || seen.has(row.id)) return false;
        const createdAt = Date.parse(row.created_at);
        return (
          Number.isFinite(createdAt) &&
          nowMs - createdAt >= 0 &&
          nowMs - createdAt <= MAX_DELIVERY_AGE_MS
        );
      })
    : [];

  for (const row of rows) {
    if (row.id) seen.add(row.id);
  }

  try {
    target.setItem(key, JSON.stringify([...seen].slice(-MAX_SEEN_IDS)));
  } catch {
    // The in-app notification center remains available without browser storage.
  }

  return fresh;
}
