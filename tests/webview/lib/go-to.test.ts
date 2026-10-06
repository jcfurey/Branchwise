// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openGoTo, revealChoice } from "@/webview/lib/go-to";
import { pendingReveal } from "@/webview/lib/navigation";
import { commitList, selectedRepo } from "@/webview/lib/stores";

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
  pendingReveal.value = null;
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
});
