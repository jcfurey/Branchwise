// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitNode, GitRef } from "@/backend/types";
import {
  checkoutBranchAction,
  commitMenu,
  commitMenuSource,
  refMenu,
  refMenuSource,
  type CommitMessages
} from "@/webview/lib/menus";
import { handleLoadRemotes } from "@/webview/lib/remote-actions";
import { contextMenu, dialog, selectedRepo } from "@/webview/lib/stores";
import type { ContextMenuEntry, DialogInput, DialogState } from "@/webview/types";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

type Form = Extract<DialogState, { kind: "form" }>;
type Select = Extract<DialogInput, { kind: "select" }>;
type Posted = Record<string, unknown>;

/** The repository every action in this file runs in. */
const REPO = "/work/demo";
/** A full commit ID; its first eight characters are `fedcba98`. */
const H = "fedcba9876543210fedcba9876543210fedcba98";
/** A commit ID that is not a real hash, for the cherry-pick and revert submits. */
const PLAIN_ID = "c0ffee";
const P = "7".repeat(40);
const Q = "8".repeat(40);
const NO_MESSAGES: CommitMessages = new Map();

function commitNode(hash: string, parentHashes: Array<string>): GitCommitNode {
  return {
    hash,
    parentHashes,
    author: "Robin Doe",
    email: "robin@example.net",
    date: 0,
    message: "Tidy the parser",
    refs: []
  };
}

/** An ordinary commit with one parent. */
const N = commitNode(H, [P]);

const LOCAL: GitRef = { type: "head", name: "wip", hash: H };
const CURRENT: GitRef = { type: "head", name: "trunk", hash: H };
const REMOTE: GitRef = { type: "remote", name: "upstream/wip", hash: H };
const TAG: GitRef = { type: "tag", name: "v2.0", hash: H };
const remoteRef = (name: string, hash = H): GitRef => ({ type: "remote", name, hash });

const COMMIT_TITLES = [
  "addTag…",
  "createBranch…",
  null,
  "checkout…",
  "cherryPick…",
  "revert…",
  null,
  "merge…",
  "reset…",
  null,
  "interactiveRebase…",
  "createFixupMenu…",
  "compareWith",
  "bisectChooseGood",
  "bisectChooseBad",
  "copyCommitHash",
  "copyShortCommitHash"
];
const LOCAL_TITLES = [
  "focusThisBranch",
  "compareWith",
  null,
  "configureUpstream…",
  "addWorktree…",
  "rebaseOnto…",
  "checkoutBranch",
  "pushBranch…",
  "renameBranch…",
  "deleteBranch…",
  "merge…",
  null,
  "copyBranchName",
  "hideBranchesLikeThis…"
];
const CHECKED_OUT_TITLES = [
  "focusThisBranch",
  "compareWith",
  null,
  "configureUpstream…",
  "addWorktree…",
  "pushBranch…",
  "pullBranch…",
  "renameBranch…",
  null,
  "copyBranchName",
  "hideBranchesLikeThis…"
];
const REMOTE_TITLES = [
  "focusThisBranch",
  "compareWith",
  null,
  "rebaseOnto…",
  "addWorktree…",
  "deleteRemoteBranch…",
  "fetch…",
  "checkoutBranch…",
  null,
  "copyBranchName",
  "hideBranchesLikeThis…"
];
const REMOTE_HEAD_TITLES = [
  "compareWith",
  null,
  "rebaseOnto…",
  "addWorktree…",
  "fetch…",
  null,
  "copyBranchName"
];
const TAG_TITLES = [
  "compareWith",
  null,
  "deleteTag…",
  "pushTag…",
  "deleteRemoteTag…",
  null,
  "copyTagName"
];

/** A menu as its titles, with `null` for each separator. */
function titles(entries: Array<ContextMenuEntry>) {
  return entries.map((entry) => (entry === null ? null : entry.title));
}

function choose(entries: Array<ContextMenuEntry>, title: string) {
  const entry = entries.find((candidate) => candidate?.title === title);
  expect(entry, `an entry titled ${title}`).toBeDefined();
  entry!.onClick();
}

/** The dialog on screen, which must be a form. */
function shownForm(): Form {
  const shown = dialog.value;
  expect(shown?.kind).toBe("form");
  return shown as Form;
}

/** Choose the entry titled `title` and return the form it opened. */
function openForm(entries: Array<ContextMenuEntry>, title: string): Form {
  choose(entries, title);
  return shownForm();
}

function asSelect(input: DialogInput | undefined): Select {
  expect(input?.kind).toBe("select");
  return input as Select;
}

function allPosted(): Array<Posted> {
  return vscodeApi.postMessage.mock.calls.map(([message]) => message as Posted);
}

function lastPosted(): Posted | undefined {
  return allPosted().at(-1);
}

/** What `runAction` adds to every command: the selected repository and a request id. */
const envelope = { repo: REPO, requestId: expect.any(String) };

const commitEntries = () => commitMenu(N, NO_MESSAGES);
const localEntries = () => refMenu(LOCAL, false);
const tagEntries = () => refMenu(TAG, false);

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  dialog.value = null;
  selectedRepo.value = REPO;
});

describe("loading the menus", () => {
  it("reads no string, so the module can load before the page has its strings", async () => {
    const reads: Array<string> = [];
    const installed = Object.getOwnPropertyDescriptor(window, "l10n");
    Object.defineProperty(window, "l10n", {
      configurable: true,
      value: new Proxy({} as typeof window.l10n, {
        get: (_target, key) => {
          reads.push(String(key));
          return String(key);
        }
      })
    });
    try {
      vi.resetModules();
      const freshStores = await import("@/webview/lib/stores");
      const freshMenus = await import("@/webview/lib/menus");
      // Fresh copies were evaluated just now, not the ones this file imported at the start.
      expect(freshStores.dialog).not.toBe(dialog);
      expect(freshMenus.commitMenu).not.toBe(commitMenu);
      expect(reads).toEqual([]);

      // The recorder does see strings once a menu is built from the same copy.
      freshMenus.commitMenu(N, NO_MESSAGES);
      expect(reads).toContain("addTag");
    } finally {
      Object.defineProperty(window, "l10n", installed!);
    }
  });
});

describe("what each menu offers", () => {
  it.each([
    { parents: "no parents", parentHashes: [] },
    { parents: "one parent", parentHashes: [P] },
    { parents: "two parents", parentHashes: [P, Q] }
  ])("a commit with $parents gets the full commit menu", ({ parentHashes }) => {
    expect(titles(commitMenu(commitNode(H, parentHashes), NO_MESSAGES))).toEqual(COMMIT_TITLES);
  });

  it("a local branch that is not checked out can be rebased onto, checked out, deleted, merged", () => {
    expect(titles(refMenu(LOCAL, false))).toEqual(LOCAL_TITLES);
  });

  it("the checked-out branch offers a pull instead", () => {
    expect(titles(refMenu(CURRENT, true))).toEqual(CHECKED_OUT_TITLES);
  });

  it.each([false, true])("a remote branch gets the remote menu (isHeadBranch %s)", (isHead) => {
    expect(titles(refMenu(REMOTE, isHead))).toEqual(REMOTE_TITLES);
  });

  it.each([false, true])("a tag gets the tag menu (isHeadBranch %s)", (isHead) => {
    expect(titles(refMenu(TAG, isHead))).toEqual(TAG_TITLES);
  });

  it.each([
    ["upstream/HEAD", false],
    ["upstream/HEAD", true],
    ["fork/upstream/HEAD", false],
    ["fork/upstream/HEAD", true]
  ])("%s names a remote's default branch, not a branch (isHeadBranch %s)", (name, isHead) => {
    expect(titles(refMenu(remoteRef(name), isHead))).toEqual(REMOTE_HEAD_TITLES);
  });

  it.each(["upstream/HEADS", "upstream/my-HEAD", "upstream/HEAD/fix"])(
    "%s is an ordinary remote branch: HEAD must be the last segment",
    (name) => {
      expect(titles(refMenu(remoteRef(name), false))).toEqual(REMOTE_TITLES);
    }
  );
});

describe("building a menu", () => {
  it("posts nothing and opens neither a dialog nor a menu", () => {
    contextMenu.value = null;
    const messages: CommitMessages = new Map([[P, "Parent subject"]]);
    for (const parents of [[], [P], [P, Q]]) {
      commitMenu(commitNode(H, parents), messages);
    }
    for (const gitRef of [LOCAL, REMOTE, remoteRef("upstream/HEAD"), TAG]) {
      refMenu(gitRef, false);
      refMenu(gitRef, true);
    }
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(dialog.value).toBeNull();
    expect(contextMenu.value).toBeNull();
  });

  it("returns a new array each time, untouched by changes to an earlier one", () => {
    const first = commitMenu(N, NO_MESSAGES);
    first.push(null, { title: "extra", onClick: () => {} });
    expect(titles(commitMenu(N, NO_MESSAGES))).toEqual(COMMIT_TITLES);

    const local = refMenu(LOCAL, false);
    local.length = 0;
    expect(titles(refMenu(LOCAL, false))).toEqual(LOCAL_TITLES);
  });
});

describe("source keys", () => {
  it("key a commit row by its full hash", () => {
    expect(commitMenuSource(H)).toBe(`commit:${H}`);
  });

  it.each([
    { gitRef: { type: "head", name: "release/2.x", hash: H }, key: "ref:head:release/2.x" },
    {
      gitRef: { type: "remote", name: "upstream/release/2.x", hash: H },
      key: "ref:remote:upstream/release/2.x"
    },
    { gitRef: { type: "tag", name: "v2.0.1", hash: H }, key: "ref:tag:v2.0.1" },
    { gitRef: { type: "tag", name: "release/2.x", hash: "elsewhere" }, key: "ref:tag:release/2.x" }
  ] satisfies Array<{ gitRef: GitRef; key: string }>)(
    "key $gitRef.type $gitRef.name as $key",
    ({ gitRef, key }) => {
      expect(refMenuSource(gitRef)).toBe(key);
    }
  );

  it("ignore the hash, and tell a tag from a branch of the same name", () => {
    const branch: GitRef = { type: "head", name: "release/2.x", hash: H };
    const tag: GitRef = { type: "tag", name: "release/2.x", hash: H };
    expect(refMenuSource({ ...branch, hash: P })).toBe(refMenuSource(branch));
    expect(refMenuSource(tag)).not.toBe(refMenuSource(branch));
  });
});

describe("the form each entry opens", () => {
  it.each([
    { menu: "commit", entries: commitEntries, title: "addTag…", action: "dialogAddTagSubmit" },
    {
      menu: "commit",
      entries: commitEntries,
      title: "createBranch…",
      action: "dialogCreateBranchSubmit"
    },
    { menu: "commit", entries: commitEntries, title: "checkout…", action: "checkout" },
    { menu: "commit", entries: commitEntries, title: "cherryPick…", action: "dialogYesCherryPick" },
    { menu: "commit", entries: commitEntries, title: "revert…", action: "dialogYesRevert" },
    { menu: "commit", entries: commitEntries, title: "merge…", action: "dialogYesMerge" },
    { menu: "local branch", entries: localEntries, title: "merge…", action: "dialogYesMerge" },
    {
      menu: "local branch",
      entries: localEntries,
      title: "renameBranch…",
      action: "dialogRenameBranchSubmit"
    }
  ])("$title on the $menu menu submits with $action and is not destructive", (row) => {
    const form = openForm(row.entries(), row.title);
    expect(form.action).toBe(row.action);
    expect(form.destructive).toBe(false);
  });

  it.each([
    { menu: "commit", entries: commitEntries, title: "reset…", action: "dialogYesReset" },
    { menu: "local branch", entries: localEntries, title: "deleteBranch…", action: "deleteBranch" },
    { menu: "tag", entries: tagEntries, title: "deleteTag…", action: "deleteTag" }
  ])("$title on the $menu menu submits with $action and is destructive", (row) => {
    const form = openForm(row.entries(), row.title);
    expect(form.action).toBe(row.action);
    expect(form.destructive).toBe(true);
  });

  it.each(["addTag…", "createBranch…", "checkout…", "cherryPick…", "revert…", "merge…", "reset…"])(
    "%s belongs to the commit's row",
    (title) => {
      expect(openForm(commitEntries(), title).source).toBe(`commit:${H}`);
    }
  );

  it.each(["renameBranch…", "deleteBranch…", "merge…"])(
    "%s belongs to the local branch's labels",
    (title) => {
      expect(openForm(localEntries(), title).source).toBe("ref:head:wip");
    }
  );

  it("deleteTag… belongs to the tag's labels", () => {
    expect(openForm(tagEntries(), "deleteTag…").source).toBe("ref:tag:v2.0");
  });
});

describe("the inputs each form asks for", () => {
  it("Add Tag asks for a name, a type and an optional message", () => {
    expect(openForm(commitEntries(), "addTag…").inputs).toEqual([
      { kind: "ref", label: "dialogAddTagName", value: "" },
      {
        kind: "select",
        label: "dialogAddTagType",
        value: "annotated",
        options: [
          { label: "dialogAddTagTypeAnnotated", value: "annotated" },
          { label: "dialogAddTagTypeLightweight", value: "lightweight" }
        ]
      },
      {
        kind: "text",
        label: "dialogAddTagMessage",
        value: "",
        placeholder: "dialogAddTagOptional"
      }
    ]);
  });

  it("Create Branch asks for an empty, unlabelled name", () => {
    expect(openForm(commitEntries(), "createBranch…").inputs).toEqual([{ kind: "ref", value: "" }]);
  });

  it("Rename starts from the name the branch has now", () => {
    expect(openForm(localEntries(), "renameBranch…").inputs).toEqual([
      { kind: "ref", value: "wip" }
    ]);
  });

  it("Reset offers the three modes, mixed first chosen, under no label of its own", () => {
    const { inputs } = openForm(commitEntries(), "reset…");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).not.toHaveProperty("label");
    const mode = asSelect(inputs[0]);
    expect(mode.value).toBe("mixed");
    expect(mode.options).toEqual([
      { label: "dialogResetSoft", value: "soft" },
      { label: "dialogResetMixed", value: "mixed" },
      { label: "dialogResetHard", value: "hard" }
    ]);
  });

  it("Create Worktree on a remote's HEAD starts from its full ref name", () => {
    const { inputs } = openForm(refMenu(remoteRef("upstream/HEAD"), false), "addWorktree…");
    expect(inputs[3]?.value).toBe("refs/remotes/upstream/HEAD");
  });

  describe.each(["cherryPick…", "revert…"])("%s", (title) => {
    it.each([
      { parents: "no parents", parentHashes: [] },
      { parents: "one parent", parentHashes: ["base-one"] }
    ])("asks nothing for a commit with $parents", ({ parentHashes }) => {
      const entries = commitMenu(commitNode(PLAIN_ID, parentHashes), NO_MESSAGES);
      expect(openForm(entries, title).inputs).toEqual([]);
    });

    it("lets a merge choose its parent, listed by short hash", () => {
      const entries = commitMenu(commitNode(PLAIN_ID, ["base-one", "base-two"]), NO_MESSAGES);
      expect(openForm(entries, title).inputs).toEqual([
        {
          kind: "select",
          value: "1",
          options: [
            { label: "base-one", value: "1" },
            { label: "base-two", value: "2" }
          ]
        }
      ]);
    });

    it("adds each parent's known message after its short hash, colons and all", () => {
      const merge = commitNode(H, ["d".repeat(40), "e".repeat(40), "9".repeat(40)]);
      const messages: CommitMessages = new Map([
        ["d".repeat(40), "Start here"],
        ["9".repeat(40), "Fix: typo"]
      ]);
      const { inputs } = openForm(commitMenu(merge, messages), title);
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).not.toHaveProperty("label");
      const parent = asSelect(inputs[0]);
      expect(parent.value).toBe("1");
      expect(parent.options).toEqual([
        { label: "dddddddd: Start here", value: "1" },
        { label: "eeeeeeee", value: "2" },
        { label: "99999999: Fix: typo", value: "3" }
      ]);
    });
  });
});

describe("what a submit sends", () => {
  describe.each([
    { title: "cherryPick…", command: "cherrypickCommit" },
    { title: "revert…", command: "revertCommit" }
  ])("$title", ({ title, command }) => {
    it.each([
      { parents: "no parents", parentHashes: [] },
      { parents: "one parent", parentHashes: ["base-one"] }
    ])("on a commit with $parents sends parent index 0", ({ parentHashes }) => {
      const entries = commitMenu(commitNode(PLAIN_ID, parentHashes), NO_MESSAGES);
      openForm(entries, title).onSubmit([]);
      expect(vscodeApi.postMessage).toHaveBeenCalledWith({
        command,
        ...envelope,
        commitHash: PLAIN_ID,
        parentIndex: 0
      });
    });

    it("on a merge sends the chosen parent as a number", () => {
      const entries = commitMenu(commitNode(PLAIN_ID, ["base-one", "base-two"]), NO_MESSAGES);
      openForm(entries, title).onSubmit(["2"]);
      expect(vscodeApi.postMessage).toHaveBeenCalledWith({
        command,
        ...envelope,
        commitHash: PLAIN_ID,
        parentIndex: 2
      });
    });

    it("on a merge of three sends the full hash and the third parent", () => {
      const merge = commitNode(H, ["d".repeat(40), "e".repeat(40), "9".repeat(40)]);
      const messages: CommitMessages = new Map([["9".repeat(40), "Fix: typo"]]);
      openForm(commitMenu(merge, messages), title).onSubmit(["3"]);
      expect(lastPosted()).toEqual({ command, ...envelope, commitHash: H, parentIndex: 3 });
    });
  });

  it("Add Tag sends a lightweight tag without its message, and an annotated one as typed", () => {
    openForm(commitEntries(), "addTag…").onSubmit(["v3", "lightweight", "typed anyway"]);
    expect(lastPosted()).toEqual({
      command: "addTag",
      ...envelope,
      tagName: "v3",
      commitHash: H,
      lightweight: true,
      message: ""
    });

    openForm(commitEntries(), "addTag…").onSubmit(["v2", "annotated", "  Release notes  "]);
    expect(lastPosted()).toEqual({
      command: "addTag",
      ...envelope,
      tagName: "v2",
      commitHash: H,
      lightweight: false,
      message: "  Release notes  "
    });
  });

  it("Reset sends the chosen mode", () => {
    openForm(commitEntries(), "reset…").onSubmit(["soft"]);
    expect(lastPosted()).toEqual({
      command: "resetToCommit",
      ...envelope,
      commitHash: H,
      resetMode: "soft"
    });
  });

  it.each([false, true])(
    "Rename to the same name only closes the form; a change of case renames (isHeadBranch %s)",
    (isHead) => {
      openForm(refMenu(LOCAL, isHead), "renameBranch…").onSubmit(["wip"]);
      expect(vscodeApi.postMessage).not.toHaveBeenCalled();
      expect(dialog.value).toBeNull();

      openForm(refMenu(LOCAL, isHead), "renameBranch…").onSubmit(["Wip"]);
      expect(allPosted()).toEqual([
        { command: "renameBranch", ...envelope, oldName: "wip", newName: "Wip" }
      ]);
    }
  );

  it("a form submitted after another repository was selected sends nothing and closes", () => {
    const form = openForm(commitEntries(), "createBranch…");
    selectedRepo.value = "/work/other";
    form.onSubmit(["feature"]);
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(dialog.value).toBeNull();
  });
});

describe("checking out a branch", () => {
  it("checks a local branch out at once, with no fetch key at all", () => {
    checkoutBranchAction(LOCAL);
    expect(vscodeApi.postMessage).toHaveBeenCalledTimes(1);
    const { repo, requestId, ...command } = lastPosted()!;
    expect(repo).toBe(REPO);
    expect(requestId).toEqual(expect.any(String));
    expect(command).toStrictEqual({
      command: "checkoutBranch",
      branchName: "wip",
      remoteBranch: null
    });
  });

  it.each([TAG, remoteRef("upstream/HEAD"), remoteRef("fork/upstream/HEAD")])(
    "does nothing for $type $name",
    (gitRef) => {
      contextMenu.value = null;
      checkoutBranchAction(gitRef);
      expect(vscodeApi.postMessage).not.toHaveBeenCalled();
      expect(dialog.value).toBeNull();
      expect(contextMenu.value).toBeNull();
    }
  );

  it("asks for the remotes before checking out a remote branch whose name merely holds HEAD", () => {
    checkoutBranchAction(remoteRef("upstream/HEADS"));
    expect(lastPosted()).toMatchObject({ command: "loadRemotes", branchName: null });
  });

  it("does nothing while no repository is selected", () => {
    selectedRepo.value = undefined;
    checkoutBranchAction(LOCAL);
    checkoutBranchAction(REMOTE);
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(dialog.value).toBeNull();
  });

  it.each([
    { name: "upstream/develop", local: "develop" },
    { name: "upstream/fix/login-form", local: "fix/login-form" },
    { name: "fork/upstream/fix/login-form", local: "fix/login-form" }
  ])("offers $local for $name, then checks it out with a fetch", ({ name, local }) => {
    checkoutBranchAction(remoteRef(name, PLAIN_ID));
    const request = lastPosted() as { command: string; repo: string; requestId: string };
    expect(request.command).toBe("loadRemotes");

    handleLoadRemotes({
      repo: request.repo,
      requestId: request.requestId,
      remotes: ["fork", "fork/upstream", "upstream"],
      upstream: null,
      pushRemote: null,
      status: null
    });
    const form = shownForm();
    expect(form.inputs).toEqual([
      { kind: "ref", value: local },
      { kind: "checkbox", label: "fetchBeforeCheckout", value: true }
    ]);

    form.onSubmit([local, true]);
    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      command: "checkoutBranch",
      repo: REPO,
      requestId: request.requestId,
      branchName: local,
      remoteBranch: name,
      fetch: true
    });
  });

  it("the fetch entry of a remote's HEAD asks for the remotes", () => {
    choose(refMenu(remoteRef("upstream/HEAD"), false), "fetch…");
    expect(lastPosted()).toMatchObject({ command: "loadRemotes", branchName: null });
  });
});
