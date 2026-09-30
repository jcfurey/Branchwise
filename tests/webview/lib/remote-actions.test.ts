// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryResult } from "@/backend/types";
import { closeDialog, openErrorDialog } from "@/webview/lib/actions";
import { handleActionResult } from "@/webview/lib/handler/action-result";
import { refMenu } from "@/webview/lib/menus";
import {
  handleLoadRemotes,
  openRemoteAction,
  sendRemoteAction
} from "@/webview/lib/remote-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";

const mocks = vi.hoisted(() => {
  vi.stubGlobal("viewState", {
    initialLoadCommits: 300,
    lastActiveRepo: null,
    repos: {},
    showCurrentBranchByDefault: false
  });
  return { postMessage: vi.fn() };
});
vi.mock("@/webview/lib/vscode", () => ({
  vscode: { postMessage: mocks.postMessage, getState: vi.fn(), setState: vi.fn() }
}));

beforeEach(() => {
  mocks.postMessage.mockClear();
  selectedRepo.value = "/repo";
  dialog.value = null;
  Object.defineProperty(window, "l10n", {
    configurable: true,
    value: new Proxy({}, { get: (_target, key) => String(key) })
  });
});

function respond(
  request: { repo: string; requestId: string },
  overrides: Partial<QueryResult<"loadRemotes">> = {}
) {
  handleLoadRemotes({
    ...request,
    remotes: ["origin", "upstream"],
    upstream: null,
    pushRemote: null,
    status: null,
    ...overrides
  });
}

function prepare(
  action: "push" | "pull" | "fetch",
  overrides: Partial<QueryResult<"loadRemotes">> = {}
) {
  openRemoteAction(action, "feature/navigation");
  const request = mocks.postMessage.mock.lastCall![0] as { repo: string; requestId: string };
  respond(request, overrides);
  const form = dialog.value;
  if (form?.kind !== "form") {
    throw new Error("Expected a remote action form");
  }
  return { form, request };
}

describe("remote action dialogs", () => {
  it("opens a review before publishing the clicked branch", () => {
    const { form } = prepare("push");
    expect(form.inputs.map((input) => input.value)).toEqual([
      "origin",
      "feature/navigation",
      true,
      false
    ]);
    mocks.postMessage.mockClear();
    form.onSubmit(["upstream", "review/navigation", true, false]);
    expect(dialog.value).toMatchObject({ kind: "content", message: "syncPreview" });
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });

  it("uses an existing upstream name and preserves tracking by default", () => {
    const { form } = prepare("push", {
      upstream: { remote: "upstream", branchName: "release/stable" },
      pushRemote: "upstream"
    });
    expect(form.inputs.map((input) => input.value)).toEqual([
      "upstream",
      "release/stable",
      false,
      false
    ]);
  });

  it("uses the local branch name when pushing to a different default remote", () => {
    const { form } = prepare("push", {
      upstream: { remote: "upstream", branchName: "release/stable" },
      pushRemote: "origin"
    });
    expect(form.inputs.map((input) => input.value)).toEqual([
      "origin",
      "feature/navigation",
      false,
      false
    ]);
  });

  it("fetches the chosen upstream before offering a pull preview", async () => {
    const { form } = prepare("pull", {
      upstream: { remote: "upstream", branchName: "release/stable" }
    });
    expect(form.inputs.map((input) => input.value)).toEqual(["upstream", "release/stable"]);
    form.onSubmit(["upstream", "release/stable"]);
    const request = mocks.postMessage.mock.lastCall![0];
    expect(request).toMatchObject({
      command: "repositoryAction",
      repo: "/repo",
      action: { kind: "fetch", remote: "upstream" }
    });
    handleActionResult({ ...request, status: null });
    await Promise.resolve();
    expect(dialog.value).toMatchObject({ kind: "content", message: "syncPreview" });
    expect(mocks.postMessage.mock.calls.some(([message]) => message.action?.kind === "sync")).toBe(
      false
    );
  });

  it("offers fetch for all remotes with explicit pruning", () => {
    const { form, request } = prepare("fetch");
    expect(form.inputs.map((input) => input.value)).toEqual(["", false]);
    form.onSubmit(["", true]);
    expect(mocks.postMessage).toHaveBeenLastCalledWith({
      command: "fetchRemote",
      repo: "/repo",
      requestId: request.requestId,
      remote: null,
      prune: true
    });
  });

  it("identifies a remote containing slashes when fetching from a remote branch menu", () => {
    openRemoteAction("fetch", "", "team/origin/feature/navigation");
    const request = mocks.postMessage.mock.lastCall![0] as { repo: string; requestId: string };
    respond(request, { remotes: ["team", "team/origin"] });
    const form = dialog.value;
    expect(form?.kind === "form" && form.inputs[0]?.value).toBe("team/origin");
  });

  it("does not submit an action to a different repository after an SCM switch", () => {
    const { form } = prepare("push");
    selectedRepo.value = "/another-repo";
    mocks.postMessage.mockClear();
    form.onSubmit(["origin", "feature/navigation", true]);
    expect(mocks.postMessage).not.toHaveBeenCalled();
    expect(dialog.value).toBeNull();
  });

  it("ignores late discovery results after another dialog opens", () => {
    openRemoteAction("push", "main");
    const request = mocks.postMessage.mock.lastCall![0] as { repo: string; requestId: string };
    openErrorDialog("new dialog");
    const current = dialog.value;
    respond(request);
    expect(dialog.value).toBe(current);
  });

  it("does not let a late action result replace another repository's dialog", () => {
    const { request } = prepare("push");
    sendRemoteAction(
      { command: "fetchRemote", requestId: request.requestId, remote: null, prune: false },
      "/repo",
      "fetch"
    );
    selectedRepo.value = "/another-repo";
    openErrorDialog("new dialog");
    const current = dialog.value;
    handleActionResult({
      command: "pushBranch",
      repo: "/repo",
      requestId: request.requestId,
      status: "push rejected"
    });
    expect(dialog.value).toBe(current);
  });

  it("does not let an older result close a newer action in the same repository", () => {
    const first = prepare("push");
    sendRemoteAction(
      { command: "fetchRemote", requestId: first.request.requestId, remote: null, prune: false },
      "/repo",
      "fetch"
    );
    closeDialog();
    const second = prepare("push");
    sendRemoteAction(
      { command: "fetchRemote", requestId: second.request.requestId, remote: null, prune: false },
      "/repo",
      "fetch"
    );
    const current = dialog.value;
    handleActionResult({
      command: "pushBranch",
      repo: "/repo",
      requestId: first.request.requestId,
      status: null
    });
    expect(dialog.value).toBe(current);
  });

  it("explains when a repository has no remotes", () => {
    openRemoteAction("push", "main");
    const request = mocks.postMessage.mock.lastCall![0] as { repo: string; requestId: string };
    respond(request, { remotes: [] });
    expect(dialog.value).toMatchObject({ kind: "error", message: "noRemotesConfigured" });
  });

  it("offers push on every local branch and pull on the checked-out branch", () => {
    const branch = { type: "head" as const, name: "main", hash: "commit" };
    const inactive = refMenu(branch, false)
      .filter((entry) => entry !== null)
      .map((entry) => entry.title);
    const active = refMenu(branch, true)
      .filter((entry) => entry !== null)
      .map((entry) => entry.title);
    expect(inactive).toContain("pushBranch…");
    expect(inactive).not.toContain("pullBranch…");
    expect(active).toContain("pushBranch…");
    expect(active).toContain("pullBranch…");
  });

  describe("remote-tracking refs", () => {
    function open(action: "branchDelete" | "checkout", ref: string, remotes: string[]) {
      openRemoteAction(action, "", ref);
      const request = mocks.postMessage.mock.lastCall![0] as { repo: string; requestId: string };
      mocks.postMessage.mockClear();
      respond(request, { remotes });
      return dialog.value;
    }

    it.each([
      ["a plain", "upstream/topic"],
      ["a slash-containing", "team/mirror/topic"]
    ])("explains deleting a ref of %s removed remote instead of using another", (_, ref) => {
      expect(open("branchDelete", ref, ["origin"])).toMatchObject({
        kind: "error",
        message: "remoteNotConfigured"
      });
      expect(mocks.postMessage).not.toHaveBeenCalled();
    });

    it.each([
      ["origin/topic", ["origin"], "origin"],
      ["team/mirror/topic", ["origin", "team", "team/mirror"], "team/mirror"]
    ])("deletes %s from its own remote", (ref, remotes, remote) => {
      const picker = open("branchDelete", ref, remotes);
      if (picker?.kind !== "form") {
        throw new Error("Expected a remote picker");
      }
      expect(picker.inputs[0]?.value).toBe(remote);
      picker.onSubmit([remote]);
      const confirmation = dialog.value;
      if (confirmation?.kind !== "form") {
        throw new Error("Expected a confirmation");
      }
      confirmation.onSubmit([]);
      expect(mocks.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: { kind: "deleteRemoteRef", remote, name: "topic", refType: "branch" }
        })
      );
    });

    it.each([
      ["upstream/topic", ["origin"], "topic", false],
      ["team/mirror/topic", ["origin"], "mirror/topic", false],
      ["team/mirror/topic", [], "mirror/topic", false],
      ["team/mirror/topic", ["team/mirror"], "topic", true]
    ])("suggests the local name of %s with remotes %j", (ref, remotes, suggestion, fetch) => {
      const form = open("checkout", ref, remotes);
      if (form?.kind !== "form") {
        throw new Error("Expected a checkout form");
      }
      expect(form.inputs.map((input) => input.value)).toEqual([suggestion, fetch]);
    });
  });
});
