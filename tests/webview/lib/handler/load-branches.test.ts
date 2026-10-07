// @vitest-environment jsdom
import { effect } from "@preact/signals";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryResponse } from "@/backend/types";
import type { GraphPreferences, RequestMessage, WebviewConfig } from "@/types";

import { vscodeApi } from "@tests/webview/setup";
import { latestGraphRequest } from "@tests/webview/test-utils";

type BranchesAnswer = Extract<QueryResponse, { command: "loadBranches" }>;

let actions: typeof import("@/webview/lib/actions");
let stores: typeof import("@/webview/lib/stores");
let handleLoadBranches: (msg: BranchesAnswer) => void;

const settings: WebviewConfig = {
  autoCenterCommitDetailsView: false,
  conflictForecast: "localAndRemote",
  dateFormat: "Relative",
  dateSeparators: true,
  dragAndDrop: true,
  graphColours: [],
  graphStyle: "angular",
  initialLoadCommits: 300,
  issueLinks: [],
  loadMoreCommits: 50,
  locale: "en",
  showCurrentBranchByDefault: false,
  singleKeyShortcuts: true
};

beforeAll(() => {
  Object.defineProperty(window, "l10n", {
    value: new Proxy({}, { get: (_target, key) => String(key) }),
    configurable: true
  });
});

/** A page of its own, with the given setting, showing repository `/r` just selected. */
async function openRepository(showCurrentBranchByDefault = false) {
  vi.resetModules();
  const config = await import("@/webview/lib/webview-config");
  config.initializeWebviewConfig({ ...settings, showCurrentBranchByDefault });
  actions = await import("@/webview/lib/actions");
  stores = await import("@/webview/lib/stores");
  ({ handleLoadBranches } = await import("@/webview/lib/handler/load-branches"));
  actions.selectRepo("/r");
}

/** The repository's stored view, as the extension sends it after a switch. */
function storedView(view: Partial<GraphPreferences> & Pick<GraphPreferences, "branchDisplay">) {
  actions.receiveRepoState({
    command: "repoState",
    repo: "/r",
    state: {
      columnWidths: null,
      graphPreferences: {
        focusPaused: false,
        focusDimming: "subtle",
        showRemoteBranches: true,
        ...view
      }
    }
  });
}

/** The answer to the newest branch request. */
function reply(
  branches: Array<string>,
  head: string | null,
  changes: Partial<BranchesAnswer> = {}
) {
  const request = latestGraphRequest("loadBranches");
  return { ...request, branches, head, isRepo: true, ...changes };
}

const posted = () => vscodeApi.postMessage.mock.calls.map(([message]) => message as RequestMessage);

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
});

describe("the branch chosen after a switch", () => {
  it.each<[boolean, GraphPreferences["branchDisplay"], Array<string>, string | null, string]>([
    [false, "filter", ["main", "topic"], "main", "*"],
    [false, "filter", ["topic"], null, "*"],
    [false, "filter", [], null, "*"],
    [false, "focus", ["main", "topic"], "main", "main"],
    [false, "focus", ["topic"], null, "*"],
    [false, "focus", [], null, "*"],
    [false, "ancestors", ["main", "topic"], "main", "main"],
    [true, "filter", ["main", "topic"], "main", "main"],
    [true, "filter", ["topic"], null, "*"],
    [true, "focus", ["main", "topic"], "main", "main"],
    [true, "ancestors", ["main", "topic"], "main", "main"]
  ])(
    "with the current branch shown by default %s, in %s mode, from %j with HEAD %j is %j",
    async (showCurrent, mode, branches, head, chosen) => {
      await openRepository(showCurrent);
      if (mode !== "filter") {
        storedView({ branchDisplay: mode });
      }
      const answer = reply(branches, head);
      handleLoadBranches(answer);

      expect(stores.selectedBranch.value).toBe(chosen);
      expect(stores.branchList.value).toBe(answer.branches);
      expect(stores.headBranch.value).toBe(head);
    }
  );

  it("requests the rows of the current branch, then saves the choice", async () => {
    await openRepository(true);
    const answer = reply(["main", "topic"], "main");
    vscodeApi.postMessage.mockClear();

    handleLoadBranches(answer);

    expect(posted().map((message) => message.command)).toEqual(["loadCommits", "saveRepoState"]);
    expect(posted()[0]).toMatchObject({ repo: "/r", branchName: "main" });
  });

  it.each<[string | undefined, string, boolean]>([
    ["topic", "topic", true],
    ["*", "*", false],
    ["", "main", true],
    ["gone", "main", true],
    [undefined, "main", true]
  ])(
    "returns in a focus mode to the saved target %j as %j, paused %s",
    async (saved, chosen, paused) => {
      await openRepository();
      storedView({
        branchDisplay: "focus",
        focusPaused: true,
        focusDimming: "strong",
        ...(saved === undefined ? {} : { focusBranch: saved })
      });

      handleLoadBranches(reply(["main", "topic"], "main"));

      expect(stores.selectedBranch.value).toBe(chosen);
      expect(stores.focusPaused.value).toBe(paused);
      expect(stores.focusDimming.value).toBe("strong");
    }
  );

  it("ignores a saved focus target in filter mode", async () => {
    await openRepository();
    stores.repoStates.value = {
      "/r": {
        columnWidths: null,
        graphPreferences: {
          branchDisplay: "filter",
          focusBranch: "topic",
          focusPaused: false,
          focusDimming: "subtle",
          showRemoteBranches: true
        }
      }
    };

    handleLoadBranches(reply(["main", "topic"], "main"));

    expect(stores.selectedBranch.value).toBe("*");
  });
});

describe("a branch chosen earlier", () => {
  it("stays while it is listed, and nothing is requested", async () => {
    await openRepository();
    handleLoadBranches(reply(["main", "topic"], "main"));
    actions.selectBranch("topic");
    actions.refresh();
    const answer = reply(["main", "topic"], "main");
    vscodeApi.postMessage.mockClear();

    handleLoadBranches(answer);

    expect(stores.selectedBranch.value).toBe("topic");
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it("gives way to every branch in filter mode when it disappears", async () => {
    await openRepository();
    handleLoadBranches(reply(["main", "topic"], "main"));
    actions.selectBranch("topic");
    actions.refresh();

    handleLoadBranches(reply(["main"], "main"));

    expect(stores.selectedBranch.value).toBe("*");
  });

  it("gives way to HEAD in a focus mode, not to the saved target", async () => {
    await openRepository();
    handleLoadBranches(reply(["main", "topic", "other"], "main"));
    stores.repoStates.value = {
      "/r": {
        columnWidths: null,
        graphPreferences: {
          branchDisplay: "focus",
          focusBranch: "other",
          focusPaused: false,
          focusDimming: "subtle",
          showRemoteBranches: true
        }
      }
    };
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "topic";
    actions.refresh();

    handleLoadBranches(reply(["main", "other"], "main"));

    expect(stores.selectedBranch.value).toBe("main");
  });

  it("follows HEAD after a focused branch disappears", async () => {
    await openRepository();
    handleLoadBranches(reply(["main", "topic"], "main"));
    actions.focusBranchInGraph("main");
    actions.refresh();

    handleLoadBranches(reply(["other"], "other"));

    expect(stores.selectedBranch.value).toBe("other");
  });

  it("keeps every branch in a focus mode, and requests nothing", async () => {
    await openRepository();
    handleLoadBranches(reply(["main"], "main"));
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "*";
    actions.refresh();
    const answer = reply(["main"], "main");
    vscodeApi.postMessage.mockClear();

    handleLoadBranches(answer);

    expect(stores.selectedBranch.value).toBe("*");
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it("falls back to every branch when HEAD is detached in a focus mode", async () => {
    await openRepository();
    stores.branchDisplay.value = "focus";

    handleLoadBranches(reply(["topic"], null));

    expect(stores.selectedBranch.value).toBe("*");
  });
});

describe("the stored list", () => {
  it("records HEAD from each accepted answer", async () => {
    await openRepository();
    handleLoadBranches(reply(["main"], "main"));
    expect(stores.headBranch.value).toBe("main");

    actions.refresh();
    handleLoadBranches(reply(["main"], null));
    expect(stores.headBranch.value).toBeNull();
  });

  it("changes in one notification, and is the answer's own array", async () => {
    await openRepository();
    stores.selectedBranch.value = "*";
    let runs = 0;
    const stop = effect(() => {
      void stores.branchList.value;
      void stores.headBranch.value;
      runs += 1;
    });
    const answer = reply(["main", "topic"], "main");

    handleLoadBranches(answer);
    stop();

    expect(runs).toBe(2);
    expect(stores.branchList.value).toBe(answer.branches);
  });
});

describe("which answers are taken", () => {
  it("not those for another view, which leave the request waiting", async () => {
    await openRepository();
    stores.selectedBranch.value = "*";
    const good = reply(["main"], "main");

    handleLoadBranches({ ...good, repo: "/other" });
    handleLoadBranches({ ...good, visibilityKey: "nope" });
    expect(stores.branchList.value).toBeUndefined();

    handleLoadBranches(good);
    expect(stores.branchList.value).toEqual(["main"]);

    handleLoadBranches({ ...good, branches: ["again"] });
    expect(stores.branchList.value).toEqual(["main"]);
  });

  it("one whose key is present but undefined", async () => {
    await openRepository();
    stores.selectedBranch.value = "*";
    stores.showRemoteBranch.value = false;

    handleLoadBranches(reply(["main"], "main", { visibilityKey: undefined }));

    expect(stores.branchList.value).toEqual(["main"]);
  });

  it("not one for a repository no longer selected", async () => {
    await openRepository();
    const answer = reply(["main"], "main");
    stores.selectedRepo.value = undefined;

    handleLoadBranches(answer);

    expect(stores.branchList.value).toBeUndefined();
    expect(stores.selectedBranch.value).toBeUndefined();
  });
});
