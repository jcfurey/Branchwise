// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openGoTo, revealChoice } from "@/webview/lib/go-to";
import {
  emptyFilter,
  historyFilter,
  pendingReveal,
  revealDetails,
  setHistoryFilter
} from "@/webview/lib/navigation";
import { commitList, graphErrors, selectedRepo } from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

const rpc = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/webview/lib/rpc/rpc-client", () => ({ rpcClient: rpc }));

const commit = (hash: string) => ({
  hash,
  parentHashes: [],
  author: "A",
  email: "a@b",
  date: 1,
  message: hash,
  refs: []
});

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  rpc.request.mockReset();
  rpc.request.mockResolvedValue(true);
  selectedRepo.value = "/work/app";
  commitList.value = [commit("tip"), commit("base")];
  setHistoryFilter(emptyFilter());
});

describe("asking for the picker", () => {
  it("names the selected repository", () => {
    openGoTo();
    expect(rpc.request.mock.calls).toEqual([["goTo.show", { repo: "/work/app" }]]);
  });

  it("waits for a repository on a page that has none yet, and asks once", async () => {
    selectedRepo.value = undefined;
    openGoTo();
    expect(rpc.request).not.toHaveBeenCalled();
    selectedRepo.value = "/work/late";
    await Promise.resolve();
    selectedRepo.value = "/work/other";
    expect(rpc.request.mock.calls).toEqual([["goTo.show", { repo: "/work/late" }]]);
  });

  it("asks only for the latest picker while waiting", () => {
    selectedRepo.value = undefined;
    openGoTo();
    openGoTo();
    selectedRepo.value = "/work/app";
    expect(rpc.request).toHaveBeenCalledOnce();
  });
});

describe("showing the choice", () => {
  it("reveals the commit in the repository on screen", () => {
    revealChoice("/work/app", "base");
    expect(pendingReveal.value).toBe("base");
  });

  it("ignores a choice made for a repository the user has left", () => {
    revealChoice("/work/elsewhere", "base");
    expect(pendingReveal.value).toBeNull();
  });

  it("asks the table to open the details of a commit revealed from an editor line", () => {
    revealChoice("/work/app", "base", true);
    expect([pendingReveal.value, revealDetails.value]).toEqual(["base", true]);
    revealChoice("/work/app", "tip");
    expect([pendingReveal.value, revealDetails.value]).toEqual(["tip", false]);
  });

  it("waits for the rows of a repository the page has only just selected", () => {
    commitList.value = undefined;
    revealChoice("/work/app", "base", true);
    expect(pendingReveal.value).toBeNull();
    commitList.value = [commit("tip"), commit("base")];
    expect([pendingReveal.value, revealDetails.value]).toEqual(["base", true]);
    // The commit is among the rows, so the graph shows it rather than the history at it.
    expect(historyFilter.value.revision).toBe("");
  });

  it("opens the history at the commit once rows that lack it arrive, or the load fails", () => {
    commitList.value = undefined;
    revealChoice("/work/app", "elsewhere");
    commitList.value = [commit("tip")];
    expect(historyFilter.value.revision).toBe("elsewhere");

    setHistoryFilter(emptyFilter());
    commitList.value = undefined;
    revealChoice("/work/app", "failed");
    graphErrors.value = { loadCommits: "broken" };
    expect(historyFilter.value.revision).toBe("failed");
    graphErrors.value = {};
  });

  it("gives up the wait when the user moves to another repository, or a newer reveal comes", () => {
    commitList.value = undefined;
    revealChoice("/work/app", "first");
    revealChoice("/work/app", "second");
    selectedRepo.value = "/work/other";
    commitList.value = [commit("first")];
    expect(pendingReveal.value).toBeNull();
    selectedRepo.value = "/work/app";
    commitList.value = [commit("second")];
    expect(pendingReveal.value).toBeNull();
  });
});
