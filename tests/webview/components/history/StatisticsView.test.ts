// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Statistics } from "@/backend/types";
import {
  activityLevel,
  dayKey,
  initials,
  StatisticsView
} from "@/webview/components/history/StatisticsView";
import { activeTab, historyFilter, showTab } from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import {
  lastQuery,
  reply,
  resetGraphView
} from "@tests/webview/components/commit/graph-view-harness";
import { setupWebviewTest } from "@tests/webview/test-utils";

let host: HTMLDivElement;

function statistics(patch: Partial<Statistics> = {}): Statistics {
  return {
    commits: 4,
    activeDays: 3,
    first: 1_700_000_000,
    last: 1_700_500_000,
    contributors: [
      {
        name: "Ann Lee",
        email: "ann@x.test",
        commits: 3,
        first: 1_700_000_000,
        last: 1_700_500_000
      },
      { name: "bob", email: "bob@x.test", commits: 1, first: 1_700_100_000, last: 1_700_100_000 }
    ],
    activity: { [dayKey(new Date())]: 2 },
    lines: false,
    ...patch
  };
}

const answer = (data: Statistics) =>
  reply(lastQuery("statistics"), { data: { kind: "statistics", statistics: data } });

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphView();
  stores.branchList.value = ["main", "topic", "remotes/origin/main"];
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(h(StatisticsView, {}), host));
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  showTab("graph");
});

describe("statistics helpers", () => {
  it.each([
    [0, 10, 0],
    [1, 10, 1],
    [3, 10, 2],
    [6, 10, 3],
    [10, 10, 4],
    [5, 0, 0]
  ])("%i commits against a busiest day of %i is level %i", (count, busiest, level) => {
    expect(activityLevel(count, busiest)).toBe(level);
  });

  it("writes a local day the way Git's short dates do", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  it.each([
    ["Ann Lee", "AL"],
    ["ann marie lee", "AL"],
    ["bob", "B"],
    ["  ", "?"],
    ["Émile", "É"]
  ])("initials of %j are %j", (name, letters) => {
    expect(initials(name)).toBe(letters);
  });
});

describe("the statistics view", () => {
  it("asks for the last year of every branch, without line counts, then shows the figures", () => {
    expect(lastQuery("statistics").query).toStrictEqual({
      kind: "statistics",
      branch: "",
      range: "365",
      lines: false,
      showRemoteBranches: true,
      hiddenRemotes: []
    });
    answer(statistics());
    const figures = [...host.querySelectorAll("[data-statistic]")].map((figure) => [
      figure.getAttribute("data-statistic"),
      figure.textContent
    ]);
    expect(figures.slice(0, 3)).toStrictEqual([
      ["statsCommits", "4"],
      ["statsContributors", "2"],
      ["statsActiveDays", "3"]
    ]);
    const today = host.querySelector(`rect[data-day="${dayKey(new Date())}"]`)!;
    expect(today.getAttribute("data-count")).toBe("2");
    expect(host.querySelectorAll("rect").length).toBeGreaterThan(52 * 7);
  });

  it("offers the local branches and the periods, and sends the choices", () => {
    const branch = host.querySelector<HTMLSelectElement>('select[aria-label="statsBranch"]')!;
    expect([...branch.options].map((option) => option.value)).toStrictEqual([
      "",
      "refs/heads/main",
      "refs/heads/topic"
    ]);
    act(() => {
      branch.value = "refs/heads/topic";
      branch.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const period = host.querySelector<HTMLSelectElement>('select[aria-label="statsPeriod"]')!;
    act(() => {
      period.value = "all";
      period.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    expect(lastQuery("statistics").query).toMatchObject({
      branch: "refs/heads/topic",
      range: "all",
      lines: true
    });
  });

  it("lists contributors with initials and share, without line counts unless counted", () => {
    answer(statistics());
    const rows = [...host.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.querySelector("[aria-hidden=true]")?.textContent)).toStrictEqual([
      "AL",
      "B"
    ]);
    expect(rows[0]!.textContent).toContain("75%");
    expect(host.querySelector("thead")!.textContent).not.toContain("statsLines");
  });

  it("shows lines added and deleted when they were counted", () => {
    answer(
      statistics({
        lines: true,
        contributors: [{ ...statistics().contributors[0]!, added: 12, deleted: 3 }]
      })
    );
    expect(host.querySelector("thead")!.textContent).toContain("statsLines");
    expect(host.querySelector("tbody tr")!.textContent).toContain("+12 −3");
  });

  it("searches a contributor's commits in the graph", () => {
    answer(statistics());
    act(() => host.querySelector<HTMLButtonElement>('[data-contributor="ann@x.test"]')!.click());
    expect(activeTab.value).toBe("graph");
    expect(historyFilter.value.author).toBe("ann@x.test");
  });

  it("says when the period has no commits", () => {
    answer(
      statistics({
        commits: 0,
        contributors: [],
        activeDays: 0,
        first: null,
        last: null,
        activity: {}
      })
    );
    expect(host.textContent).toContain("statsNoCommits");
    expect(host.querySelector("svg[role=img]")).toBeNull();
  });
});
