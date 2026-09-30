// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { selectedRepo } from "@/webview/lib/stores";

import {
  app,
  deferred,
  fakeExtension,
  initialized,
  posted,
  prepareShell,
  scanned,
  type Answer
} from "./page-harness";

/** The answers to the repository scans, in order. */
const scans: Answer[] = [];

beforeAll(async () => {
  prepareShell();
  fakeExtension((method) => (method === "webview.initialize" ? initialized() : scans.shift()));
  scans.push({ error: "scan broke $& {0}" });
  await import("@/webview/main");
});

afterAll(() => vi.unstubAllGlobals());

it("shows a failed scan with Retry, and still reports ready", async () => {
  await vi.waitFor(() => expect(app().querySelector("[role=alert]")).not.toBeNull());
  const alert = app().querySelector("[role=alert]")!;
  expect(alert.querySelector("p")?.textContent).toBe(
    "Unable to load repositories: scan broke $& {0}"
  );
  expect(alert.querySelector("button")?.textContent).toBe("Retry");
  await vi.waitFor(() => expect(posted()).toContain("viewReady"));
});

it("scans again on Retry, waiting in the spinner, and finds no repository", async () => {
  const later = deferred();
  scans.push(later.answer);
  act(() => app().querySelector<HTMLButtonElement>("[role=alert] button")!.click());
  await vi.waitFor(() => expect(app().querySelector("[role=alert]")).toBeNull());
  expect(app().querySelector("[role=status]")).not.toBeNull();
  expect(posted().filter((message) => message === "rpc:repo.scan")).toHaveLength(2);

  later.release(scanned());
  await vi.waitFor(() => expect(app().textContent).toContain("noRepo"));
  expect(selectedRepo.value).toBeUndefined();
  expect(posted().filter((message) => message === "viewReady")).toHaveLength(1);
});
