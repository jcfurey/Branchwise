// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { selectedRepo } from "@/webview/lib/stores";

import {
  app,
  deferred,
  fakeExtension,
  initialized,
  notify,
  prepareShell,
  repo,
  scanned,
  type Answer
} from "./page-harness";

const scans: Answer[] = [scanned(repo("/r/only"))];

beforeAll(async () => {
  prepareShell();
  fakeExtension((method) => (method === "webview.initialize" ? initialized() : scans.shift()));
  await import("@/webview/main");
});

afterAll(() => vi.unstubAllGlobals());

it("shows the graph page for the only repository", async () => {
  await vi.waitFor(() => expect(selectedRepo.value).toBe("/r/only"));
  expect(app().querySelector("[data-branchwise]")).not.toBeNull();
});

it("keeps the page during a rescan, and gives it up to the failure", async () => {
  const rescan = deferred();
  scans.push(rescan.answer);
  notify("repo.rescan", null);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(app().querySelector("[data-branchwise]")).not.toBeNull();

  rescan.release({ error: "disk gone" });
  await vi.waitFor(() => expect(app().querySelector("[role=alert] p")).not.toBeNull());
  expect(app().querySelector("[data-branchwise]")).toBeNull();
  expect(app().textContent).toContain("Unable to load repositories: disk gone");
});

it("clears the selection once the list comes back empty", async () => {
  scans.push(scanned());
  act(() => app().querySelector<HTMLButtonElement>("[role=alert] button")!.click());
  await vi.waitFor(() => expect(app().textContent).toContain("noRepo"));
  await vi.waitFor(() => expect(selectedRepo.value).toBeUndefined());
  expect(app().querySelector("header")).toBeNull();
});
