// @vitest-environment jsdom
import type { VNode } from "preact";
import { beforeAll, beforeEach, expect, it } from "vitest";

import type { GitRef, RepositoryState } from "@/backend/types";
import type { SyncOptions } from "@/webview/components/history/WorkflowTools";
import { refMenu } from "@/webview/lib/menus";
import { handleLoadRemotes } from "@/webview/lib/remote-actions";
import { repositoryState } from "@/webview/lib/repository-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";
import type { DialogState } from "@/webview/types";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const H = "f".repeat(40);
const FRESH: GitRef = { type: "head", name: "feature/new", hash: H };

const hosted: RepositoryState = {
  remotes: [
    {
      name: "origin",
      fetchUrls: ["git@github.com:owner/repo.git"],
      pushUrls: [],
      defaultBranch: "main"
    }
  ],
  pushDefault: null,
  branches: [
    {
      name: "feature/new",
      hash: H,
      upstream: "",
      ahead: 0,
      behind: 0,
      gone: false,
      date: 0,
      merged: false
    }
  ],
  remoteBranches: [],
  tags: [],
  worktrees: [],
  head: "feature/new",
  operation: null,
  conflicts: [],
  staged: 0
};

/** What the push review the dialog shows was given. */
type Review = {
  repo: string;
  branch: string;
  remote: string;
  remoteBranch: string;
  options: SyncOptions;
  onDone: (() => void) | undefined;
};

const posted = () =>
  vscodeApi.postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  selectedRepo.value = "/repo";
  repositoryState.value = hosted;
  dialog.value = null;
  vscodeApi.postMessage.mockClear();
});

/** Choose `title` for the branch, answer its remotes and submit the push dialog with `values`. */
function push(title: string, values: [string, string, boolean, boolean]) {
  refMenu(FRESH, true)
    .find((entry) => entry?.title === title)!
    .onClick();
  const load = posted().at(-1) as { requestId: string };
  handleLoadRemotes({
    repo: "/repo",
    requestId: load.requestId,
    remotes: ["origin"],
    upstream: null,
    pushRemote: null,
    status: null
  });
  const form = dialog.value as Extract<DialogState, { kind: "form" }>;
  const setUpstream = form.inputs[2];
  form.onSubmit(values);
  const review = dialog.value as Extract<DialogState, { kind: "content" }>;
  return { setUpstream, review: (review.content as VNode<Review>).props };
}

it("ticks set upstream and opens the pull request page once the push has succeeded", () => {
  const { setUpstream, review } = push("pushAndCreatePullRequest…", [
    "origin",
    "feature/new",
    true,
    false
  ]);
  expect(setUpstream).toMatchObject({ label: "setUpstream", value: true });
  expect(review).toMatchObject({
    repo: "/repo",
    branch: "feature/new",
    remote: "origin",
    remoteBranch: "feature/new",
    options: { operation: "push", setUpstream: true, force: false }
  });
  // Nothing opens before the push has gone through.
  expect(posted().some((message) => message.method === "url.open")).toBe(false);

  review.onDone!();
  expect(posted().at(-1)).toMatchObject({
    kind: "rpc.request",
    method: "url.open",
    params: "https://github.com/owner/repo/compare/main...feature/new?expand=1"
  });
});

it("opens the page for the name the branch was pushed under", () => {
  push("pushAndCreatePullRequest…", ["origin", "renamed", true, false]).review.onDone!();
  expect(posted().at(-1)).toMatchObject({
    params: "https://github.com/owner/repo/compare/main...renamed?expand=1"
  });
});

it("leaves a plain push without a page to open", () => {
  const { review } = push("pushBranch…", ["origin", "feature/new", true, false]);
  expect(review.onDone).toBeUndefined();
});
