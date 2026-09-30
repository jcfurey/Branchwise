// @vitest-environment jsdom

import { Fragment, h, render } from "preact";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GitCommitNode, GitRef } from "@/backend/types";
import type { DialogState } from "@/webview/types";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let menus: typeof import("@/webview/lib/menus");
let stores: typeof import("@/webview/lib/stores");
let remoteActions: typeof import("@/webview/lib/remote-actions");

const hash = "c".repeat(40);
const commit: GitCommitNode = {
  hash,
  parentHashes: ["p".repeat(40)],
  author: "Author",
  email: "author@example.com",
  date: 0,
  message: "Message",
  refs: []
};
const tag: GitRef = { type: "tag", name: "v1", hash };
const branch: GitRef = { type: "head", name: "topic", hash };
const remote: GitRef = { type: "remote", name: "origin/topic", hash };

beforeAll(async () => {
  setupWebviewTest();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async () => {} },
    configurable: true
  });
  menus = await import("@/webview/lib/menus");
  stores = await import("@/webview/lib/stores");
  remoteActions = await import("@/webview/lib/remote-actions");
});

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  stores.dialog.value = null;
  stores.selectedRepo.value = "/repo";
});

type Entries = ReturnType<typeof menus.commitMenu>;

/** Choose an entry and return the form it opens. */
function open(entries: Entries, title: string) {
  const entry = entries.find((item) => item?.title === title);
  expect(entry, title).toBeDefined();
  entry!.onClick();
  const form = stores.dialog.value;
  if (form?.kind !== "form") {
    throw new Error(`${title} did not open a form`);
  }
  return form as Extract<DialogState, { kind: "form" }>;
}

function lastRequest() {
  return vscodeApi.postMessage.mock.lastCall?.[0] as Record<string, unknown>;
}

describe("commit menu dialogs", () => {
  const entries = () => menus.commitMenu(commit, new Map());

  it("adds a lightweight or an annotated tag", () => {
    open(entries(), "addTag…").onSubmit(["v2", "lightweight", ""]);
    expect(lastRequest()).toEqual({
      command: "addTag",
      repo: "/repo",
      requestId: expect.any(String),
      tagName: "v2",
      commitHash: hash,
      lightweight: true,
      message: ""
    });
    open(entries(), "addTag…").onSubmit(["v3", "annotated", "Release"]);
    expect(lastRequest()).toMatchObject({ tagName: "v3", lightweight: false, message: "Release" });
  });

  it("creates a branch, checks out, merges, and resets with the chosen options", () => {
    open(entries(), "createBranch…").onSubmit(["feature"]);
    expect(lastRequest()).toMatchObject({
      command: "createBranch",
      branchName: "feature",
      commitHash: hash
    });

    open(entries(), "checkout…").onSubmit([]);
    expect(lastRequest()).toMatchObject({ command: "checkoutCommit", commitHash: hash });

    const merge = open(entries(), "merge…");
    expect(merge.inputs[0]).toMatchObject({ kind: "checkbox", value: true });
    merge.onSubmit([false]);
    expect(lastRequest()).toMatchObject({
      command: "mergeCommit",
      commitHash: hash,
      createNewCommit: false
    });

    for (const resetMode of ["soft", "hard"]) {
      const reset = open(entries(), "reset…");
      expect(reset.inputs[0]).toMatchObject({ kind: "select", value: "mixed" });
      expect(reset.destructive).toBe(true);
      reset.onSubmit([resetMode]);
      expect(lastRequest()).toMatchObject({
        command: "resetToCommit",
        commitHash: hash,
        resetMode
      });
    }
  });

  it("opens the history tools for the commit", () => {
    for (const title of [
      "interactiveRebase…",
      "createFixupMenu…",
      "compareWith",
      "bisectChooseGood",
      "bisectChooseBad",
      "copyCommitHash"
    ]) {
      vscodeApi.postMessage.mockClear();
      stores.dialog.value = null;
      entries()
        .find((item) => item?.title === title)!
        .onClick();
      expect(
        vscodeApi.postMessage.mock.calls.length > 0 || stores.dialog.value !== null,
        title
      ).toBe(true);
    }
  });
});

describe("tag menu dialogs", () => {
  const entries = () => menus.refMenu(tag, false);

  it("deletes the tag after a destructive confirmation", () => {
    const form = open(entries(), "deleteTag…");
    expect(form.destructive).toBe(true);
    form.onSubmit([]);
    expect(lastRequest()).toMatchObject({ command: "deleteTag", tagName: "v1" });
  });

  it("loads the remotes before pushing or deleting the tag on a remote", () => {
    for (const title of ["pushTag…", "deleteRemoteTag…"]) {
      entries()
        .find((item) => item?.title === title)!
        .onClick();
      expect(lastRequest()).toMatchObject({ command: "loadRemotes", repo: "/repo" });
    }
  });
});

describe("local branch menu dialogs", () => {
  const entries = (head = false) => menus.refMenu(branch, head);

  it("renames, force-deletes, merges, and checks out the branch", () => {
    open(entries(), "renameBranch…").onSubmit(["renamed"]);
    expect(lastRequest()).toMatchObject({
      command: "renameBranch",
      oldName: "topic",
      newName: "renamed"
    });

    const remove = open(entries(), "deleteBranch…");
    expect(remove.inputs[0]).toMatchObject({ kind: "checkbox", value: false });
    expect(remove.destructive).toBe(true);
    remove.onSubmit([true]);
    expect(lastRequest()).toMatchObject({
      command: "deleteBranch",
      branchName: "topic",
      forceDelete: true
    });

    open(entries(), "merge…").onSubmit([false]);
    expect(lastRequest()).toMatchObject({
      command: "mergeBranch",
      branchName: "topic",
      createNewCommit: false
    });

    entries()
      .find((item) => item?.title === "checkoutBranch")!
      .onClick();
    expect(lastRequest()).toMatchObject({
      command: "checkoutBranch",
      branchName: "topic",
      remoteBranch: null
    });
  });

  it("offers neither checkout, merge, nor delete for the checked-out branch", () => {
    const titles = entries(true).map((item) => item?.title);
    expect(titles).not.toContain("checkoutBranch");
    expect(titles).not.toContain("merge…");
    expect(titles).not.toContain("deleteBranch…");
    expect(titles).toContain("pullBranch…");
  });

  it("opens the branch tools", () => {
    for (const [title, head] of [
      ["focusThisBranch", false],
      ["configureUpstream…", false],
      ["addWorktree…", false],
      ["rebaseOnto…", false],
      ["pushBranch…", false],
      ["pullBranch…", true],
      ["compareWith", false],
      ["copyBranchName", false]
    ] as const) {
      vscodeApi.postMessage.mockClear();
      stores.dialog.value = null;
      const focus = stores.branchFocusTarget?.value;
      entries(head)
        .find((item) => item?.title === title)!
        .onClick();
      expect(
        vscodeApi.postMessage.mock.calls.length > 0 ||
          stores.dialog.value !== null ||
          stores.branchFocusTarget?.value !== focus,
        title
      ).toBe(true);
    }
  });
});

describe("remote branch menu", () => {
  it("loads the remotes before checkout, deletion, or fetch", () => {
    for (const title of ["checkoutBranch…", "deleteRemoteBranch…", "fetch…"]) {
      vscodeApi.postMessage.mockClear();
      menus
        .refMenu(remote, false)
        .find((item) => item?.title === title)!
        .onClick();
      expect(lastRequest(), title).toMatchObject({ command: "loadRemotes", repo: "/repo" });
    }
  });

  it("opens the rebase, worktree, compare, focus, and copy tools", () => {
    for (const title of [
      "rebaseOnto…",
      "addWorktree…",
      "compareWith",
      "focusThisBranch",
      "copyBranchName"
    ]) {
      vscodeApi.postMessage.mockClear();
      stores.dialog.value = null;
      const focus = stores.branchFocusTarget?.value;
      menus
        .refMenu(remote, false)
        .find((item) => item?.title === title)!
        .onClick();
      expect(
        vscodeApi.postMessage.mock.calls.length > 0 ||
          stores.dialog.value !== null ||
          stores.branchFocusTarget?.value !== focus,
        title
      ).toBe(true);
    }
  });
});

/** Choose an entry that hands over to another tool. */
function choose(entries: Entries, title: string) {
  const entry = entries.find((item) => item?.title === title);
  expect(entry, title).toBeDefined();
  entry!.onClick();
}

describe("tool arguments", () => {
  const moved = "d".repeat(40);
  const headCommit = "e".repeat(40);

  it("plans an interactive rebase and a fixup against the commit's full hash", () => {
    choose(menus.commitMenu(commit, new Map()), "interactiveRebase…");
    expect(lastRequest()).toMatchObject({
      command: "repositoryQuery",
      repo: "/repo",
      query: { kind: "rebasePlan", base: hash, autosquash: false }
    });
    choose(menus.commitMenu(commit, new Map()), "createFixupMenu…");
    expect(lastRequest()).toMatchObject({
      command: "repositoryQuery",
      repo: "/repo",
      query: { kind: "stagedPlan", target: hash }
    });
  });

  it("compares HEAD with the commit, or with the hash a ref points at", () => {
    const compared = () => {
      const shown = stores.dialog.value;
      if (shown?.kind !== "content") {
        throw new Error("Expected the comparison");
      }
      return (shown.content as { props: { left: string; right: string } }).props;
    };
    choose(menus.commitMenu(commit, new Map()), "compareWith");
    expect(compared()).toMatchObject({ left: "HEAD", right: hash });
    for (const gitRef of [branch, remote, tag]) {
      choose(menus.refMenu({ ...gitRef, hash: moved }, false), "compareWith");
      expect(compared(), gitRef.type).toMatchObject({ left: "HEAD", right: moved });
    }
  });

  it("chooses the commit for bisect without asking the extension", () => {
    for (const title of ["bisectChooseGood", "bisectChooseBad"]) {
      stores.dialog.value = null;
      choose(menus.commitMenu(commit, new Map()), title);
      expect(stores.dialog.value, title).toMatchObject({ kind: "content", message: "bisectTitle" });
    }
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it("loads the repository state to configure a branch's upstream", () => {
    choose(menus.refMenu(branch, false), "configureUpstream…");
    expect(lastRequest()).toMatchObject({
      command: "repositoryQuery",
      repo: "/repo",
      query: { kind: "state" }
    });
  });

  it("starts a worktree from the branch's full ref name", () => {
    expect(open(menus.refMenu(branch, false), "addWorktree…").inputs[3]).toMatchObject({
      value: "refs/heads/topic"
    });
    expect(open(menus.refMenu(remote, false), "addWorktree…").inputs[3]).toMatchObject({
      value: "refs/remotes/origin/topic"
    });
  });

  it("rebases the current branch onto the full ref name", () => {
    stores.headBranch.value = "main";
    stores.commitHead.value = headCommit;
    for (const [gitRef, onto] of [
      [branch, "refs/heads/topic"],
      [remote, "refs/remotes/origin/topic"]
    ] as const) {
      open(menus.refMenu(gitRef, false), "rebaseOnto…").onSubmit([]);
      expect(lastRequest()).toMatchObject({
        command: "repositoryAction",
        repo: "/repo",
        action: { kind: "rebase", branch: "main", onto, expectedHead: headCommit }
      });
    }
    stores.headBranch.value = null;
    stores.commitHead.value = null;
  });
});

describe("remote flows", () => {
  /** Answer the pending request for the remotes, as the extension would. */
  function answerRemotes() {
    const request = vscodeApi.postMessage.mock.lastCall![0];
    remoteActions.handleLoadRemotes({
      ...request,
      remotes: ["origin", "upstream"],
      upstream: null,
      pushRemote: null,
      status: null
    });
    const form = stores.dialog.value;
    if (form?.kind !== "form") {
      throw new Error("Expected a remote form");
    }
    return form;
  }

  it("names the local branch to push or pull", () => {
    choose(menus.refMenu(branch, false), "pushBranch…");
    expect(lastRequest()).toMatchObject({ command: "loadRemotes", branchName: "topic" });
    choose(menus.refMenu({ ...branch, name: "main" }, true), "pullBranch…");
    expect(lastRequest()).toMatchObject({ command: "loadRemotes", branchName: "main" });
  });

  it("fetches from the remote of a remote branch", () => {
    choose(menus.refMenu(remote, false), "fetch…");
    expect(lastRequest()).toMatchObject({ command: "loadRemotes", branchName: null });
    const form = answerRemotes();
    expect(form.inputs[0]).toMatchObject({ kind: "select", value: "origin" });
    expect(form.source).toBeNull();
  });

  it.each(["pushTag…", "deleteRemoteTag…"])("names the tag when %s asks for a remote", (title) => {
    choose(menus.refMenu(tag, false), title);
    expect(lastRequest()).toMatchObject({ command: "loadRemotes", branchName: null });
    const container = document.createElement("div");
    render(h(Fragment, null, answerRemotes().message), container);
    expect(container.textContent).toContain("v1");
  });

  it("deletes a remote branch by its name on its own remote", () => {
    choose(menus.refMenu(remote, false), "deleteRemoteBranch…");
    expect(lastRequest()).toMatchObject({ command: "loadRemotes", branchName: null });
    const picker = answerRemotes();
    expect(picker.inputs[0]).toMatchObject({ kind: "select", value: "origin" });
    picker.onSubmit(["origin"]);
    const confirm = stores.dialog.value;
    if (confirm?.kind !== "form") {
      throw new Error("Expected a confirmation");
    }
    expect(confirm.destructive).toBe(true);
    confirm.onSubmit([]);
    expect(lastRequest()).toMatchObject({
      command: "repositoryAction",
      repo: "/repo",
      action: { kind: "deleteRemoteRef", remote: "origin", name: "topic", refType: "branch" }
    });
  });
});
