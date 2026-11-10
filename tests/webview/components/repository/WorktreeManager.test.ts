// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";

import type { RepositoryState, WorktreeDetails } from "@/backend/types";
import { WorktreeManager } from "@/webview/components/repository/WorktreeManager";
import { selectedRepo } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const MAIN = "/work/app";
const LINKED = "/work/app-review";

function worktree(details: Partial<WorktreeDetails>): WorktreeDetails {
  return {
    path: MAIN,
    head: "a".repeat(40),
    branch: "main",
    bare: false,
    locked: false,
    prunable: false,
    ...details
  };
}

let container: HTMLDivElement;
/** The buttons of the worktree at `path`, by their labels. */
function buttons(path: string) {
  const card = [...container.querySelectorAll("div.rounded")].find((item) =>
    [...item.querySelectorAll("p")].some((line) => line.textContent === path)
  )!;
  return new Map([...card.querySelectorAll("button")].map((item) => [item.textContent, item]));
}
function show(shown: string) {
  const state = {
    worktrees: [worktree({}), worktree({ path: LINKED, branch: "review" })]
  } as RepositoryState;
  act(() => render(h(WorktreeManager, { state, repo: shown }), container));
}

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

it("offers to open another worktree in a new window, but not the one shown", () => {
  selectedRepo.value = MAIN;
  show(MAIN);
  // This window is on it already.
  expect(buttons(MAIN).get("openWorktree")!.disabled).toBe(true);
  expect(buttons(LINKED).get("openWorktree")!.disabled).toBe(false);

  act(() => buttons(LINKED).get("openWorktree")!.click());
  expect(vscodeApi.postMessage.mock.lastCall![0]).toMatchObject({
    command: "repositoryAction",
    repo: MAIN,
    action: { kind: "openWorktree", path: LINKED }
  });
});

it("follows the worktree shown: from a linked one, the main worktree can be opened", () => {
  selectedRepo.value = LINKED;
  show(LINKED);
  expect(buttons(LINKED).get("openWorktree")!.disabled).toBe(true);
  expect(buttons(MAIN).get("openWorktree")!.disabled).toBe(false);
});
