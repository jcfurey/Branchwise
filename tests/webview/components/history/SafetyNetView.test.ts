// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SafetyNetEntry } from "@/backend/types";
import { openSafetyNet, SafetyNetView } from "@/webview/components/history/SafetyNetView";
import * as stores from "@/webview/lib/stores";

import {
  lastQuery,
  reply,
  resetGraphView
} from "@tests/webview/components/commit/graph-view-harness";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let host: HTMLDivElement;

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

function entry(id: string, patch: Partial<SafetyNetEntry> = {}): SafetyNetEntry {
  return {
    id,
    kind: "hardReset",
    subject: "main",
    detail: "",
    date: 1_650_000_000,
    head: "refs/heads/main",
    mode: "keep",
    changes: [{ ref: "refs/heads/main", old: OLD, new: NEW }],
    saved: null,
    stash: null,
    config: [],
    undoable: true,
    state: "done",
    operation: null,
    title: `title ${id}`,
    restorable: true,
    lost: [],
    moreLost: false,
    ...patch
  };
}

const sections = () => [...host.querySelectorAll<HTMLElement>("[data-safety-entry]")];
const buttons = (root: Element) => [...root.querySelectorAll("button")];

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphView();
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(h(SafetyNetView, {}), host));
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

describe("the Safety Net list", () => {
  it("asks for the records and lists each one's title, changes and lost commits", () => {
    expect(lastQuery("safetyNet").query).toStrictEqual({ kind: "safetyNet" });
    reply(lastQuery("safetyNet"), {
      data: {
        kind: "safetyNet",
        entries: [
          entry("2-0", {
            kind: "deleteBranch",
            title: "Deletion of Branch topic",
            changes: [{ ref: "refs/heads/topic", old: OLD, new: null }],
            lost: [{ hash: OLD, subject: "topic work", date: 1_650_000_000 }],
            moreLost: true
          }),
          entry("1-0", { saved: "c".repeat(40) })
        ]
      }
    });
    const [deletion, reset] = sections();
    expect(deletion!.querySelector("b")!.textContent).toBe("Deletion of Branch topic");
    expect(deletion!.querySelector("[data-safety-change]")!.textContent).toBe(
      "topic aaaaaaaa → safetyNetNone"
    );
    expect(deletion!.querySelector("[data-lost-commit]")!.textContent).toBe(
      "aaaaaaaatopic workrecoverBranch…"
    );
    expect(deletion!.textContent).toContain("safetyNetMoreLost");
    expect(reset!.querySelector("[data-safety-change]")!.textContent).toBe(
      "main aaaaaaaa → bbbbbbbb"
    );
    // The test strings are their own keys, without a {0} for the commit.
    expect(reset!.textContent).toContain("safetyNetSaved");
  });

  it("restores a record through the extension, the same way Undo does", () => {
    reply(lastQuery("safetyNet"), { data: { kind: "safetyNet", entries: [entry("1-0")] } });
    const restore = buttons(sections()[0]!).find(
      (button) => button.textContent === "safetyNetRestore"
    );
    act(() => restore!.click());
    expect(vscodeApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "repositoryAction",
        repo: "/work/repo",
        action: { kind: "undoSafetyNet", id: "1-0" }
      })
    );
  });

  it("offers no Restore for undone, unfinished or record-only actions, and says why", () => {
    reply(lastQuery("safetyNet"), {
      data: {
        kind: "safetyNet",
        entries: [
          entry("4-0", { state: "undone", restorable: false }),
          entry("3-0", { state: "unfinished", restorable: false }),
          entry("2-0", { state: "pending", restorable: false }),
          entry("1-0", { kind: "forcePush", undoable: false, restorable: false })
        ]
      }
    });
    expect(
      sections().map((section) => [
        section.querySelector("span.rounded")?.textContent,
        buttons(section).some((button) => button.textContent === "safetyNetRestore")
      ])
    ).toEqual([
      ["safetyNetUndone", false],
      ["safetyNetUnfinished", false],
      ["safetyNetPending", false],
      ["safetyNetRecordedOnly", false]
    ]);
  });

  it("recovers a lost commit onto a new branch", () => {
    reply(lastQuery("safetyNet"), {
      data: {
        kind: "safetyNet",
        entries: [entry("1-0", { lost: [{ hash: OLD, subject: "lost", date: 0 }] })]
      }
    });
    act(() => buttons(host.querySelector("[data-lost-commit]")!)[0]!.click());
    expect(stores.dialog.value).toMatchObject({ kind: "form", action: "recoverBranch" });
  });

  it("says when nothing was recorded, and shows a failed read", () => {
    reply(lastQuery("safetyNet"), { data: { kind: "safetyNet", entries: [] } });
    expect(host.textContent).toContain("safetyNetEmpty");
    act(() => {
      stores.selectedRepo.value = "/work/other";
    });
    reply(lastQuery("safetyNet"), { error: "unreadable" });
    expect(host.querySelector("[role=alert]")?.textContent).toBe("unreadable");
  });

  it("opens in a wide dialog", () => {
    act(() => openSafetyNet());
    expect(stores.dialog.value).toMatchObject({
      kind: "content",
      message: "safetyNet",
      wide: true
    });
  });
});
