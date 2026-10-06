// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RebaseEntry, RebasePlan } from "@/backend/types";
import { RebaseEditor } from "@/webview/components/repository/RebaseEditor";
import { selectedRepo } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const id = (digit: string) => digit.repeat(40);
const [A, B, C, D, E] = ["a", "b", "c", "d", "e"].map(id) as [
  string,
  string,
  string,
  string,
  string
];
const PLAN: RebasePlan = {
  base: id("0"),
  head: E,
  branch: "main",
  entries: [
    { hash: A, message: "Subject A\n\nBody of A", action: "pick" },
    { hash: B, message: "Subject B", action: "pick" },
    { hash: C, message: "Subject C\n\n# heading kept", action: "pick" },
    { hash: D, message: "Subject D", action: "pick" },
    { hash: E, message: "Subject E", action: "pick" }
  ]
};

let container: HTMLDivElement;

function choose(hash: string, action: RebaseEntry["action"]) {
  const select = container.querySelector<HTMLSelectElement>(`[data-entry="${hash}"] select`)!;
  act(() => {
    select.value = action;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function boxes() {
  return [...container.querySelectorAll<HTMLElement>("[data-combined]")];
}
function message(hash: string) {
  return container.querySelector<HTMLTextAreaElement>(`[data-combined="${hash}"] textarea`)!;
}
function type(area: HTMLTextAreaElement, value: string) {
  act(() => {
    area.value = value;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function start() {
  const submit = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "startRebase"
  )!;
  act(() => submit.click());
  return submit;
}
function sentEntries(): RebaseEntry[] {
  return vscodeApi.postMessage.mock.lastCall![0].action.plan.entries;
}
/** The order of commit rows and message boxes as the editor shows them. */
function layout() {
  return [...container.querySelectorAll<HTMLElement>("[data-entry], [data-combined]")].map(
    (element) =>
      element.dataset["entry"]
        ? element.dataset["entry"][0]
        : `message ${element.dataset["combined"]![0]}`
  );
}

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  selectedRepo.value = "/repo";
  container = document.createElement("div");
  document.body.append(container);
  act(() => render(h(RebaseEditor, { plan: PLAN, repo: "/repo" }), container));
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe("the combined message of a squash", () => {
  it("appears only for a commit that Squash entries follow, after the group's last commit", () => {
    expect(boxes()).toEqual([]);
    // Fixup alone keeps the first message, so there is nothing to edit.
    choose(B, "fixup");
    expect(boxes()).toEqual([]);
    choose(C, "squash");
    expect(layout()).toEqual(["a", "b", "c", "message a", "d", "e"]);
    // A dropped commit leaves the todo list, so E squashes into C's group across it.
    choose(D, "drop");
    choose(E, "squash");
    expect(layout()).toEqual(["a", "b", "c", "d", "e", "message a"]);
    choose(C, "pick");
    expect(layout()).toEqual(["a", "b", "c", "d", "e", "message c"]);
  });

  it("is filled with the messages Git keeps, a blank line apart, leaving out Fixup messages", () => {
    choose(B, "squash");
    choose(C, "squash");
    expect(message(A).value).toBe(
      "Subject A\n\nBody of A\n\nSubject B\n\nSubject C\n\n# heading kept"
    );
    choose(B, "fixup");
    expect(message(A).value).toBe("Subject A\n\nBody of A\n\nSubject C\n\n# heading kept");
    // A reworded first commit contributes its new message.
    choose(A, "reword");
    type(container.querySelector<HTMLTextAreaElement>(`[data-entry="${A}"] textarea`)!, "New A");
    expect(message(A).value).toBe("New A\n\nSubject C\n\n# heading kept");
  });

  it("gives each group its own message", () => {
    choose(B, "squash");
    choose(D, "squash");
    expect(layout()).toEqual(["a", "b", "message a", "c", "d", "message c", "e"]);
    expect(message(A).value).toBe("Subject A\n\nBody of A\n\nSubject B");
    expect(message(C).value).toBe("Subject C\n\n# heading kept\n\nSubject D");
  });

  it("sends nothing extra when the offered message is left as it is", () => {
    choose(B, "squash");
    start();
    expect(sentEntries().map((entry) => entry.squashMessage)).toEqual(Array(5).fill(undefined));
    // Typing the offered text back is the same as leaving it.
    type(message(A), "edited");
    type(message(A), "Subject A\n\nBody of A\n\nSubject B");
    start();
    expect(sentEntries().some((entry) => "squashMessage" in entry)).toBe(false);
  });

  it("sends an edited message on the group's first commit only", () => {
    choose(B, "squash");
    choose(D, "squash");
    type(message(C), "# Überschrift ✓\n\n'quoted' $(text)");
    start();
    const entries = sentEntries();
    expect(entries.map((entry) => [entry.hash, entry.action, entry.squashMessage])).toEqual([
      [A, "pick", undefined],
      [B, "squash", undefined],
      [C, "pick", "# Überschrift ✓\n\n'quoted' $(text)"],
      [D, "squash", undefined],
      [E, "pick", undefined]
    ]);
  });

  it("keeps an edited message while the group stays, and needs it to be nonempty", () => {
    choose(B, "squash");
    type(message(A), "Edited");
    choose(E, "drop");
    expect(message(A).value).toBe("Edited");
    type(message(A), "  \n ");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("combinedMessageRequired");
    const submit = start();
    expect(submit.disabled).toBe(true);
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });
});
