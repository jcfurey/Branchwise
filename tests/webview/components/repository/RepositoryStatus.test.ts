// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BranchDetails, RepositoryState } from "@/backend/types";
import { RepositoryStatus } from "@/webview/components/repository/RepositoryStatus";
import { repositoryState, repositoryStateError } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const REPO = "/work/strip";
const ORIGIN = { name: "origin", fetchUrl: "https://example.org/r.git", pushUrl: null };

function branch(details: Partial<BranchDetails>): BranchDetails {
  return {
    name: "main",
    hash: "a".repeat(40),
    upstream: "origin/main",
    gone: false,
    ahead: 0,
    behind: 0,
    ...details
  } as BranchDetails;
}

function state(tracking: Partial<BranchDetails>, more: Partial<RepositoryState> = {}) {
  return {
    remotes: [ORIGIN],
    pushDefault: null,
    branches: [branch(tracking)],
    remoteBranches: [],
    tags: [],
    worktrees: [],
    head: "main",
    operation: null,
    conflicts: [],
    staged: 0,
    ...more
  } as RepositoryState;
}

let container: HTMLDivElement;
const actions = () => [...container.querySelectorAll("button")].map((button) => button.textContent);
function show(shown: RepositoryState) {
  act(() => {
    repositoryState.value = shown;
  });
}
function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label
  )!;
  act(() => button.click());
}

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  selectedRepo.value = REPO;
  repositoryStateError.value = null;
  repositoryState.value = null;
  container = document.createElement("div");
  document.body.append(container);
  act(() => render(h(RepositoryStatus, null), container));
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  repositoryState.value = null;
});

describe("the actions beside the checked-out branch", () => {
  it("are what its counts call for: Pull when behind, Push when ahead, both when diverged", () => {
    show(state({}));
    expect(actions()).toEqual(["configureUpstream"]);

    show(state({ behind: 2 }));
    expect(actions()).toEqual(["pullBranch…", "configureUpstream"]);

    show(state({ ahead: 1 }));
    expect(actions()).toEqual(["pushBranch…", "configureUpstream"]);

    show(state({ ahead: 1, behind: 3 }));
    expect(actions()).toEqual(["pullBranch…", "pushBranch…", "configureUpstream"]);
  });

  it("offer a push for a branch without an upstream, or with one that was deleted, where there is a remote", () => {
    show(state({ upstream: "" }));
    expect(actions()).toEqual(["pushBranch…", "configureUpstream"]);

    // The counts against a deleted upstream mean nothing, and there is nothing to pull.
    show(state({ gone: true, ahead: 0, behind: 4 }));
    expect(actions()).toEqual(["pushBranch…", "configureUpstream"]);

    show(state({ upstream: "" }, { remotes: [] }));
    expect(actions()).toEqual(["configureUpstream"]);
  });

  it("leave pulling and pushing alone while an operation is stopped, and on a detached HEAD", () => {
    show(
      state(
        { ahead: 1, behind: 1 },
        { operation: { kind: "rebase" } as RepositoryState["operation"] }
      )
    );
    expect(actions()).not.toContain("pullBranch…");
    expect(actions()).not.toContain("pushBranch…");
    expect(actions()).toContain("configureUpstream");

    show(state({ ahead: 1, behind: 1 }, { head: "" }));
    expect(actions()).toEqual([]);
  });

  it("open the reviews that the branch's menu opens, for the checked-out branch", () => {
    show(state({ name: "topic", ahead: 1, behind: 1 }, { head: "topic" }));

    click("pullBranch…");
    expect(vscodeApi.postMessage.mock.lastCall![0]).toMatchObject({
      command: "loadRemotes",
      repo: REPO
    });
    vscodeApi.postMessage.mockClear();
    click("pushBranch…");
    expect(vscodeApi.postMessage.mock.lastCall![0]).toMatchObject({
      command: "loadRemotes",
      repo: REPO
    });
  });
});
