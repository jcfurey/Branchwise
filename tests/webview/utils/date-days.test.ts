// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DateType } from "@/backend/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import { commitDays, getDayName, localDay } from "@/webview/utils/date";

import { entry } from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

// Days split at local midnight, so these cases set the zone before anything reads a date, as
// date-time-zone.test.ts does. Kolkata is 5:30 ahead of UTC and keeps no daylight saving time.

/** Seconds since the epoch of an ISO 8601 instant. */
const at = (iso: string) => Date.parse(iso) / 1000;

let zoneApplied = false;

beforeAll(() => {
  vi.stubEnv("TZ", "Asia/Kolkata");
  zoneApplied = new Date(0).getHours() === 5;
  setupWebviewTest();
});

afterAll(() => vi.unstubAllEnvs());

beforeEach((context) => {
  // Node takes a new TZ while running on Linux and macOS. Where it cannot, there is nothing to check.
  if (!zoneApplied) {
    context.skip();
  }
});

afterEach(() => {
  Object.assign(getWebviewConfig(), { locale: "en" });
});

describe("localDay", () => {
  it("starts a new day at local midnight, not at midnight UTC", () => {
    // 23:59 and 00:01 in Kolkata, both on 5 October in UTC.
    const before = localDay(at("2026-10-05T18:29:00Z"));
    const after = localDay(at("2026-10-05T18:31:00Z"));
    expect(after).toBe(before! + 1);
    // 05:00 and 20:00 UTC on different UTC days, both on 6 October in Kolkata.
    expect(localDay(at("2026-10-05T23:00:00Z"))).toBe(after);
    expect(localDay(at("2026-10-06T14:00:00Z"))).toBe(after);
  });

  it("has no day for a date that is missing or out of range", () => {
    expect(localDay(Number.NaN)).toBeNull();
    expect(localDay(null as unknown as number)).toBeNull();
    expect(localDay(9e15)).toBeNull();
  });
});

describe("getDayName", () => {
  it("names the local day in full in the display language", () => {
    Object.assign(getWebviewConfig(), { locale: "en-GB" });
    // 00:30 on 6 October in Kolkata is still 5 October in UTC. ICU versions differ on the comma.
    expect(getDayName(localDay(at("2026-10-05T19:00:00Z"))!)).toMatch(/^Tuesday,? 6 October 2026$/);
    Object.assign(getWebviewConfig(), { locale: "en-US" });
    expect(getDayName(localDay(at("2026-10-05T19:00:00Z"))!)).toBe("Tuesday, October 6, 2026");
  });
});

describe("commitDays", () => {
  it("marks the first commit of each day below a later day, and never the first row", () => {
    const rows = [
      entry("a", ["b"], { date: at("2026-10-06T10:00:00Z") }),
      entry("b", ["c"], { date: at("2026-10-05T18:31:00Z") }),
      entry("c", ["d"], { date: at("2026-10-05T18:29:00Z") }),
      entry("d", ["e"], { date: at("2026-10-05T04:00:00Z") }),
      entry("e", [], { date: at("2026-10-01T04:00:00Z") })
    ];
    const { days, starts } = commitDays(rows);
    expect([...starts]).toEqual([2, 4]);
    expect(days[0]).toBe(days[1]);
    expect(days[2]).toBe(days[3]);
  });

  it("follows whichever date the date type setting put on the rows", () => {
    // B was written on 1 October and rebased with A on 3 October; A was written on 2 October.
    const written = { a: at("2026-10-02T06:00:00Z"), b: at("2026-10-01T06:00:00Z") };
    const rebased = { a: at("2026-10-03T06:05:00Z"), b: at("2026-10-03T06:00:00Z") };
    const rows = (dateType: DateType) => {
      const dates = dateType === "Author Date" ? written : rebased;
      return [entry("a", ["b"], { date: dates.a }), entry("b", [], { date: dates.b })];
    };
    expect([...commitDays(rows("Author Date")).starts]).toEqual([1]);
    expect([...commitDays(rows("Commit Date")).starts]).toEqual([]);
  });

  it("leaves the uncommitted changes and undated rows out of the comparison", () => {
    const rows = [
      entry(UNCOMMITTED_CHANGES, [], { date: at("2026-10-07T10:00:00Z") }),
      entry("a", ["b"], { date: at("2026-10-06T10:00:00Z") }),
      entry("b", ["c"], { date: Number.NaN }),
      entry("c", ["d"], { date: at("2026-10-06T08:00:00Z") }),
      entry("d", [], { date: at("2026-10-05T08:00:00Z") })
    ];
    const { days, starts } = commitDays(rows);
    // The first commit sits below the uncommitted row and starts nothing; c is compared with a.
    expect([...starts]).toEqual([4]);
    expect(days[0]).toBeNull();
    expect(days[2]).toBeNull();
  });

  it("finds no boundary in an empty list or a single day", () => {
    expect(commitDays([]).starts.size).toBe(0);
    const day = [entry("a", ["b"], { date: 1 }), entry("b", [], { date: 0 })];
    expect(commitDays(day).starts.size).toBe(0);
  });
});
