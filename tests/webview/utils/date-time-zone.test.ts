// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getWebviewConfig } from "@/webview/lib/webview-config";
import { getCommitDate, getFullDate } from "@/webview/utils/date";

import { setupWebviewTest } from "@tests/webview/test-utils";

// A formatter keeps the zone it was built in, so these cases have a file of their own and set
// the zone before anything formats.

/** The runtime's local time of the epoch, read with a formatter built just now. */
function localEpoch() {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(0);
}

let zoneApplied = false;

beforeAll(() => {
  vi.stubEnv("TZ", "Asia/Kolkata");
  zoneApplied = localEpoch() === "05:30";
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
  Object.assign(getWebviewConfig(), { locale: "en", dateFormat: "Date & Time" });
});

describe("local time zone", () => {
  it("shows commit dates in the runtime's zone", () => {
    expect(getCommitDate(0)).toEqual({ title: "Jan 1, 1970 05:30", value: "Jan 1, 1970 05:30" });
    expect(getCommitDate(1_700_000_000).title).toBe("Nov 15, 2023 03:43");
    Object.assign(getWebviewConfig(), { dateFormat: "Date Only" });
    expect(getCommitDate(1_700_000_000).value).toBe("Nov 15, 2023");
  });

  it("shows full dates in the runtime's zone", () => {
    Object.assign(getWebviewConfig(), { locale: "en-GB" });
    expect(getFullDate(0)).toBe("Thursday, 1 January 1970 at 05:30:00 GMT+5:30");
  });

  it("keeps a tooltip's day and time in one zone when the runtime's zone changes", () => {
    // 22:08 on 14 November in UTC is 03:38 on 15 November in Kolkata.
    const seconds = 1_699_999_700;
    expect(getCommitDate(seconds).title).toBe("Nov 15, 2023 03:38");
    vi.stubEnv("TZ", "UTC");
    try {
      // Formatters built earlier may keep their zone or follow the new one, but never mix the two.
      expect(["Nov 15, 2023 03:38", "Nov 14, 2023 22:08"]).toContain(getCommitDate(seconds).title);
      // A display language used for the first time shows that the zone did change.
      Object.assign(getWebviewConfig(), { locale: "en-US" });
      expect(getCommitDate(seconds).title).toBe("Nov 14, 2023 22:08");
    } finally {
      vi.stubEnv("TZ", "Asia/Kolkata");
    }
  });
});
