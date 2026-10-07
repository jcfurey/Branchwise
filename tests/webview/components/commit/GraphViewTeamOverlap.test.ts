// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ConflictForecastEntry } from "@/backend/types";
import { repositoryRevision } from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";
import { getWebviewConfig, updateWebviewConfig } from "@/webview/lib/webview-config";

import { setupWebviewTest } from "@tests/webview/test-utils";

import {
  chain,
  hideGraphView,
  lastQuery,
  reply,
  resetGraphView,
  sentQueries,
  showGraphView,
  view,
  withEnglish
} from "./graph-view-harness";

const DAY = 24 * 60 * 60;
const daysAgo = (days: number) => Math.floor(Date.now() / 1000) - days * DAY;

const LOCAL: ConflictForecastEntry = {
  branch: "clash",
  remote: false,
  files: ["f"],
  committer: "T",
  date: daysAgo(1)
};
const ALICE: ConflictForecastEntry = {
  branch: "origin/alice/payments",
  remote: true,
  files: ["api.ts", "db.ts"],
  committer: "Alice",
  date: daysAgo(2)
};
const BOB: ConflictForecastEntry = {
  branch: "origin/bob/search",
  remote: true,
  files: Array.from({ length: 12 }, (_, index) => `src/file-${index}.ts`),
  committer: "Bob",
  date: daysAgo(14)
};

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphView();
  stores.commitList.value = chain("c", "b", "a");
  stores.commitHead.value = "c";
});
afterEach(() => {
  hideGraphView();
  updateWebviewConfig({ ...getWebviewConfig(), conflictForecast: "localAndRemote" });
});

const summary = () => view().querySelector<HTMLElement>("[data-team-overlap]");

/** A refresh, which asks for the forecast again. */
const refreshed = () =>
  act(() => {
    repositoryRevision.value++;
  });

function answer(conflicts: Array<ConflictForecastEntry>) {
  reply(lastQuery("conflictForecast"), { data: { kind: "conflictForecast", conflicts } });
}

/** The open dialog's content, drawn into the document so its buttons can be pressed. */
function showDialogContent() {
  const body = stores.dialog.value;
  expect(body?.kind).toBe("content");
  const host = document.createElement("div");
  document.body.append(host);
  act(() => render(body!.kind === "content" ? body!.content : null, host));
  return host;
}

describe("the team overlap summary", () => {
  it("counts the remote branches that would conflict, leaving local ones to their labels", () => {
    withEnglish({
      teamOverlapOne: "1 teammate's branch would conflict with yours",
      teamOverlapMany: "{0} teammates' branches would conflict with yours"
    });
    showGraphView();
    expect(lastQuery("conflictForecast").query).toEqual({
      kind: "conflictForecast",
      scope: "localAndRemote",
      hiddenRemotes: [],
      hiddenBranchPatterns: []
    });
    answer([LOCAL]);
    expect(summary()).toBeNull();

    refreshed();
    answer([LOCAL, ALICE]);
    expect(summary()?.textContent).toBe("1 teammate's branch would conflict with yours");

    refreshed();
    answer([LOCAL, ALICE, BOB]);
    expect(summary()?.textContent).toBe("2 teammates' branches would conflict with yours");
    expect(summary()?.dataset.teamOverlap).toBe("2");
  });

  it("lists each branch with whose work it is, its age and files, and focuses the one chosen", () => {
    withEnglish({
      teamOverlapTitle: "Remote branches that would conflict with {0}",
      lastCommitBy: "Last commit by {0}, {1}",
      conflictForecastMore: "and {0} more files"
    });
    showGraphView();
    answer([LOCAL, ALICE, BOB]);
    act(() => summary()!.querySelector("button")!.click());

    const body = stores.dialog.value;
    expect(body?.kind === "content" && body.message).toBe(
      "Remote branches that would conflict with HEAD"
    );
    const host = showDialogContent();
    const entries = [...host.querySelectorAll<HTMLButtonElement>("[data-team-overlap-branch]")];
    expect(entries.map((entry) => entry.dataset.teamOverlapBranch)).toEqual([
      "origin/alice/payments",
      "origin/bob/search"
    ]);
    const [alice, bob] = entries.map((entry) =>
      [...entry.querySelectorAll(":scope > span")].map((span) => span.textContent)
    );
    expect(alice).toEqual([
      "origin/alice/payments2",
      "Last commit by Alice, 2 days ago",
      "api.ts, db.ts"
    ]);
    expect(bob?.[1]).toBe("Last commit by Bob, 2 weeks ago");
    expect(bob?.[2]).toBe(`${BOB.files.slice(0, 10).join(", ")} and 2 more files`);

    act(() => entries[0]!.click());
    expect(stores.dialog.value).toBeNull();
    expect(stores.selectedBranch.value).toBe("remotes/origin/alice/payments");
    expect(stores.branchDisplay.value).toBe("focus");
    act(() => render(null, host));
    host.remove();
  });

  it("follows the setting: local branches only, or no forecast at all", () => {
    updateWebviewConfig({ ...getWebviewConfig(), conflictForecast: "local" });
    showGraphView();
    expect(lastQuery("conflictForecast").query).toEqual({
      kind: "conflictForecast",
      scope: "local"
    });
    hideGraphView();

    updateWebviewConfig({ ...getWebviewConfig(), conflictForecast: "off" });
    resetGraphView();
    showGraphView();
    expect(sentQueries("conflictForecast")).toEqual([]);
  });

  it("asks without remote branches while the graph hides them", () => {
    act(() => {
      stores.showRemoteBranch.value = false;
    });
    showGraphView();
    expect(lastQuery("conflictForecast").query).toEqual({
      kind: "conflictForecast",
      scope: "local"
    });
  });
});
