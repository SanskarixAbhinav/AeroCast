// The LLM only returns a hint ("today" | "tomorrow" | "day_after" | "YYYY-MM-DD").
// The actual date math happens here, against the forecast's own local dates.
export function resolveIndex(hint: string | undefined | null, rows: { date: string }[]): number {
  const h = (hint ?? "today").trim();
  if (!h || h === "today") return 0;
  if (h === "tomorrow") return 1;
  if (h === "day_after") return 2;
  return rows.findIndex((r) => r.date === h); // -1 = outside the 7-day window
}


// Archive data lags a few days behind today.
const ARCHIVE_LAG_DAYS = 5;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function clampHistory(start?: string | null, end?: string | null): { start: string; end: string } | null {
  if (!start || !end || !ISO.test(start) || !ISO.test(end)) return null;
  const latest = new Date(Date.now() - ARCHIVE_LAG_DAYS * 864e5).toISOString().slice(0, 10);
  const e = end > latest ? latest : end;
  if (start > e || start < "1940-01-01") return null;
  if ((Date.parse(e) - Date.parse(start)) / 864e5 > 366) return null; // keep ranges small
  return { start, end: e };
}
