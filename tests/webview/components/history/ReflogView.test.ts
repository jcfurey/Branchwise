// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReflogEntry } from "@/backend/types";
import { ReflogView } from "@/webview/components/history/ReflogView";
import { activeTab, historyFilter, showTab } from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import {
  lastQuery,
  reply,
  resetGraphView,
  sentQueries
} from "@tests/webview/components/commit/graph-view-harness";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let host: HTMLDivElement;

function entry(hash: string, patch: Partial<ReflogEntry> = {}): ReflogEntry {
  return {
    hash: hash.repeat(40).slice(0, 40),
    selector: `HEAD@{${hash}}`,
    message: "checkout: moving from main to topic",
    subject: `subject ${hash}`,
    date: 1_650_000_000,
    ref: "HEAD",
    action: "checkout",
    detail: "",
    lost: false,
    ...patch
  };
}

function answer(entries: ReflogEntry[], more = false) {
  reply(lastQuery("reflog"), {
    data: {
      kind: "reflog",
      entries,
      more,
      refs: ["HEAD", "refs/heads/main", "refs/heads/topic"],
      actions: ["checkout", "commit", "reset"]
    }
  });
}

const rows = () => [...host.querySelectorAll<HTMLTableRowElement>("tbody tr")];
const selectNamed = (name: string) =>
  host.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)!;

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphView();
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(h(ReflogView, {}), host));
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
  showTab("graph");
});

describe("the reflog view", () => {
  it("asks for every ref's reflog, then lists each entry's time, ref, operation and commit", () => {
    expect(lastQuery("reflog").query).toStrictEqual({ kind: "reflog", offset: 0 });
    answer([
      entry("a", { action: "commit", detail: "amend", message: "commit (amend): fix it" }),
      entry("b", { ref: "refs/heads/topic", lost: true })
    ]);
    const cells = rows().map((row) =>
      [...row.querySelectorAll("td")].slice(1, 5).map((cell) => cell.textContent)
    );
    expect(cells).toStrictEqual([
      ["HEAD", "commit · amend", "fix it", "aaaaaaaasubject a"],
      ["topic", "checkout", "moving from main to topic", "bbbbbbbbsubject breflogLost"]
    ]);
    expect(selectNamed("reflogRef").options.length).toBe(4);
    expect([...selectNamed("reflogOperation").options].map((option) => option.value)).toEqual([
      "",
      "checkout",
      "commit",
      "reset"
    ]);
  });

  it("sends the chosen ref, operation, text and lost-only filter, from the first page", () => {
    answer([entry("a")], true);
    act(() => host.querySelector<HTMLButtonElement>("button:last-of-type")!.click());
    const select = (name: string, value: string) =>
      act(() => {
        const element = selectNamed(name);
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
    select("reflogRef", "refs/heads/topic");
    select("reflogOperation", "reset");
    act(() => {
      const input = host.querySelector<HTMLInputElement>("[data-reflog-filter]")!;
      input.value = "  fix ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    act(() => host.querySelector<HTMLInputElement>("label input[type=checkbox]")!.click());
    expect(lastQuery("reflog").query).toStrictEqual({
      kind: "reflog",
      offset: 0,
      ref: "refs/heads/topic",
      action: "reset",
      text: "fix",
      lostOnly: true
    });
  });

  it("shows a commit in the graph tab", () => {
    showTab("reflog");
    answer([entry("c")]);
    const show = [...rows()[0]!.querySelectorAll("button")].find(
      (button) => button.textContent === "showInGraph"
    )!;
    act(() => show.click());
    expect(activeTab.value).toBe("graph");
    expect(historyFilter.value.revision).toBe("c".repeat(40));
  });

  it("offers recovery, checkout and reset for an entry, and recovers it to a named branch", () => {
    answer([entry("d", { lost: true })]);
    act(() => rows()[0]!.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]")!.click());
    const menu = stores.contextMenu.value!;
    expect(menu.entries.map((item) => item?.title ?? null)).toEqual([
      "recoverBranch…",
      null,
      "checkout…",
      "reset…"
    ]);
    act(() => menu.entries[0]!.onClick());
    const form = stores.dialog.value!;
    expect(form.kind).toBe("form");
    vscodeApi.postMessage.mockClear();
    act(() => (form as { onSubmit: (values: unknown[]) => void }).onSubmit(["keep/it"]));
    expect(vscodeApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "repositoryAction",
        action: { kind: "recoverBranch", name: "keep/it", hash: "d".repeat(40) }
      })
    );
  });

  it("says when nothing matches", () => {
    answer([]);
    expect(host.textContent).toContain("noReflog");
    expect(host.querySelector("table")).toBeNull();
    expect(sentQueries("reflog")).toHaveLength(1);
  });
});
