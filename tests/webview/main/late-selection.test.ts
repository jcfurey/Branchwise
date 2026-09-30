// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { selectedRepo } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";

import {
  app,
  fakeExtension,
  initialized,
  notify,
  posted,
  prepareShell,
  repo,
  scanned
} from "./page-harness";

beforeAll(async () => {
  prepareShell();
  fakeExtension((method) =>
    method === "webview.initialize" ? initialized() : scanned(repo("/r/first"))
  );
  // The extension holds back the repository it was asked to open until the page is ready, then
  // selects it at once. Here that answer arrives before the page has run its effects.
  const answerRequests = vscodeApi.postMessage.getMockImplementation()!;
  vscodeApi.postMessage.mockImplementation((message: { command?: string }) => {
    answerRequests(message);
    if (message.command === "viewReady") {
      notify("repo.select", repo("/r/opened"));
    }
  });
  await import("@/webview/main");
});

afterAll(() => vi.unstubAllGlobals());

it("keeps a repository the extension selects before the page's effects run", async () => {
  await vi.waitFor(() => expect(posted()).toContain("viewReady"));
  await vi.waitFor(() => expect(app().querySelector("[data-branchwise]")).not.toBeNull());
  // Effects run after the next frame, or after 100 ms without one; wait longer than either.
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(selectedRepo.value).toBe("/r/opened");
});
