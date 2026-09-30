import { effect } from "@preact/signals";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DialogState } from "@/webview/types";

// Plain Node: the stores must load without a DOM, a configuration or any strings.

let s: typeof import("@/webview/lib/stores");

beforeEach(async () => {
  vi.resetModules();
  s = await import("@/webview/lib/stores");
});

const formDialog = (source: string | null): DialogState => ({
  kind: "form",
  message: "Confirm?",
  inputs: [],
  action: "OK",
  onSubmit: () => {},
  source,
  token: 7
});
const menuAt = (source: string) => ({ x: 1, y: 2, entries: [], source });

describe("a freshly loaded module", () => {
  it("starts every store at its initial value", () => {
    expect({
      selectedRepo: s.selectedRepo.value,
      branchList: s.branchList.value,
      headBranch: s.headBranch.value,
      commitList: s.commitList.value,
      commitHead: s.commitHead.value,
      moreCommitsAvailable: s.moreCommitsAvailable.value,
      graphErrors: s.graphErrors.value,
      uncommittedChanges: s.uncommittedChanges.value,
      expandedCommit: s.expandedCommit.value,
      commitDetails: s.commitDetails.value,
      contextMenu: s.contextMenu.value,
      dialog: s.dialog.value,
      repoStates: s.repoStates.value,
      selectedBranch: s.selectedBranch.value,
      branchDisplay: s.branchDisplay.value,
      focusPaused: s.focusPaused.value,
      focusDimming: s.focusDimming.value,
      showRemoteBranch: s.showRemoteBranch.value,
      maxCommits: s.maxCommits.value
    }).toStrictEqual({
      selectedRepo: undefined,
      branchList: undefined,
      headBranch: null,
      commitList: undefined,
      commitHead: null,
      moreCommitsAvailable: false,
      graphErrors: {},
      uncommittedChanges: 0,
      expandedCommit: null,
      commitDetails: null,
      contextMenu: null,
      dialog: null,
      repoStates: {},
      selectedBranch: undefined,
      branchDisplay: "filter",
      focusPaused: false,
      focusDimming: "subtle",
      showRemoteBranch: true,
      maxCommits: 0
    });
  });

  it("derives empty values from them", () => {
    expect(s.activeSource.value).toBeNull();
    expect(s.columnWidths.value).toBeNull();
    expect(s.branchFocusTarget.value).toBeUndefined();
    expect(s.hiddenRemotes.value).toEqual([]);
    expect(s.displayedBranch()).toBe("");
    expect(s.remoteVisibilityKey()).toBe("[true,[]]");
  });

  it("gives each load its own stores", async () => {
    s.selectedRepo.value = "/kept";
    vi.resetModules();
    const again = await import("@/webview/lib/stores");
    expect(again.selectedRepo).not.toBe(s.selectedRepo);
    expect(again.selectedRepo.value).toBeUndefined();
  });
});

describe("activeSource", () => {
  it("follows the open menu first, then an open form", () => {
    const seen: Array<string | null> = [];
    const steps: Array<[ReturnType<typeof menuAt> | null, DialogState | null]> = [
      [null, null],
      [null, formDialog("ref:head:x")],
      [null, formDialog(null)],
      [null, { kind: "error", message: "E", reason: null, token: 8 }],
      [menuAt("menu"), formDialog("d")],
      [menuAt(""), formDialog("d")]
    ];
    for (const [menu, open] of steps) {
      s.contextMenu.value = menu;
      s.dialog.value = open;
      seen.push(s.activeSource.value);
    }
    expect(seen).toEqual([null, "ref:head:x", null, null, "menu", ""]);
  });

  it("tells its readers nothing when a dialog without a source opens", () => {
    let runs = 0;
    const stop = effect(() => {
      void s.activeSource.value;
      runs += 1;
    });
    s.dialog.value = { kind: "error", message: "E", reason: "why", token: 1 };
    s.dialog.value = { kind: "running", message: "R", token: 2 };
    stop();
    expect(runs).toBe(1);
  });
});

describe("columnWidths", () => {
  const widthsFor = (stored: unknown) => {
    s.selectedRepo.value = "/r";
    s.repoStates.value = { "/r": { columnWidths: stored as Array<number> } };
    return s.columnWidths.value;
  };

  it.each([[[1, 2, 3, 4]], [[0.5, 1, 1, 1]], [[10, 12, 8, 9]]])(
    "hands out usable widths %j as the stored array",
    (stored) => {
      expect(widthsFor(stored)).toBe(stored);
    }
  );

  it.each([
    ["three widths", [1, 2, 3]],
    ["five widths", [1, 2, 3, 4, 5]],
    ["a zero", [0, 1, 1, 1]],
    ["a negative width", [-1, 1, 1, 1]],
    ["NaN", [Number.NaN, 1, 1, 1]],
    ["an infinity", [Number.POSITIVE_INFINITY, 1, 1, 1]],
    ["a string", ["1", 1, 1, 1]],
    ["null", null],
    ["a plain string", "x"],
    ["an array-like object", { 0: 1, 1: 2, 2: 3, 3: 4, length: 4 }],
    ["a hole", Object.assign([1, 2, 3], { length: 4 })]
  ])("refuses %s", (_label, stored) => {
    expect(widthsFor(stored)).toBeNull();
  });

  it("is null without a selected repository or a record for it", () => {
    s.repoStates.value = { "/r": { columnWidths: [1, 2, 3, 4] } };
    expect(s.columnWidths.value).toBeNull();
    s.selectedRepo.value = "/elsewhere";
    expect(s.columnWidths.value).toBeNull();
  });
});

describe("branchFocusTarget and displayedBranch", () => {
  it("names the chosen branch in the focus modes only", () => {
    s.selectedBranch.value = "main";
    const targets = (["filter", "focus", "ancestors"] as const).map((mode) => {
      s.branchDisplay.value = mode;
      return s.branchFocusTarget.value;
    });
    expect(targets).toEqual([undefined, "main", "main"]);

    s.focusPaused.value = true;
    expect(s.branchFocusTarget.value).toBe("main");

    s.branchDisplay.value = "focus";
    s.selectedBranch.value = "*";
    expect(s.branchFocusTarget.value).toBeUndefined();
    s.selectedBranch.value = undefined;
    expect(s.branchFocusTarget.value).toBeUndefined();
  });

  it.each([
    ["filter", undefined, "", "topic", undefined],
    ["filter", "*", "", "topic", undefined],
    ["filter", "main", "main", "topic", undefined],
    ["focus", undefined, "", "", undefined],
    ["focus", "*", "", "", undefined],
    ["focus", "main", "", "", "main"],
    ["ancestors", "main", "", "", "main"],
    ["focus", "", "", "", ""]
  ] as const)(
    "in %s mode with %j chosen shows %j, %j for topic, and targets %j",
    (mode, chosen, shown, shownForTopic, target) => {
      s.branchDisplay.value = mode;
      s.selectedBranch.value = chosen;
      expect(s.displayedBranch()).toBe(shown);
      expect(s.displayedBranch(undefined)).toBe(shown);
      expect(s.displayedBranch("topic")).toBe(shownForTopic);
      expect(s.displayedBranch("*")).toBe("");
      expect(s.branchFocusTarget.value).toBe(target);
    }
  );
});

describe("hiddenRemotes and remoteVisibilityKey", () => {
  it("lists nothing while no repository is selected, whatever others hide", () => {
    s.repoStates.value = { "/r": { columnWidths: null, hiddenRemotes: ["origin"] } };
    expect(s.hiddenRemotes.value).toEqual([]);
    expect(s.remoteVisibilityKey()).toBe("[true,[]]");
  });

  it("lists nothing for a record without the field", () => {
    s.selectedRepo.value = "/r";
    s.repoStates.value = { "/r": { columnWidths: null } };
    expect(s.hiddenRemotes.value).toEqual([]);
  });

  it("sorts a copy for the key and leaves the stored list alone", () => {
    const stored = ["origin", "b"];
    s.selectedRepo.value = "/r";
    s.repoStates.value = { "/r": { columnWidths: null, hiddenRemotes: stored } };
    expect(s.remoteVisibilityKey()).toBe('[true,["b","origin"]]');
    expect(s.hiddenRemotes.value).toBe(stored);
    expect(stored).toEqual(["origin", "b"]);
  });

  it.each([
    [true, ["b", "B", "a", "a"], '[true,["B","a","a","b"]]'],
    [false, ["b", "B", "a", "a"], '[false,["B","a","a","b"]]'],
    [false, ["ä", "z", "a/b", "a", "10", "9"], '[false,["10","9","a","a/b","z","ä"]]']
  ])("with remotes shown %s and %j hidden, reads %s", (shown, stored, key) => {
    s.selectedRepo.value = "/r";
    s.showRemoteBranch.value = shown;
    s.repoStates.value = { "/r": { columnWidths: null, hiddenRemotes: stored } };
    expect(s.remoteVisibilityKey()).toBe(key);
  });
});

describe("initializeStores", () => {
  it("sets the page size, each time it is called", () => {
    s.initializeStores(500);
    expect(s.maxCommits.value).toBe(500);
    s.initializeStores(5);
    expect(s.maxCommits.value).toBe(5);
    expect(s.commitList.value).toBeUndefined();
  });
});
