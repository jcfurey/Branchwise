// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitNode, GitRef } from "@/backend/types";
import { Announcer, NOTICE_FOR } from "@/webview/components/ui/Announcer";
import { copyToClipboard } from "@/webview/lib/copy";
import { commitMenu, refMenu } from "@/webview/lib/menus";
import { dialog, selectedRepo } from "@/webview/lib/stores";
import type { ContextMenuEntry } from "@/webview/types";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

type Request = { kind: string; id: string; method: string; params: unknown };

const COMMIT: GitCommitNode = {
  hash: "5a17e0b36c2d4e8f9a0b1c2d3e4f5a6b7c8d9e0f",
  parentHashes: [],
  author: "Sam Porter",
  email: "sam@example.org",
  date: 0,
  message: "Add the changelog",
  refs: []
};

function choose(entries: Array<ContextMenuEntry>, title: string) {
  const entry = entries.find((candidate) => candidate?.title === title);
  expect(entry, `an entry titled ${title}`).toBeDefined();
  entry!.onClick();
}

function requests(): Array<Request> {
  return vscodeApi.postMessage.mock.calls
    .map(([message]) => message as Request)
    .filter((message) => message.kind === "rpc.request");
}

/** Deliver the extension's answer to the request with `id`, as the page receives it. */
function answer(id: string, result: boolean) {
  window.dispatchEvent(
    new MessageEvent("message", { data: { kind: "rpc.response", id, success: true, result } })
  );
}

beforeAll(() => setupWebviewTest({ dispatchMessages: true }));

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  dialog.value = null;
});

afterEach(() => {
  // Settle whatever is still waiting, so that no request's deadline outlives its test. The
  // handler ignores an answer to a request that has been answered already. A refusal leaves no
  // notice behind for the next test, and the dialog it opens is cleared before each.
  for (const request of requests()) {
    answer(request.id, false);
  }
});

describe("copying from a menu", () => {
  it("asks for the full commit hash, and a refused copy ends in an error without a reason", async () => {
    // Copying needs no repository.
    expect(selectedRepo.value).toBeUndefined();

    choose(commitMenu(COMMIT, new Map()), "copyCommitHash");
    const [request] = vscodeApi.postMessage.mock.calls[0] as [Request];
    expect(request).toEqual({
      kind: "rpc.request",
      id: expect.any(String),
      method: "clipboard.copy",
      params: "5a17e0b36c2d4e8f9a0b1c2d3e4f5a6b7c8d9e0f"
    });

    // `true` for success but `false` for the result: VS Code did not take the text.
    answer(request.id, false);
    await vi.waitFor(() =>
      expect(dialog.value).toMatchObject({
        kind: "error",
        message: "unableToCopyToClipboard",
        reason: null
      })
    );
  });

  it.each([
    { what: "a local branch", gitRef: { type: "head", name: "hotfix", hash: "tip" } },
    { what: "a remote branch", gitRef: { type: "remote", name: "upstream/hotfix", hash: "tip" } },
    { what: "a tag", gitRef: { type: "tag", name: "v0.3", hash: "tip" } }
  ] satisfies Array<{ what: string; gitRef: GitRef }>)(
    "asks for the name of $what exactly as the label shows it",
    ({ gitRef }) => {
      const title = gitRef.type === "tag" ? "copyTagName" : "copyBranchName";
      choose(refMenu(gitRef, false), title);
      expect(vscodeApi.postMessage).toHaveBeenCalledTimes(1);
      const [request] = vscodeApi.postMessage.mock.calls[0] as [Request];
      expect(request).toMatchObject({
        kind: "rpc.request",
        method: "clipboard.copy",
        params: gitRef.name
      });
      expect(request.id).toEqual(expect.any(String));
    }
  );
});

describe("what a copy that worked shows", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    // The notice is taken down by a timer, which each test here runs out before the next.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    container = document.createElement("div");
    document.body.append(container);
    act(() => render(h(Announcer, null), container));
  });
  afterEach(() => {
    pass(NOTICE_FOR);
    vi.useRealTimers();
    act(() => render(null, container));
    container.remove();
  });
  /** Let `ms` milliseconds pass, and the page draw what they change. */
  const pass = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  const notice = () => container.querySelector("[data-notice]");
  const said = () => container.querySelector("[data-announcer]")!.textContent;
  /** Answer the copy the page last asked for, and let the page take the answer. */
  const answered = async (result: boolean) => {
    answer(requests().at(-1)!.id, result);
    await act(async () => {});
  };

  it.each([
    [
      "a commit ID from the commit menu",
      () => choose(commitMenu(COMMIT, new Map()), "copyCommitHash")
    ],
    [
      "a branch name from its menu",
      () => choose(refMenu({ type: "head", name: "hotfix", hash: "tip" }, false), "copyBranchName")
    ],
    [
      "a tag name from its menu",
      () => choose(refMenu({ type: "tag", name: "v0.3", hash: "tip" }, false), "copyTagName")
    ]
  ])("says so in a notice that is seen and heard, for %s", async (_what, copy) => {
    copy();
    expect(notice()).toBeNull();
    await answered(true);

    expect(notice()?.textContent).toBe("copiedToClipboard");
    // Seen by eye; a screen reader hears the live region, once.
    expect(notice()?.getAttribute("aria-hidden")).toBe("true");
    expect(said()).toBe("copiedToClipboard");
    expect(dialog.value).toBeNull();
  });

  it("takes the notice down again, and counts from the last copy", async () => {
    choose(commitMenu(COMMIT, new Map()), "copyCommitHash");
    await answered(true);
    pass(NOTICE_FOR - 500);
    expect(notice()).not.toBeNull();

    choose(commitMenu(COMMIT, new Map()), "copyShortCommitHash");
    await answered(true);
    pass(NOTICE_FOR - 1);
    expect(notice()).not.toBeNull();
    pass(1);
    expect(notice()).toBeNull();
    // The words stay in the live region, where nothing reads them again.
    expect(said()).toBe("copiedToClipboard");
  });

  it("shows none for a copy the clipboard refused, or for a caller that shows its own", async () => {
    choose(commitMenu(COMMIT, new Map()), "copyCommitHash");
    await answered(false);
    expect(notice()).toBeNull();
    expect(dialog.value).toMatchObject({ kind: "error" });

    const copied = copyToClipboard("what", "text", true);
    await answered(true);
    await expect(copied).resolves.toBe(true);
    expect(notice()).toBeNull();
  });
});
