import type { HistoryEntry } from "@/backend/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { getWebviewConfig } from "@/webview/lib/webview-config";

/** The date cell of a commit row: `value` is shown, `title` is its tooltip. */
export type CommitDate = { title: string; value: string };

/** How far from the epoch, in seconds and in either direction, a JavaScript date reaches. */
const MAX_SECONDS = 8_640_000_000_000;

type Unit = { name: Intl.RelativeTimeFormatUnit; seconds: number };

/**
 * Units of a relative date, from the smallest. A year is 365.25 days and a month a twelfth
 * of that, so the calendar is never consulted.
 */
const UNITS: ReadonlyArray<Unit> = [
  { name: "second", seconds: 1 },
  { name: "minute", seconds: 60 },
  { name: "hour", seconds: 3_600 },
  { name: "day", seconds: 86_400 },
  { name: "week", seconds: 604_800 },
  { name: "month", seconds: 2_629_800 },
  { name: "year", seconds: 31_557_600 }
];

/**
 * The day formatter of a locale and the clock that goes with it. A formatter keeps the time
 * zone it was built in, so the clock is pinned to the day's zone and the two agree even when
 * the runtime's zone changes while the page is open.
 */
type ShortDate = { day: Intl.DateTimeFormat; clock: Intl.DateTimeFormat };

// The graph formats a date for every commit it shows, so each formatter is built once per
// locale tag and kept. Keyed by the tag rather than the config object, a new locale takes
// effect on the next call however the configuration was changed.
const shortDates = new Map<string, ShortDate>();
const fullDates = new Map<string, Intl.DateTimeFormat>();
const dayNames = new Map<string, Intl.DateTimeFormat>();
const relativeTimes = new Map<string, Intl.RelativeTimeFormat>();
const secondCounts = new Map<string, Intl.NumberFormat>();

/**
 * The formatter that `cache` holds for `locale`, built on first use. Intl rejects some tags,
 * such as "en_US", and those format in the runtime's default locale. The fallback is kept
 * like any other formatter, so a rejected tag is tried only once.
 */
function formatterFor<T>(
  cache: Map<string, T>,
  locale: string,
  build: (locale: string | undefined) => T
): T {
  let formatter = cache.get(locale);
  if (formatter === undefined) {
    try {
      formatter = build(locale);
    } catch {
      formatter = build(undefined);
    }
    cache.set(locale, formatter);
  }

  return formatter;
}

/** Hours and minutes on a 24-hour clock in ASCII digits, whatever the display language uses. */
function clockIn(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat("en-US", options);
  }
}

function shortDate(locale: string): ShortDate {
  return formatterFor(shortDates, locale, (tag) => {
    const day = new Intl.DateTimeFormat(tag, { year: "numeric", month: "short", day: "numeric" });
    return { day, clock: clockIn(day.resolvedOptions().timeZone) };
  });
}

/** "HH:MM". Seconds are dropped, never rounded into the minute. */
function clockTime(clock: Intl.DateTimeFormat, date: Date): string {
  const parts = clock.formatToParts(date);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    (parts.find((part) => part.type === type)?.value ?? "").padStart(2, "0");
  return `${field("hour")}:${field("minute")}`;
}

/** The instant of a Git timestamp in seconds, or null when a JavaScript date cannot hold it. */
function toDate(seconds: number): Date | null {
  // NaN fails the comparison too. A date Git left empty is NaN in the extension, and arrives
  // here as null, because the message to the webview is JSON.
  return typeof seconds === "number" && Math.abs(seconds) <= MAX_SECONDS
    ? new Date(seconds * 1000)
    : null;
}

/**
 * How long ago `date` was, or how far ahead it is, as of now. The age is rounded once, halves
 * up, in the largest unit it has reached, so both directions read alike. A count that rounds
 * up to the next unit's size moves to that unit: "60 minutes" reads "1 hour". An age that
 * rounds to nothing reads as past, since commits a moment ahead come from a skewed clock.
 */
function relativeTo(date: Date, locale: string): string {
  const age = (Date.now() - date.getTime()) / 1000;
  const magnitude = Math.abs(age);

  // The largest unit the age has reached, or seconds while it is under one.
  const reached = Math.max(
    0,
    UNITS.findLastIndex(({ seconds }) => magnitude >= seconds)
  );
  let unit = UNITS[reached]!;
  let count = Math.round(magnitude / unit.seconds);
  const next = UNITS[reached + 1];
  if (next !== undefined && count * unit.seconds >= next.seconds) {
    unit = next;
    count = Math.round(magnitude / unit.seconds);
  }

  // Intl reads -0 as past, so a count of 0 in either direction reads "0 seconds ago".
  const signed = age < 0 && count > 0 ? count : -count;
  return formatterFor(
    relativeTimes,
    locale,
    (tag) => new Intl.RelativeTimeFormat(tag, { numeric: "always" })
  ).format(signed, unit.name);
}

/** How long ago a Git timestamp in seconds was, such as "3 days ago", in the display language. */
export function getRelativeDate(seconds: number): string {
  const date = toDate(seconds);
  return date === null ? window.l10n.unknownDate : relativeTo(date, getWebviewConfig().locale);
}

/** Whole seconds from `started` to `finished`, both in milliseconds, such as "5s". */
export function formatSeconds(started: number, finished: number): string {
  const elapsed = Math.floor((finished - started) / 1000);
  // A clock that moved backwards, or an argument that is not finite, shows zero seconds.
  const count = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const { locale } = getWebviewConfig();
  return formatterFor(
    secondCounts,
    locale,
    (tag) => new Intl.NumberFormat(tag, { style: "unit", unit: "second", unitDisplay: "narrow" })
  ).format(count);
}

/** A Git timestamp in seconds as a long date and time in the display language. */
export function getFullDate(seconds: number): string {
  const date = toDate(seconds);
  if (date === null) {
    return window.l10n.unknownDate;
  }

  const { locale } = getWebviewConfig();
  return formatterFor(
    fullDates,
    locale,
    (tag) => new Intl.DateTimeFormat(tag, { dateStyle: "full", timeStyle: "long" })
  ).format(date);
}

/**
 * The date cell of a commit with a Git timestamp in seconds. The tooltip always holds the
 * day and a 24-hour time; the `dateFormat` setting decides what the cell shows.
 */
export function getCommitDate(seconds: number): CommitDate {
  const date = toDate(seconds);
  if (date === null) {
    const unknown = window.l10n.unknownDate;
    return { title: unknown, value: unknown };
  }

  const { locale, dateFormat } = getWebviewConfig();
  const { day, clock } = shortDate(locale);
  const dayText = day.format(date);
  const title = `${dayText} ${clockTime(clock, date)}`;

  switch (dateFormat) {
    case "Date Only":
      return { title, value: dayText };
    case "Relative":
      return { title, value: relativeTo(date, locale) };
    default:
      // "Date & Time", and whatever else a hand-edited setting holds.
      return { title, value: title };
  }
}

const DAY_MS = 86_400_000;

/**
 * The calendar day of a Git timestamp in seconds in the runtime's time zone, counted in days
 * from 1 January 1970, or null when a JavaScript date cannot hold it. Each instant is shifted by
 * its own zone offset, so days next to a daylight saving change still split at local midnight.
 */
export function localDay(seconds: number): number | null {
  const date = toDate(seconds);
  return date === null
    ? null
    : Math.floor((date.getTime() - date.getTimezoneOffset() * 60_000) / DAY_MS);
}

/** The day of each row of the graph, and the rows that begin a new day. */
export type CommitDays = {
  /** The `localDay` of each row by index; null for the uncommitted changes and unknown dates. */
  days: ReadonlyArray<number | null>;
  /** Rows whose commit falls on another day than the nearest dated commit above them. */
  starts: ReadonlySet<number>;
};

/**
 * Where the days change in `commits`. Each row's `date` is already the author or the committer
 * date, as the date type setting says. The uncommitted-changes row and rows without a usable date
 * take no part, so the commit below one is compared with the commit above it, and the first
 * commit never starts a day.
 */
export function commitDays(commits: ReadonlyArray<HistoryEntry>): CommitDays {
  const days: Array<number | null> = [];
  const starts = new Set<number>();
  let previous: number | null = null;
  commits.forEach((commit, index) => {
    const day = commit.hash === UNCOMMITTED_CHANGES ? null : localDay(commit.date);
    days.push(day);
    if (day === null) {
      return;
    }
    if (previous !== null && day !== previous) {
      starts.add(index);
    }
    previous = day;
  });
  return { days, starts };
}

/** A day from `localDay` in full in the display language, such as "Tuesday, 6 October 2026". */
export function getDayName(day: number): string {
  // The day is already local: formatting its midnight as UTC keeps any zone from moving it.
  const date = new Date(day * DAY_MS);
  if (Number.isNaN(date.getTime())) {
    return window.l10n.unknownDate;
  }
  const { locale } = getWebviewConfig();
  return formatterFor(
    dayNames,
    locale,
    (tag) => new Intl.DateTimeFormat(tag, { dateStyle: "full", timeZone: "UTC" })
  ).format(date);
}
