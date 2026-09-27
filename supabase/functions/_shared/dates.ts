// The LLM only returns a hint ("today" | "tomorrow" | "day_after" |
// "next_<weekday>" | "this_weekend" | "YYYY-MM-DD"). The actual date math
// happens here, against the forecast's own local dates (`rows[].date`,
// which Open-Meteo already returned in the forecast location's own
// timezone via `timezone=auto` - see weather.ts). This function never
// calls `new Date()`/`Date.now()` for "today": index 0 in `rows` already
// *is* today in that place's local calendar, whatever timezone the server
// happens to be running in.
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// `rows[].date` is a plain "YYYY-MM-DD" calendar date with no time-of-day
// component, so there is no "which timezone" question for it - but
// `new Date("YYYY-MM-DD")` in JS parses that as UTC midnight, and calling
// `.getDay()` on it would then re-interpret that instant in the *server's*
// local timezone, which can roll it back a day. Using the UTC getter here
// keeps this purely calendar arithmetic on the date string itself.
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

export function resolveIndex(hint: string | undefined | null, rows: { date: string }[]): number {
  const h = (hint ?? "today").trim();
  if (!h || h === "today") return 0;
  if (h === "tomorrow") return 1;
  if (h === "day_after") return 2;

  const weekdayHint = h.match(/^next_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i);
  if (weekdayHint) {
    const target = WEEKDAYS.indexOf(weekdayHint[1].toLowerCase());
    // "next Monday" never means today, even if today happens to be Monday
    // (that would be a week out, past the 7-day forecast window) - so start
    // the search at tomorrow, not today.
    for (let i = 1; i < rows.length; i++) {
      if (weekdayOf(rows[i].date) === target) return i;
    }
    return -1; // more than a week out - outside the 7-day window
  }

  if (h === "this_weekend") {
    // "This weekend" = the nearest Saturday, which may be today if today
    // itself is a Saturday (or, in an edge case, straight to Sunday if
    // the window opens on a Sunday already inside a weekend).
    for (let i = 0; i < rows.length; i++) {
      const wd = weekdayOf(rows[i].date);
      if (wd === 6 || (i === 0 && wd === 0)) return i;
    }
    return -1;
  }

  return rows.findIndex((r) => r.date === h); // -1 = outside the 7-day window
}

// Maps a spoken time-of-day into a [startHour, endHour) local-hour window,
// used to slice the forecast's hourly array down to just that part of day.
export type TimeRange = "morning" | "afternoon" | "evening" | "night";
export function timeRangeHours(range: string | null | undefined): [number, number] | null {
  switch (range) {
    case "morning": return [6, 12];
    case "afternoon": return [12, 17];
    case "evening": return [17, 20];
    case "night": return [20, 24];
    default: return null;
  }
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
