/** Local wall-clock parts of an instant in a time zone (no date library needed). */
export function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** Quiet hours wrap midnight when start > end (e.g. 22 → 7). start === end means none. */
export function inQuietHours(hour: number, start: number, end: number) {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * If `at` falls in quiet hours, the first quarter-hour after they end (DST-safe:
 * walks forward instead of doing calendar math). Otherwise `at` unchanged.
 */
export function afterQuietHours(at: Date, timeZone: string, start: number, end: number) {
  let t = at;
  for (let i = 0; i < 24 * 4 && inQuietHours(localParts(t, timeZone).hour, start, end); i++) {
    t = new Date(t.getTime() + 15 * 60_000);
  }
  return t;
}
