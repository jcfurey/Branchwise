// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitNode } from "@/backend/types";
import { ErrorBoundary } from "@/webview/components/ui/ErrorBoundary";
import { GraphView } from "@/webview/layout/GraphView";
import { refresh } from "@/webview/lib/actions";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import * as stores from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import { formatSeconds, getCommitDate, getFullDate } from "@/webview/utils/date";

import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

// Git accepts each of these; none fits in a JavaScript date.
const OUT_OF_RANGE = [99_999_999_999_999, -99_999_999_999_999, Number.NaN, Infinity];

const FORMATS = ["Date & Time", "Date Only", "Relative"] as const;

/** The clock of the relative cases: 2023-11-14 22:13:20 UTC. */
const NOW = 1_700_000_000_000;
/** NOW as a Git timestamp. */
const NOW_SECONDS = NOW / 1000;

beforeAll(() => {
  // A formatter keeps the zone it was built in, so the zone is set before anything formats.
  vi.stubEnv("TZ", "UTC");
  setupWebviewTest();
});

afterAll(() => vi.unstubAllEnvs());

afterEach(() => {
  Object.assign(getWebviewConfig(), { locale: "en", dateFormat: "Date & Time" });
  vi.useRealTimers();
});

/** Change the settings the date exports read. Each case ends with the defaults again. */
function configure(settings: { locale?: string; dateFormat?: string }) {
  Object.assign(getWebviewConfig(), settings);
}

/** Relative dates are measured from the clock, so it stands still at NOW. */
function stopClock() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

/** Some ICU versions put U+202F before "AM" and "PM"; others a plain space. */
function plainSpaces(text: string) {
  return text.replaceAll(/\s/gu, " ");
}

describe("date formatting", () => {
  it.each(["Date & Time", "Date Only", "Relative"] as const)(
    "shows a placeholder for unrepresentable dates in the %s format",
    (dateFormat) => {
      Object.assign(getWebviewConfig(), { dateFormat });
      for (const seconds of OUT_OF_RANGE) {
        expect(getCommitDate(seconds)).toEqual({ title: "unknownDate", value: "unknownDate" });
        expect(getFullDate(seconds)).toBe("unknownDate");
      }
      expect(getCommitDate(0).value).not.toBe("unknownDate");
      expect(getFullDate(8_640_000_000_000)).not.toBe("unknownDate");
    }
  );

  it("shows a placeholder for a date that JSON turned from NaN into null", () => {
    // The graph's log query gives NaN for a date Git left empty; postMessage sends it as null.
    const [arrived] = JSON.parse(JSON.stringify([Number.NaN])) as [number];
    expect(arrived).toBeNull();
    expect(getCommitDate(arrived)).toEqual({ title: "unknownDate", value: "unknownDate" });
    expect(getFullDate(arrived)).toBe("unknownDate");
  });
});

describe("elapsed time", () => {
  it("counts whole seconds in the display language's units", () => {
    const config = getWebviewConfig();
    const { locale } = config;
    try {
      expect(formatSeconds(1000, 6999)).toBe("5s");
      // A clock that moved backwards shows no time rather than a negative one.
      expect(formatSeconds(5000, 1000)).toBe("0s");
      Object.assign(config, { locale: "de" });
      expect(formatSeconds(0, 5000)).toBe("5 Sek.");
      Object.assign(config, { locale: "zh-CN" });
      expect(formatSeconds(0, 5000)).toBe("5秒");
    } finally {
      Object.assign(config, { locale });
    }
  });

  it.each([
    [0, 999, "0s"],
    [0, 1000, "1s"],
    [0, 1999.9, "1s"],
    [1.5, 1001.4, "0s"],
    [0, 59_999, "59s"],
    [0, 60_000, "60s"],
    [0, 3_600_000, "3,600s"],
    [0, 86_400_000, "86,400s"],
    [0, -1, "0s"],
    [1000, 1000, "0s"],
    [0, 1_234_567_000, "1,234,567s"]
  ])("counts %s to %s ms as %j, never in larger units", (started, finished, text) => {
    expect(formatSeconds(started, finished)).toBe(text);
  });

  it.each([
    ["ru", 5000, "5 с"],
    ["pt-br", 5000, "5 s"],
    ["de", 1_234_567_000, "1.234.567 Sek."]
  ])("groups and names seconds the %s way", (locale, finished, text) => {
    configure({ locale });
    expect(formatSeconds(0, finished)).toBe(text);
  });

  it.each([
    [0, Infinity],
    [-Infinity, 0],
    [0, Number.NaN],
    [Number.NaN, 0],
    [Infinity, Infinity]
  ])("shows zero seconds from %s to %s, which is not a finite time", (started, finished) => {
    expect(formatSeconds(started, finished)).toBe("0s");
    configure({ locale: "de" });
    expect(formatSeconds(started, finished)).toBe("0 Sek.");
  });
});

describe("commit dates", () => {
  it("shows the day and a 24-hour time, dropping the seconds", () => {
    expect(getCommitDate(0)).toEqual({ title: "Jan 1, 1970 00:00", value: "Jan 1, 1970 00:00" });
    expect(getCommitDate(1_700_000_000)).toEqual({
      title: "Nov 14, 2023 22:13",
      value: "Nov 14, 2023 22:13"
    });
    expect(getCommitDate(59).title).toBe("Jan 1, 1970 00:00");
    expect(getCommitDate(60).title).toBe("Jan 1, 1970 00:01");
    expect(getCommitDate(-1).title).toBe("Dec 31, 1969 23:59");
  });

  it("shows the day alone in the Date Only format", () => {
    configure({ dateFormat: "Date Only" });
    expect(getCommitDate(1_700_000_000)).toEqual({
      title: "Nov 14, 2023 22:13",
      value: "Nov 14, 2023"
    });
  });

  it("treats a format it does not know as Date & Time", () => {
    configure({ dateFormat: "Something Else" });
    expect(getCommitDate(1_700_000_000)).toEqual({
      title: "Nov 14, 2023 22:13",
      value: "Nov 14, 2023 22:13"
    });
  });

  it.each([
    ["en-US", "Nov 14, 2023 22:13"],
    ["en-US-u-hc-h12", "Nov 14, 2023 22:13"],
    ["en-GB", "14 Nov 2023 22:13"],
    ["de", "14. Nov. 2023 22:13"],
    ["zh-CN", "2023年11月14日 22:13"],
    ["ko", "2023년 11월 14일 22:13"],
    ["ar-EG", "١٤ نوفمبر ٢٠٢٣ 22:13"],
    ["de-DE-u-nu-arab", "١٤. Nov. ٢٠٢٣ 22:13"]
  ])("writes the tooltip's time on a 24-hour clock in ASCII digits in %s", (locale, title) => {
    configure({ locale });
    expect(getCommitDate(1_700_000_000).title).toBe(title);
  });

  it("formats the furthest dates a JavaScript date holds", () => {
    expect(getCommitDate(8_640_000_000_000)).toEqual({
      title: "Sep 13, 275760 00:00",
      value: "Sep 13, 275760 00:00"
    });
    expect(getCommitDate(-8_640_000_000_000).title).toBe("Apr 20, 271822 00:00");
  });

  it.each(FORMATS)(
    "shows a placeholder for dates just past those in the %s format",
    (dateFormat) => {
      configure({ dateFormat });
      for (const seconds of [
        8_640_000_000_001,
        -8_640_000_000_001,
        8_640_000_000_000.001,
        -Infinity
      ]) {
        expect(getCommitDate(seconds)).toEqual({ title: "unknownDate", value: "unknownDate" });
        expect(getFullDate(seconds)).toBe("unknownDate");
      }
    }
  );

  it("follows a change of display language", () => {
    expect(getCommitDate(1_700_000_000).title).toBe("Nov 14, 2023 22:13");
    configure({ locale: "de" });
    expect(getCommitDate(1_700_000_000).title).toBe("14. Nov. 2023 22:13");
    expect(getFullDate(1_700_000_000)).toBe("Dienstag, 14. November 2023 um 22:13:20 UTC");
    configure({ locale: "en" });
    expect(getCommitDate(1_700_000_000).title).toBe("Nov 14, 2023 22:13");
  });
});

describe("full dates", () => {
  it.each([
    ["en-GB", "Tuesday, 14 November 2023 at 22:13:20 UTC"],
    ["de", "Dienstag, 14. November 2023 um 22:13:20 UTC"],
    ["zh-CN", "2023年11月14日星期二 UTC 22:13:20"]
  ])("writes the weekday, day and time with seconds in %s", (locale, text) => {
    configure({ locale });
    expect(getFullDate(1_700_000_000)).toBe(text);
  });

  it("drops fractions of a second instead of rounding them", () => {
    expect(plainSpaces(getFullDate(0))).toBe("Thursday, January 1, 1970 at 12:00:00 AM UTC");
    expect(plainSpaces(getFullDate(1.9))).toBe("Thursday, January 1, 1970 at 12:00:01 AM UTC");
  });

  it("formats the earliest date a JavaScript date holds", () => {
    expect(plainSpaces(getFullDate(-8_640_000_000_000))).toBe(
      "Tuesday, April 20, 271822 at 12:00:00 AM UTC"
    );
  });
});

describe("relative dates", () => {
  beforeEach(() => {
    stopClock();
    configure({ dateFormat: "Relative" });
  });

  /** The cell of a commit made `age` seconds before NOW; a negative age is in the future. */
  const aged = (age: number) => getCommitDate(NOW_SECONDS - age).value;

  it.each([
    [0, "0 seconds ago"],
    [1, "1 second ago"],
    [59, "59 seconds ago"],
    [60, "1 minute ago"],
    [3600, "1 hour ago"],
    [5399, "1 hour ago"],
    [5400, "2 hours ago"],
    [86_400, "1 day ago"],
    [129_600, "2 days ago"],
    [604_800, "1 week ago"],
    [907_200, "2 weeks ago"],
    [2_419_200, "4 weeks ago"],
    [2_629_799, "4 weeks ago"],
    [2_629_800, "1 month ago"],
    [2_678_400, "1 month ago"],
    [31_557_600, "1 year ago"],
    [47_336_399, "1 year ago"],
    [315_576_000, "10 years ago"],
    [1_700_000_000, "54 years ago"],
    [-1, "in 1 second"],
    [-60, "in 1 minute"],
    [-3600, "in 1 hour"],
    [-259_200, "in 3 days"],
    [-604_800, "in 1 week"],
    [-2_629_800, "in 1 month"],
    [-31_557_600, "in 1 year"]
  ])("reads an age of %s s as %j", (age, value) => {
    expect(aged(age)).toBe(value);
  });

  // A count never reaches the size of the next unit; weeks stop at 4 because a month is longer.
  it.each([
    [59.4, "59 seconds ago"],
    [59.5, "1 minute ago"],
    [3569, "59 minutes ago"],
    [3570, "1 hour ago"],
    [3599, "1 hour ago"],
    [84_599, "23 hours ago"],
    [84_600, "1 day ago"],
    [86_399, "1 day ago"],
    [561_599, "6 days ago"],
    [561_600, "1 week ago"],
    [604_799, "1 week ago"],
    [30_242_699, "11 months ago"],
    [30_242_700, "1 year ago"],
    [31_557_599, "1 year ago"],
    [-3570, "in 1 hour"],
    [-86_399, "in 1 day"],
    [-561_600, "in 1 week"],
    [-2_629_799, "in 4 weeks"],
    [-31_557_599, "in 1 year"]
  ])("moves an age of %s s that would fill its unit up to the next: %j", (age, value) => {
    expect(aged(age)).toBe(value);
  });

  // The age is rounded once, halves up in size, so the past and the future read alike.
  it.each([
    [89, "1 minute ago"],
    [89.5, "1 minute ago"],
    [-89.5, "in 1 minute"],
    [90, "2 minutes ago"],
    [-90, "in 2 minutes"],
    [-91, "in 2 minutes"],
    [-59.5, "in 1 minute"],
    [-59.6, "in 1 minute"],
    [47_336_400, "2 years ago"],
    [-47_336_400, "in 2 years"]
  ])("rounds an age of %s s the same way in either direction: %j", (age, value) => {
    expect(aged(age)).toBe(value);
  });

  it.each([
    [0.4, "0 seconds ago"],
    [-0.4, "0 seconds ago"],
    [0.5, "1 second ago"],
    [-0.5, "in 1 second"],
    [-0.6, "in 1 second"]
  ])("reads an age of %s s that rounds to nothing as past: %j", (age, value) => {
    expect(aged(age)).toBe(value);
  });

  it("reads a commit a moment ahead as past in the display language", () => {
    configure({ locale: "de" });
    expect(aged(-0.4)).toBe("vor 0 Sekunden");
    configure({ locale: "en" });
    vi.setSystemTime(NOW + 999);
    expect(getCommitDate(NOW_SECONDS).value).toBe("1 second ago");
    expect(getCommitDate(NOW_SECONDS + 1).value).toBe("0 seconds ago");
  });

  it("keeps the absolute date in the tooltip", () => {
    expect(getCommitDate(NOW_SECONDS - 300).title).toBe("Nov 14, 2023 22:08");
  });

  it("groups large counts", () => {
    expect(getCommitDate(8_640_000_000_000).value).toBe("in 273,731 years");
    expect(getCommitDate(-8_640_000_000_000).value).toBe("273,839 years ago");
  });

  it.each([
    ["de", 300, "vor 5 Minuten"],
    ["de", 86_400, "vor 1 Tag"],
    ["de", -300, "in 5 Minuten"],
    ["zh-CN", 300, "5分钟前"],
    ["zh-CN", -86_400, "1天后"]
  ])("words the age in %s: %s s reads %j", (locale, age, value) => {
    configure({ locale });
    expect(aged(age)).toBe(value);
  });

  it("reads the clock on each call", () => {
    expect(aged(0)).toBe("0 seconds ago");
    vi.advanceTimersByTime(60_000);
    expect(aged(0)).toBe("1 minute ago");
  });
});

describe("display languages Intl rejects", () => {
  /** One of each output, for a commit five minutes before NOW. */
  function sample() {
    return [
      formatSeconds(0, 5000),
      getFullDate(NOW_SECONDS),
      ...FORMATS.map((dateFormat) => {
        configure({ dateFormat });
        return getCommitDate(NOW_SECONDS - 300);
      })
    ];
  }

  it.each(["en_US", "", "not a locale!!", "i-klingon", "en-"])(
    "formats %j in the runtime's default language",
    (locale) => {
      stopClock();
      configure({ locale: new Intl.DateTimeFormat().resolvedOptions().locale });
      const expected = sample();
      configure({ locale });
      expect(sample()).toEqual(expected);
    }
  );
});

describe("formatter reuse", () => {
  const constructors = {
    DateTimeFormat: Intl.DateTimeFormat,
    NumberFormat: Intl.NumberFormat,
    RelativeTimeFormat: Intl.RelativeTimeFormat
  };
  const built = new Map<string, number>();

  // `vi.spyOn` on these constructors breaks `new` under Vitest 4, so a proxy counts them. The
  // clock runs here: fake timers replace `Intl` itself, which would hide the proxies.
  beforeEach(() => {
    built.clear();
    for (const [name, constructor] of Object.entries(constructors)) {
      const counted = new Proxy(constructor, {
        construct(target, args, newTarget) {
          built.set(name, (built.get(name) ?? 0) + 1);
          return Reflect.construct(target, args, newTarget);
        }
      });
      Object.defineProperty(Intl, name, { value: counted, configurable: true, writable: true });
    }
  });

  afterEach(() => {
    for (const [name, constructor] of Object.entries(constructors)) {
      Object.defineProperty(Intl, name, { value: constructor, configurable: true, writable: true });
    }
  });

  /** Call each export `times` times for a commit five minutes before NOW. */
  function formatEach(times: number) {
    for (let call = 0; call < times; call += 1) {
      getCommitDate(NOW_SECONDS - 300);
      getFullDate(NOW_SECONDS);
      formatSeconds(0, 5000);
    }
  }

  it("builds the formatters of a display language once", () => {
    configure({ locale: "fr-CA", dateFormat: "Relative" });
    formatEach(1);
    const first = new Map(built);
    expect([...first.keys()].toSorted()).toEqual(Object.keys(constructors));
    formatEach(500);
    expect(built).toEqual(first);
  });

  it("does not try a display language Intl rejects again", () => {
    configure({ locale: "not a locale!!", dateFormat: "Relative" });
    formatEach(1);
    const first = new Map(built);
    formatEach(500);
    expect(built).toEqual(first);
  });
});

describe("graph rendering", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    resetGraphRequests();
    stores.selectedRepo.value = "/repo";
    stores.selectedBranch.value = "*";
    stores.commitList.value = undefined;
    stores.expandedCommit.value = null;
    container = document.createElement("div");
    document.body.append(container);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => {
    act(() => render(null, container));
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders every row when one commit has an out-of-range date", () => {
    const commits: GitCommitNode[] = [
      {
        hash: "b".repeat(40),
        parentHashes: ["a".repeat(40)],
        author: "A",
        email: "a@x",
        date: 99_999_999_999_999,
        message: "far future",
        refs: []
      },
      {
        hash: "a".repeat(40),
        parentHashes: [],
        author: "A",
        email: "a@x",
        date: 0,
        message: "epoch",
        refs: []
      }
    ];
    refresh();
    act(() => {
      handleLoadCommits({
        ...latestGraphRequest("loadCommits"),
        commits,
        head: commits[0]!.hash,
        moreCommitsAvailable: false,
        uncommittedChanges: 0
      });
      render(h(GraphView, {}), container);
    });
    const text = container.textContent ?? "";
    expect(text).toContain("far future");
    expect(text).toContain("epoch");
    expect(text).toContain("unknownDate");
  });

  it("replaces only a failing view with its error and a retry", () => {
    let fail = true;
    function Fragile() {
      if (fail) {
        throw new Error("cannot draw");
      }
      return h("p", null, "drawn");
    }
    act(() =>
      render(
        h("div", null, h("span", null, "header"), h(ErrorBoundary, null, h(Fragile, null))),
        container
      )
    );
    expect(container.textContent).toContain("header");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("viewFailedretryView");
    fail = false;
    act(() => container.querySelector("button")!.click());
    expect(container.textContent).toBe("headerdrawn");
  });
});
