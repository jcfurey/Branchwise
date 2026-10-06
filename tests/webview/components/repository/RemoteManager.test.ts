// @vitest-environment jsdom

import { Fragment, h, render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BranchDetails, RemoteDetails, RepositoryState } from "@/backend/types";
import {
  addRemote,
  editRemote,
  openRemotes,
  openTracking,
  RemoteManager,
  remoteMenu,
  removeRemote,
  renameRemote
} from "@/webview/components/repository/RemoteManager";
import { Dialog } from "@/webview/components/ui/Dialog";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";
import type { DialogState } from "@/webview/types";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

type Posted = { command: string; repo?: string; requestId?: string; [field: string]: unknown };

const posts = (): Array<Posted> => vscodeApi.postMessage.mock.calls.map(([sent]) => sent);
const lastPost = () => posts().at(-1)!;
/** The Git actions sent so far, without their envelopes. */
const sentActions = () =>
  posts()
    .filter(({ command }) => command === "repositoryAction")
    .map(({ action }) => action);

const origin: RemoteDetails = {
  name: "origin",
  fetchUrls: ["https://a/x.git", "https://b/x.git"],
  pushUrls: ["ssh://p"]
};
const mirror: RemoteDetails = { name: "team/mirror", fetchUrls: ["/srv/m"], pushUrls: [] };

function branchNamed(name: string, upstream = "", gone = false): BranchDetails {
  return {
    name,
    upstream,
    gone,
    hash: "0".repeat(40),
    ahead: 0,
    behind: 0,
    date: 0,
    merged: false
  };
}

function repository(extra: Partial<RepositoryState> = {}): RepositoryState {
  const empty: RepositoryState = {
    head: "main",
    operation: null,
    conflicts: [],
    staged: 0,
    tags: [],
    worktrees: [],
    remotes: [],
    pushDefault: null,
    branches: [],
    remoteBranches: []
  };
  return { ...empty, ...extra };
}

/** Answer the loading dialog's read with `state`, as the extension would. */
function loadState(state: RepositoryState) {
  const { repo, requestId } = lastPost();
  act(() =>
    handleRepositoryQuery({
      repo: repo!,
      requestId: requestId!,
      data: { kind: "state", state },
      status: null
    })
  );
}

function openForm(): Extract<DialogState, { kind: "form" }> {
  const shown = dialog.value;
  if (shown?.kind !== "form") {
    throw new Error(`a form should be open, not ${shown?.kind ?? "nothing"}`);
  }
  return shown;
}

let page: HTMLDivElement;

/** The markup a dialog message renders to. */
function markup(children: ComponentChildren) {
  const holder = document.createElement("div");
  render(h(Fragment, null, children), holder);
  return holder.innerHTML;
}

function useStrings(strings: typeof window.l10n) {
  Object.defineProperty(window, "l10n", { configurable: true, value: strings });
}

function buttonsIn(root: ParentNode) {
  return [...root.querySelectorAll("button")];
}

function press(text: string) {
  const target = buttonsIn(page).find((button) => button.textContent === text);
  expect(target, text).toBeDefined();
  act(() => target!.click());
}

beforeAll(() => {
  setupWebviewTest();
});
beforeEach(() => {
  selectedRepo.value = "/repo";
  dialog.value = null;
  vscodeApi.postMessage.mockClear();
  page = document.createElement("div");
  document.body.append(page);
});
afterEach(() => {
  act(() => render(null, page));
  page.remove();
});

describe("adding a remote", () => {
  it("asks for a name, a URL and whether to fetch", () => {
    addRemote("/repo");
    expect(openForm()).toMatchObject({
      message: "addRemote",
      inputs: [
        { kind: "ref", label: "remoteName", value: "" },
        { kind: "text", label: "remoteUrl", value: "" },
        { kind: "checkbox", label: "fetchAfterAdding", value: true }
      ],
      action: "addRemote",
      source: null,
      destructive: false
    });
  });

  it("sends the trimmed name and URL, cancellable while it fetches", () => {
    addRemote("/repo");
    openForm().onSubmit(["up", "  https://example.com/p.git \t", true]);
    expect(lastPost()).toEqual({
      command: "repositoryAction",
      requestId: expect.stringMatching(/^repository-action-\d+$/),
      action: { kind: "addRemote", name: "up", url: "https://example.com/p.git", fetch: true },
      repo: "/repo"
    });
    expect(dialog.value).toMatchObject({
      kind: "running",
      message: "addRemote",
      detail: "/repo\nup"
    });
    expect(dialog.value).toHaveProperty("onCancel");

    addRemote("/repo");
    openForm().onSubmit([" local ", "/srv/local", false]);
    expect(sentActions().at(-1)).toEqual({
      kind: "addRemote",
      name: "local",
      url: "/srv/local",
      fetch: false
    });
    expect(dialog.value).not.toHaveProperty("onCancel");
  });
});

describe("editing a remote", () => {
  it("shows every URL, one per line", () => {
    editRemote(origin, "/repo");
    const form = openForm();
    expect(form.inputs).toEqual([
      { kind: "textarea", label: "fetchUrls", value: "https://a/x.git\nhttps://b/x.git" },
      { kind: "textarea", label: "pushUrls", value: "ssh://p" }
    ]);
    expect(form).toMatchObject({ action: "save", source: null, destructive: false });
    expect(markup(form.message)).toBe("editRemote: <b>origin</b>");
  });

  it("trims the lines and drops the blank ones, keeping order and repeats", () => {
    editRemote(origin, "/repo");
    openForm().onSubmit([" a \r\n\n  b\n", "\n \n"]);
    editRemote(mirror, "/repo");
    openForm().onSubmit(["c\r\nc\nb", "p1\r\n p0"]);
    expect(sentActions()).toEqual([
      { kind: "editRemote", name: "origin", fetchUrls: ["a", "b"], pushUrls: [] },
      {
        kind: "editRemote",
        name: "team/mirror",
        fetchUrls: ["c", "c", "b"],
        pushUrls: ["p1", "p0"]
      }
    ]);
  });
});

describe("renaming a remote", () => {
  it("asks for the new name in one unlabelled field", () => {
    renameRemote(mirror, "/repo");
    expect(openForm()).toMatchObject({
      message: "renameRemote",
      inputs: [{ kind: "ref", value: "team/mirror" }],
      action: "renameRemote",
      source: null,
      destructive: false
    });
    expect(openForm().inputs[0]).not.toHaveProperty("label");
    openForm().onSubmit(["x/y"]);
    expect(sentActions()).toEqual([{ kind: "renameRemote", name: "team/mirror", newName: "x/y" }]);
  });

  it("sends nothing when the name is kept", () => {
    renameRemote(mirror, "/repo");
    openForm().onSubmit(["team/mirror"]);
    expect(posts()).toEqual([]);
  });
});

describe("removing a remote", () => {
  let keyNames: typeof window.l10n;
  // The key names carry no placeholder, so these tests give the question one.
  beforeEach(() => {
    keyNames = window.l10n;
    useStrings(
      new Proxy(keyNames, {
        get: (names, key) =>
          key === "removeRemoteConfirm" ? "Drop {0} now?" : Reflect.get(names, key)
      })
    );
  });
  afterEach(() => useStrings(keyNames));

  it("confirms with focus on Cancel, naming the remote in bold", () => {
    act(() => {
      render(h(Dialog, null), page);
      removeRemote(mirror, "/repo");
    });
    const form = openForm();
    expect(form).toMatchObject({
      inputs: [],
      action: "removeRemote",
      source: null,
      destructive: true
    });
    expect(markup(form.message)).toBe("Drop <b>team/mirror</b> now?");
    expect(document.activeElement).toBe(page.querySelector("[data-dialog-cancel]"));
    form.onSubmit([]);
    expect(lastPost()).toMatchObject({
      command: "repositoryAction",
      action: { kind: "removeRemote", name: "team/mirror" },
      repo: "/repo"
    });
  });
});

describe("the remote menu", () => {
  it("lists fetch, the three edits and the manager", () => {
    const entries = remoteMenu(mirror, "/repo");
    expect(entries.map((entry) => entry?.title ?? null)).toEqual([
      "fetch…",
      "editRemote…",
      "renameRemote…",
      "removeRemote…",
      null,
      "manageRemotes"
    ]);
    expect(remoteMenu(mirror, "/repo")).not.toBe(entries);
  });

  it("opens the fetch dialog, each form and the manager", () => {
    const [fetch, edit, rename, remove, , manage] = remoteMenu(mirror, "/repo");
    fetch!.onClick();
    expect(lastPost()).toEqual({
      command: "loadRemotes",
      repo: "/repo",
      requestId: expect.stringMatching(/^remote-\d+$/),
      branchName: null
    });
    edit!.onClick();
    expect(openForm().inputs.map((input) => input.kind)).toEqual(["textarea", "textarea"]);
    rename!.onClick();
    expect(openForm().inputs).toEqual([{ kind: "ref", value: "team/mirror" }]);
    remove!.onClick();
    expect(openForm()).toMatchObject({ inputs: [], destructive: true });
    manage!.onClick();
    expect(lastPost()).toMatchObject({ command: "repositoryQuery", query: { kind: "state" } });
    expect(dialog.value).toMatchObject({ kind: "running", message: "loadingRepository" });
  });
});

describe("the manager", () => {
  const withTwo = repository({ remotes: [origin, mirror] });
  const choose = (value: string) => {
    const select = page.querySelector("select")!;
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("lists each remote with its URLs and actions, then the push default", () => {
    act(() => render(h(RemoteManager, { state: withTwo, repo: "/repo" }), page));
    expect(buttonsIn(page).map((button) => button.textContent)).toEqual([
      "addRemote",
      "editRemote",
      "renameRemote",
      "removeRemote",
      "editRemote",
      "renameRemote",
      "removeRemote",
      "save"
    ]);
    expect([...page.querySelectorAll("b")].map((name) => name.textContent)).toEqual([
      "origin",
      "team/mirror"
    ]);
    expect([...page.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "https://a/x.git\nhttps://b/x.git",
      "remotePushUrls: ssh://p",
      "/srv/m"
    ]);
    const select = page.querySelector<HTMLSelectElement>("label select")!;
    expect(select.closest("label")?.textContent).toContain("defaultPushRemote");
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ["", "defaultSetting"],
      ["origin", "origin"],
      ["team/mirror", "team/mirror"]
    ]);
    expect(select.value).toBe("");
    expect(posts()).toEqual([]);
  });

  it("leaves out the fetch line of a remote without fetch URLs", () => {
    const pushOnly: RemoteDetails = { name: "pushonly", fetchUrls: [], pushUrls: ["ssh://q"] };
    act(() =>
      render(h(RemoteManager, { state: repository({ remotes: [pushOnly] }), repo: "/repo" }), page)
    );
    expect([...page.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "remotePushUrls: ssh://q"
    ]);
  });

  it("is only the add button, the choice and Save without remotes", () => {
    act(() => render(h(RemoteManager, { state: repository(), repo: "/repo" }), page));
    expect(buttonsIn(page).map((button) => button.textContent)).toEqual(["addRemote", "save"]);
    expect(page.querySelectorAll("option")).toHaveLength(1);
    press("addRemote");
    expect(openForm().message).toBe("addRemote");
  });

  it("opens each remote's forms for the repository it shows", () => {
    act(() => render(h(RemoteManager, { state: withTwo, repo: "/repo" }), page));
    const renameButtons = buttonsIn(page).filter((button) => button.textContent === "renameRemote");
    act(() => renameButtons[1]!.click());
    openForm().onSubmit(["team/other"]);
    expect(lastPost()).toMatchObject({
      action: { kind: "renameRemote", name: "team/mirror", newName: "team/other" },
      repo: "/repo"
    });
  });

  it("closes without writing when the push default is saved unchanged", () => {
    act(() => render(h(Dialog, null), page));
    openRemotes();
    loadState(repository({ remotes: [origin, mirror], pushDefault: "origin" }));
    expect(page.querySelector("select")!.value).toBe("origin");
    press("save");
    expect(sentActions()).toEqual([]);
    expect(dialog.value).toBeNull();
  });

  it("sends a changed push default, or null for Git's default", () => {
    const configured = repository({ remotes: [origin, mirror], pushDefault: "origin" });
    act(() => render(h(RemoteManager, { state: configured, repo: "/repo" }), page));
    choose("");
    press("save");
    choose("team/mirror");
    press("save");
    expect(sentActions()).toEqual([
      { kind: "pushDefault", remote: null },
      { kind: "pushDefault", remote: "team/mirror" }
    ]);
  });

  it("starts from Git's default when the configured remote is gone", () => {
    const stale = repository({ remotes: [origin], pushDefault: "removed" });
    act(() => render(h(RemoteManager, { state: stale, repo: "/repo" }), page));
    expect(page.querySelector("select")!.value).toBe("");
    press("save");
    expect(sentActions()).toEqual([]);
    choose("origin");
    press("save");
    expect(sentActions()).toEqual([{ kind: "pushDefault", remote: "origin" }]);
  });

  it("opens with focus on the add button", () => {
    act(() => render(h(Dialog, null), page));
    openRemotes();
    expect(lastPost()).toMatchObject({ repo: "/repo", query: { kind: "state" } });
    loadState(repository({ remotes: [origin, mirror] }));
    expect(dialog.value).toMatchObject({ kind: "content", message: "manageRemotes", wide: false });
    expect(document.activeElement?.textContent).toBe("addRemote");
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });
});

describe("configuring an upstream", () => {
  const tracked = repository({
    branches: [
      branchNamed("main", "origin/main"),
      branchNamed("dev", "main"),
      branchNamed("stale", "origin/stale", true),
      branchNamed("fresh")
    ],
    remoteBranches: [{ name: "origin/main", hash: "1".repeat(40) }]
  });

  function upstreamFormFor(branch: string, state = tracked) {
    openTracking(branch);
    loadState(state);
    const form = openForm();
    const [input] = form.inputs;
    if (input?.kind !== "select") {
      throw new Error("the upstream should be chosen from a list");
    }
    return { form, input };
  }

  it("offers None, the remote-tracking refs and the other local branches", () => {
    const { form, input } = upstreamFormFor("main");
    expect(input.options).toEqual([
      { label: "none", value: "" },
      { label: "origin/main", value: "refs/remotes/origin/main" },
      { label: "dev", value: "refs/heads/dev" },
      { label: "stale", value: "refs/heads/stale" },
      { label: "fresh", value: "refs/heads/fresh" }
    ]);
    expect(input).toMatchObject({ label: "upstreamBranch", value: "refs/remotes/origin/main" });
    expect(form).toMatchObject({ action: "save", source: "ref:head:main" });
    expect(markup(form.message)).toBe("configureUpstream: <b>main</b>");
  });

  it("preselects the current upstream, remote or local, and None when it is gone or unknown", () => {
    expect(upstreamFormFor("dev").input.value).toBe("refs/heads/main");
    expect(upstreamFormFor("stale").input.value).toBe("");
    expect(upstreamFormFor("fresh").input.value).toBe("");
    const unknown = upstreamFormFor("missing");
    expect(unknown.input.value).toBe("");
    expect(unknown.input.options.map((option) => option.label)).toEqual([
      "none",
      "origin/main",
      "main",
      "dev",
      "stale",
      "fresh"
    ]);
  });

  it("prefers the remote-tracking ref over a local branch of the same name", () => {
    const shadowed = repository({
      branches: [branchNamed("work", "origin/main"), branchNamed("origin/main")],
      remoteBranches: [{ name: "origin/main", hash: "2".repeat(40) }]
    });
    expect(upstreamFormFor("work", shadowed).input.value).toBe("refs/remotes/origin/main");
    const localOnly = repository({ branches: [branchNamed("work", "base"), branchNamed("base")] });
    expect(upstreamFormFor("work", localOnly).input.value).toBe("refs/heads/base");
  });

  it("never takes an upstream named like the None label for None", () => {
    const named = repository({ branches: [branchNamed("work", "none"), branchNamed("none")] });
    const { form, input } = upstreamFormFor("work", named);
    expect(input.value).toBe("refs/heads/none");
    form.onSubmit([""]);
    expect(sentActions()).toEqual([{ kind: "setTracking", branch: "work", upstream: null }]);
  });

  it("sends nothing when the real current upstream is kept", () => {
    upstreamFormFor("fresh").form.onSubmit([""]);
    upstreamFormFor("missing").form.onSubmit([""]);
    upstreamFormFor("main").form.onSubmit(["refs/remotes/origin/main"]);
    upstreamFormFor("dev").form.onSubmit(["refs/heads/main"]);
    expect(sentActions()).toEqual([]);
  });

  it("sets, changes and removes the upstream", () => {
    upstreamFormFor("fresh").form.onSubmit(["refs/remotes/origin/main"]);
    upstreamFormFor("dev").form.onSubmit(["refs/heads/fresh"]);
    upstreamFormFor("main").form.onSubmit([""]);
    expect(sentActions()).toEqual([
      { kind: "setTracking", branch: "fresh", upstream: "refs/remotes/origin/main" },
      { kind: "setTracking", branch: "dev", upstream: "refs/heads/fresh" },
      { kind: "setTracking", branch: "main", upstream: null }
    ]);
    expect(lastPost().repo).toBe("/repo");
  });

  it("removes a gone upstream when None is saved", () => {
    upstreamFormFor("stale").form.onSubmit([""]);
    expect(sentActions()).toEqual([{ kind: "setTracking", branch: "stale", upstream: null }]);
  });

  it("opens nothing for data of another kind", () => {
    openTracking("main");
    const { repo, requestId } = lastPost();
    act(() =>
      handleRepositoryQuery({
        repo: repo!,
        requestId: requestId!,
        data: { kind: "stashes", stashes: [] },
        status: null
      })
    );
    expect(dialog.value).toBeNull();
  });
});

describe("without a selected repository", () => {
  it("opens neither the manager nor the upstream choice", () => {
    selectedRepo.value = undefined;
    openRemotes();
    openTracking("main");
    expect(posts()).toEqual([]);
    expect(dialog.value).toBeNull();
  });
});
