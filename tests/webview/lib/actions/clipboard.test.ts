// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitNode, GitRef } from "@/backend/types";
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
  // handler ignores an answer to a request that has been answered already.
  for (const request of requests()) {
    answer(request.id, true);
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
