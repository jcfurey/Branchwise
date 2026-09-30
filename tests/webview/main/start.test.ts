// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { maxCommits, selectedRepo } from "@/webview/lib/stores";
import { repoListStore } from "@/webview/lib/stores/repo-list.store";

import {
  PAGE_STRINGS,
  app,
  deferred,
  fakeExtension,
  initialized,
  notify,
  posted,
  prepareShell,
  repo,
  scanned
} from "./page-harness";

let scans = 0;
const initialize = deferred();

beforeAll(async () => {
  prepareShell();
  fakeExtension((method) => {
    if (method === "webview.initialize") {
      return initialize.answer;
    }
    if (method === "repo.scan") {
      scans += 1;
      return scanned(repo("/r/b"), repo("/r/a"));
    }
    return undefined;
  });
  await import("@/webview/main");
});

afterAll(() => vi.unstubAllGlobals());

it("shows a spinner at once, then the graph page for the first repository scanned", async () => {
  // Rendered while the script ran, before any answer.
  expect(app().querySelector("[role=status]")).not.toBeNull();
  expect(app().querySelector("[data-branchwise]")).toBeNull();
  expect(posted()).toEqual(["rpc:webview.initialize"]);

  initialize.release(initialized());
  await vi.waitFor(() => expect(posted()).toContain("viewReady"));
  expect(window.l10n).toBe(PAGE_STRINGS);
  expect(maxCommits.value).toBe(123);
  await vi.waitFor(() => expect(app().querySelector("[data-branchwise]")).not.toBeNull());
  await vi.waitFor(() => expect(selectedRepo.value).toBe("/r/b"));

  const messages = posted();
  expect(messages.filter((message) => message === "viewReady")).toHaveLength(1);
  expect(messages.indexOf("rpc:repo.scan")).toBeGreaterThan(
    messages.indexOf("rpc:webview.initialize")
  );
  expect(messages.indexOf("viewReady")).toBeGreaterThan(messages.indexOf("rpc:repo.scan"));
  expect(messages).toEqual(expect.arrayContaining(["selectRepo", "loadBranches"]));
});

it("selects a repository the extension offers, and falls back to the first after a rescan", async () => {
  notify("repo.select", repo("/r/c"));
  await vi.waitFor(() => expect(selectedRepo.value).toBe("/r/c"));
  expect(repoListStore.get()?.map((entry) => entry.path)).toContain("/r/c");

  notify("repo.rescan", null);
  await vi.waitFor(() => expect(scans).toBe(2));
  await vi.waitFor(() => expect(selectedRepo.value).toBe("/r/b"));
  expect(app().querySelector("[data-branchwise]")).not.toBeNull();
  // The page says it is ready once only.
  expect(posted().filter((message) => message === "viewReady")).toHaveLength(1);
});
