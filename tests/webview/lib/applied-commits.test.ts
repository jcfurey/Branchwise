// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GitCommitNode, RepositoryQueryData } from "@/backend/types";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import type { RequestMessage } from "@/types";
import { commitMenu } from "@/webview/lib/menus";
import { focusedCommit, historyFilter, pendingReveal } from "@/webview/lib/navigation";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const REPO = "/work/demo";
const HEAD = "1".repeat(40);
const OWN = "2".repeat(40);
const OTHER = "3".repeat(40);
const COPY = "4".repeat(40);
const MERGE = "5".repeat(40);

function node(hash: string, ...parentHashes: string[]): GitCommitNode {
  return { hash, parentHashes, author: "A", email: "a@b", date: 0, message: hash, refs: [] };
}

/** The entries of a commit's menu, by title; a divider is `null`. */
const titles = (commit: GitCommitNode) =>
  commitMenu(commit, new Map()).map((entry) => entry?.title ?? null);

/** The strings the answers are told in, in English; every other string stays its key name. */
const ENGLISH: Partial<Record<keyof LocalizedStrings, string>> = {
  equivalentNotFound: "No commit on {1} makes the same change as {0}.",
  equivalentNotFoundLimited: "None of the newest on {1} match {0}.",
  equivalentOnBranch: "{0} is on {1} already."
};

beforeAll(() => {
  setupWebviewTest();
  const keyNames = window.l10n;
  Object.defineProperty(window, "l10n", {
    value: new Proxy(keyNames, {
      get: (target, key) =>
        (ENGLISH as Record<string | symbol, string | undefined>)[key] ?? Reflect.get(target, key)
    }),
    configurable: true
  });
});
beforeEach(() => {
  stores.selectedRepo.value = REPO;
  stores.headBranch.value = "main";
  stores.commitHead.value = HEAD;
  // HEAD, then its parent, both on the checked-out line; then a commit of another branch.
  stores.commitList.value = [node(HEAD, OWN), node(OWN), node(OTHER, OWN), node(COPY, OWN)];
  stores.dialog.value = null;
  pendingReveal.value = null;
  vscodeApi.postMessage.mockClear();
});

describe("the Find Equivalent Commit entry", () => {
  it("is offered for a commit of another branch, but not for HEAD's own line or a merge", () => {
    expect(titles(node(OTHER, OWN))).toContain("findEquivalentCommit");
    expect(titles(node(HEAD, OWN))).not.toContain("findEquivalentCommit");
    expect(titles(node(OWN))).not.toContain("findEquivalentCommit");
    expect(titles(node(MERGE, OWN, OTHER))).not.toContain("findEquivalentCommit");
    stores.commitHead.value = null;
    expect(titles(node(OTHER, OWN))).not.toContain("findEquivalentCommit");
  });
});

describe("finding an equivalent commit", () => {
  /** Choose the entry and answer the query it posts with `data`. */
  function find(data: Omit<Extract<RepositoryQueryData, { kind: "equivalentCommit" }>, "kind">) {
    commitMenu(node(OTHER, OWN), new Map())
      .find((entry) => entry?.title === "findEquivalentCommit")!
      .onClick();
    expect(stores.dialog.value?.kind).toBe("running");
    const sent = vscodeApi.postMessage.mock.calls
      .map(([message]) => message as RequestMessage)
      .find((message) => message.command === "repositoryQuery");
    expect(sent).toMatchObject({ repo: REPO, query: { kind: "equivalentCommit", hash: OTHER } });
    handleRepositoryQuery({
      repo: REPO,
      requestId: (sent as { requestId: string }).requestId,
      data: { kind: "equivalentCommit", ...data },
      status: null
    });
  }

  it("selects the commit of the checked-out branch that it finds", () => {
    find({
      hash: OTHER,
      onHead: false,
      equivalent: { hash: COPY, subject: "copy" },
      truncated: false
    });
    expect(stores.dialog.value).toBeNull();
    expect(pendingReveal.value).toBe(COPY);
    expect(focusedCommit.value).toBe(COPY);
  });

  it("opens the history at a commit the graph has not loaded", () => {
    const unloaded = "6".repeat(40);
    find({
      hash: OTHER,
      onHead: false,
      equivalent: { hash: unloaded, subject: "older" },
      truncated: false
    });
    expect(historyFilter.value.revision).toBe(unloaded);
    expect(pendingReveal.value).toBe(unloaded);
  });

  it.each([
    [{ onHead: false, truncated: false }, "No commit on main makes the same change as 33333333."],
    [{ onHead: false, truncated: true }, "None of the newest on main match 33333333."],
    [{ onHead: true, truncated: false }, "33333333 is on main already."]
  ])("says why nothing was found: %o", (answer, message) => {
    find({ hash: OTHER, equivalent: null, ...answer });
    expect(stores.dialog.value).toMatchObject({
      kind: "content",
      message: "findEquivalentCommit",
      content: message,
      wide: false
    });
    expect(pendingReveal.value).toBeNull();
  });
});
