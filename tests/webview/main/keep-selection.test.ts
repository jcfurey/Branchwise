// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { selectedRepo } from "@/webview/lib/stores";

import {
  app,
  deferred,
  fakeExtension,
  initialized,
  posted,
  prepareShell,
  repo,
  scanned
} from "./page-harness";

const scan = deferred();

beforeAll(async () => {
  prepareShell();
  fakeExtension((method) => (method === "webview.initialize" ? initialized() : scan.answer));
  await import("@/webview/main");
});

afterAll(() => vi.unstubAllGlobals());

it("keeps a selected repository that the scan lists", async () => {
  await vi.waitFor(() => expect(posted()).toContain("rpc:repo.scan"));
  selectedRepo.value = "/r/second";
  scan.release(scanned(repo("/r/first"), repo("/r/second")));

  await vi.waitFor(() => expect(app().querySelector("[data-branchwise]")).not.toBeNull());
  await vi.waitFor(() => expect(posted()).toContain("viewReady"));
  // Effects run after the next frame, or after 100 ms without one; wait longer than either.
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(selectedRepo.value).toBe("/r/second");
  expect(posted()).not.toContain("selectRepo");
});
