// @vitest-environment jsdom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "@/webview/components/ui/Dialog";
import {
  closeDialog,
  openContentDialog,
  openErrorDialog,
  openFormDialog,
  openRunningDialog
} from "@/webview/lib/actions";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";
import { dialog, selectedRepo } from "@/webview/lib/stores";
import type { DialogInput, DialogState } from "@/webview/types";

import { setupWebviewTest } from "@tests/webview/test-utils";

let container: HTMLDivElement;

/** A plain confirmation, for tests that need any form. */
const form = {
  message: "Q",
  inputs: [],
  action: "Go",
  source: null,
  onSubmit: () => {}
};

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  selectedRepo.value = "/repo";
  container = document.createElement("div");
  document.body.append(container);
  act(() => render(h(Dialog, null), container));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => render(null, container));
  container.remove();
  // Clears the return target that opening a dialog captured, so each test starts afresh.
  closeDialog();
  await Promise.resolve();
  useStrings({});
});

/** Replace the test strings, which read as their own keys, with a few real templates. */
function useStrings(strings: Record<string, string>) {
  Object.defineProperty(window, "l10n", {
    value: new Proxy({}, { get: (_target, key) => strings[String(key)] ?? String(key) }),
    configurable: true
  });
}

/**
 * Fake the clock and intervals only, so the timer count is the dialog's own ticker. Rendering
 * schedules timeouts of its own, which would be counted too.
 */
function fakeIntervals(now = Date.now()) {
  vi.useFakeTimers({ now, toFake: ["setInterval", "clearInterval", "Date"] });
}

function panel() {
  return container.querySelector<HTMLElement>('[role="dialog"]');
}

function title() {
  return document.getElementById(panel()?.getAttribute("aria-labelledby") ?? "");
}

function labels() {
  return [...(panel()?.querySelectorAll("button") ?? [])].map((element) => element.textContent);
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label
  );
  if (found === undefined) {
    throw new Error(`Missing button ${label}`);
  }
  return found;
}

function submitButton() {
  return container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A listener that takes every key for itself. */
function claim(event: KeyboardEvent) {
  event.preventDefault();
}

/** How many `keydown` listeners a spied `addEventListener` or `removeEventListener` saw. */
function keydownCalls(spy: { mock: { calls: Array<Array<unknown>> } }) {
  return spy.mock.calls.filter(([name]) => name === "keydown").length;
}

function textFields() {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="text"]')];
}

function openForm({
  message = "Q",
  inputs = [],
  action = "Go",
  destructive = false,
  onSubmit = () => {}
}: {
  message?: string;
  inputs?: Array<DialogInput>;
  action?: string;
  destructive?: boolean;
  onSubmit?: (values: Array<string | boolean>) => void;
} = {}) {
  act(() => openFormDialog({ message, inputs, action, source: null, destructive, onSubmit }));
}

describe("rendering", () => {
  it("draws nothing while the store is empty", () => {
    expect(container.innerHTML).toBe("");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each([
    ["an error", () => openErrorDialog("E"), "P", "E"],
    ["a form", () => openFormDialog({ ...form, message: "E" }), "P", "E"],
    ["a content dialog", () => openContentDialog("E", "body"), "H2", "E"]
  ])("names the panel of %s by its message", (_kind, open, tag, text) => {
    act(open);
    const element = panel()!;
    expect(element.getAttribute("aria-modal")).toBe("true");
    expect(element.getAttribute("tabindex")).toBe("-1");
    expect(element.getAttribute("aria-labelledby")?.split(" ")).toHaveLength(1);
    expect(title()?.tagName).toBe(tag);
    expect(title()?.textContent).toBe(text);
    expect(element.contains(title())).toBe(true);
  });

  it("puts the overlay first and the panel after it, outside the overlay", () => {
    act(() => openErrorDialog("E"));
    const overlay = container.querySelector(".fixed.inset-0")!;
    expect(overlay.nextElementSibling).toBe(panel());
    expect(overlay.contains(panel())).toBe(false);
    expect(panel()!.classList.contains("inset-0")).toBe(false);
  });
});

describe("closing", () => {
  it.each([
    ["an error", () => openErrorDialog("E", "r")],
    ["a form", () => openFormDialog(form)],
    ["a running dialog", () => openRunningDialog("R", { detail: "", started: Date.now() })],
    ["a content dialog", () => openContentDialog("C", "body")]
  ])("closes %s on Escape from outside the panel", (_kind, open) => {
    act(open);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    const event = press(outside, "Escape");
    expect(dialog.value).toBeNull();
    expect(event.defaultPrevented).toBe(false);
    outside.remove();
  });

  it("leaves an Escape that a control inside the dialog already used", () => {
    const content = h("input", {
      type: "text",
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
        }
      }
    });
    act(() => openContentDialog("C", content));
    const input = panel()!.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(press(input, "Escape").defaultPrevented).toBe(true);
    expect(dialog.value).toMatchObject({ kind: "content" });
    press(button("close"), "Escape");
    expect(dialog.value).toBeNull();
  });

  it("leaves an Escape that was prevented before it reached the document", () => {
    act(() => openErrorDialog("E"));
    document.addEventListener("keydown", claim, true);
    press(panel()!, "Escape");
    document.removeEventListener("keydown", claim, true);
    expect(dialog.value).toMatchObject({ kind: "error" });
  });

  it("adds one Escape listener per dialog and removes each of them", () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    act(() => openErrorDialog("A"));
    act(() => openErrorDialog("B"));
    act(() => closeDialog());
    act(() => render(null, container));
    expect(keydownCalls(added)).toBe(2);
    expect(keydownCalls(removed)).toBe(2);
    expect(() => press(document.body, "Escape")).not.toThrow();
    expect(dialog.value).toBeNull();
  });

  it("closes on an overlay click with a click count below two, never on a panel click", () => {
    act(() => openErrorDialog("E"));
    const overlay = container.querySelector(".fixed.inset-0")!;
    act(() => {
      panel()!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(dialog.value).not.toBeNull();
    act(() => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 3 }));
    });
    expect(dialog.value).not.toBeNull();
    act(() => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(dialog.value).toBeNull();
  });

  it("does not move focus when the store is cleared without closeDialog", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    act(() => openErrorDialog("E"));
    expect(document.activeElement?.textContent).toBe("dialogDismiss");
    act(() => {
      dialog.value = null;
    });
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
    closeDialog();
    await Promise.resolve();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("leaves nothing running when it is unmounted while open", () => {
    fakeIntervals();
    const baseline = vi.getTimerCount();
    act(() => openRunningDialog("R", { detail: "", started: Date.now() }));
    expect(vi.getTimerCount()).toBe(baseline + 1);
    expect(() => act(() => render(null, container))).not.toThrow();
    expect(vi.getTimerCount()).toBe(baseline);
    act(() => void vi.advanceTimersByTime(5000));
    const running = dialog.value;
    press(document.body, "Escape");
    expect(dialog.value).toBe(running);
  });
});

describe("keyboard", () => {
  it("wraps Tab from Cancel to the submit button", () => {
    openForm({ destructive: true });
    const cancel = document.activeElement!;
    expect(cancel.hasAttribute("data-dialog-cancel")).toBe(true);
    expect(press(cancel, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(submitButton());
  });

  it("wraps Shift+Tab from the first control and from the panel to Cancel", () => {
    openForm({ destructive: true });
    const cancel = document.activeElement;
    act(() => submitButton().focus());
    expect(press(submitButton(), "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    act(() => panel()!.focus());
    expect(press(panel()!, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
  });

  it("skips a disabled submit button when Tab wraps", () => {
    openForm({ inputs: [{ kind: "ref", value: "" }], action: "Create" });
    expect(submitButton().disabled).toBe(true);
    const cancel = button("dialogCancel");
    act(() => cancel.focus());
    expect(press(cancel, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(textFields()[0]);
  });

  it("leaves Tab between controls, and outside the panel, to the browser", () => {
    openForm({ inputs: [{ kind: "ref", value: "main" }] });
    act(() => submitButton().focus());
    expect(press(submitButton(), "Tab").defaultPrevented).toBe(false);
    expect(press(submitButton(), "Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(press(outside, "Tab").defaultPrevented).toBe(false);
    outside.remove();
  });

  it.each([
    ["a link", h("a", { href: "#start" }, "link")],
    ["an element with tabindex 0", h("span", { tabIndex: 0 }, "item")]
  ])("wraps focus around %s at the start of the content", (_kind, first) => {
    act(() => openContentDialog("C", first));
    const start = panel()!.querySelector<HTMLElement>('a[href], [tabindex="0"]')!;
    const close = button("close");
    expect(document.activeElement).toBe(close);
    expect(press(close, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(start);
    expect(press(start, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it.each([
    ["a disabled select", h("select", { disabled: true })],
    ["a disabled text area", h("textarea", { disabled: true })],
    ["an element with tabindex -1", h("div", { tabIndex: -1 }, "skip")]
  ])("does not count %s as the first control", (_kind, skipped) => {
    act(() => openContentDialog("C", h("div", null, skipped, h("button", null, "inner"))));
    const close = button("close");
    act(() => close.focus());
    expect(press(close, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("inner"));
  });

  it("holds back repeated Enter and Space in any dialog, but not a repeated Escape", () => {
    openForm({ inputs: [{ kind: "text", value: "x" }] });
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    const space = press(submitButton(), " ", { repeat: true });
    const enter = press(textFields()[0]!, "Enter", { repeat: true });
    expect(space.defaultPrevented).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    const escape = press(textFields()[0]!, "Escape", { repeat: true });
    document.removeEventListener("keydown", seen);
    expect(escape.defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(dialog.value).toBeNull();
  });

  it("lets a fresh Enter through", () => {
    openForm();
    expect(press(submitButton(), "Enter").defaultPrevented).toBe(false);
  });
});

describe("initial focus", () => {
  it.each<[string, () => void, () => Element | undefined]>([
    [
      "a text area form on its submit button",
      () => openForm({ inputs: [{ kind: "textarea", value: "" }], action: "Save" }),
      () => button("Save")
    ],
    [
      "a form with a select before a ref field on the ref field",
      () =>
        openForm({
          inputs: [
            { kind: "select", value: "a", options: [{ label: "A", value: "a" }] },
            { kind: "ref", value: "main" }
          ]
        }),
      () => textFields()[0]
    ],
    [
      "a destructive form on Cancel",
      () => openForm({ inputs: [{ kind: "text", value: "" }], destructive: true }),
      () => button("dialogCancel")
    ],
    [
      "a running dialog that can be stopped on Hide",
      () =>
        act(() => openRunningDialog("R", { detail: "", started: Date.now(), onCancel: () => {} })),
      () => button("hideOperation")
    ],
    [
      "a running dialog that cannot be stopped on Hide",
      () => act(() => openRunningDialog("R")),
      () => button("hideOperation")
    ],
    [
      "an error with a reason on Dismiss",
      () => act(() => openErrorDialog("E", "r")),
      () => button("dialogDismiss")
    ],
    [
      "an error without a reason on Dismiss",
      () => act(() => openErrorDialog("E")),
      () => button("dialogDismiss")
    ],
    [
      "a content dialog on its first button",
      () => act(() => openContentDialog("C", h("p", null, "body", h("button", null, "inner")))),
      () => button("inner")
    ],
    [
      "a content dialog without controls on Close",
      () => act(() => openContentDialog("C", h("p", null, "no controls"))),
      () => button("close")
    ],
    [
      "a content dialog past a disabled button to the next one",
      () =>
        act(() =>
          openContentDialog(
            "C",
            h("div", null, h("button", { disabled: true }, "off"), h("button", null, "on"))
          )
        ),
      () => button("on")
    ],
    [
      "a content dialog whose only button is disabled on Close",
      () => act(() => openContentDialog("C", h("button", { disabled: true }, "off"))),
      () => button("close")
    ]
  ])("starts %s", (_case, open, expected) => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    open();
    expect(document.activeElement).toBe(expected());
    outside.remove();
  });

  it("keeps Stop Git and Copy Error Details in their places", () => {
    act(() => openRunningDialog("R", { detail: "", started: Date.now(), onCancel: () => {} }));
    expect(labels()).toEqual(["cancelOperation", "hideOperation"]);
    act(() => openErrorDialog("E", "r"));
    expect(labels()).toEqual(["copyError", "dialogDismiss"]);
  });

  it("starts a new dialog afresh and keeps the same one as it is", () => {
    openForm({ inputs: [{ kind: "text", value: "a0" }] });
    type(textFields()[0]!, "typed");
    openForm({ inputs: [{ kind: "text", value: "b0" }] });
    expect(textFields()[0]!.value).toBe("b0");
    expect(document.activeElement).toBe(textFields()[0]);

    openForm({
      inputs: [
        { kind: "text", value: "one" },
        { kind: "text", value: "two" }
      ]
    });
    const [first, second] = textFields();
    type(first!, "edited");
    act(() => second!.focus());
    act(() => render(h(Dialog, null), container));
    act(() => {
      dialog.value = { ...dialog.value } as DialogState;
    });
    expect(textFields()[0]).toBe(first);
    expect(first!.value).toBe("edited");
    expect(document.activeElement).toBe(second);
  });
});

describe("forms", () => {
  it("shows every kind of field with its initial value", () => {
    openForm({
      inputs: [
        { kind: "text", value: "a0" },
        {
          kind: "select",
          value: "2",
          options: [
            { label: "One", value: "1" },
            { label: "Two", value: "2" }
          ]
        },
        { kind: "textarea", value: "x" },
        { kind: "checkbox", label: "Box", value: true }
      ]
    });
    expect(textFields()[0]!.value).toBe("a0");
    expect(container.querySelector("select")!.value).toBe("2");
    expect(container.querySelector("textarea")!.value).toBe("x");
    expect(container.querySelector("textarea")!.rows).toBe(4);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  });

  it("lays out a labelled form in label and field pairs", () => {
    openForm({
      inputs: [
        { kind: "ref", label: "Name", value: "" },
        { kind: "select", label: "Type", value: "a", options: [{ label: "A", value: "a" }] },
        { kind: "text", label: "Message", value: "", placeholder: "Optional" },
        { kind: "textarea", value: "" },
        { kind: "checkbox", label: "Push", value: false }
      ]
    });
    const dialogPanel = panel()!;
    const fieldLabels = [...dialogPanel.querySelectorAll("label[for]")];
    expect(fieldLabels.map((label) => label.textContent)).toEqual(["Name", "Type", "Message"]);
    const [ref, text] = textFields();
    const select = dialogPanel.querySelector("select")!;
    expect(fieldLabels.map((label) => label.getAttribute("for"))).toEqual([
      ref!.id,
      select.id,
      text!.id
    ]);
    expect(ref!.hasAttribute("placeholder")).toBe(false);
    expect(text!.placeholder).toBe("Optional");
    expect(ref!.hasAttribute("aria-labelledby")).toBe(false);
    const textarea = dialogPanel.querySelector("textarea")!;
    expect(textarea.getAttribute("aria-labelledby")).toBe(title()!.id);
    const checkbox = dialogPanel.querySelector('input[type="checkbox"]')!;
    expect(checkbox.closest("label")?.textContent).toBe("Push");
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the fields of an unlabelled form by its message and keeps checkboxes in line", () => {
    openForm({
      inputs: [
        { kind: "select", value: "a", options: [{ label: "A", value: "a" }] },
        { kind: "checkbox", label: "Box", value: false }
      ]
    });
    expect(panel()!.querySelector("label[for]")).toBeNull();
    const select = panel()!.querySelector("select")!;
    expect(select.getAttribute("aria-labelledby")).toBe(title()!.id);
    // The checkbox sits in the fields area beside the other controls, with no wrapper to centre it.
    const checkbox = panel()!.querySelector('input[type="checkbox"]')!.closest("label")!;
    expect(checkbox.parentElement).toBe(select.parentElement);
  });

  it("refuses an empty ref name without a tooltip", () => {
    openForm({ inputs: [{ kind: "ref", value: "" }], action: "Create" });
    expect(submitButton().disabled).toBe(true);
    let element: HTMLElement | null = submitButton();
    while (element !== null && element !== panel()) {
      expect(element.hasAttribute("title")).toBe(false);
      element = element.parentElement;
    }
  });

  it("refuses an invalid ref name with a tooltip over the submit button", () => {
    useStrings({ invalidCharacters: "Cannot {0} with that name" });
    openForm({ inputs: [{ kind: "ref", value: "" }], action: "Create" });
    type(textFields()[0]!, "a..b");
    expect(submitButton().disabled).toBe(true);
    const titled = panel()!.querySelector("[title]")!;
    expect(titled.getAttribute("title")).toBe("Cannot Create with that name");
    expect(titled.contains(submitButton())).toBe(true);
    type(textFields()[0]!, "ok");
    expect(submitButton().disabled).toBe(false);
    expect(panel()!.querySelector("[title]")).toBeNull();
  });

  it("lets the first ref field with a problem decide the tooltip", () => {
    openForm({
      inputs: [
        { kind: "ref", value: "" },
        { kind: "ref", value: "a..b" }
      ]
    });
    expect(submitButton().disabled).toBe(true);
    expect(panel()!.querySelector("[title]")).toBeNull();
    type(textFields()[0]!, "a~");
    expect(panel()!.querySelector("[title]")).not.toBeNull();
  });

  it("does nothing on a refused submit but cancel it", () => {
    const onSubmit = vi.fn();
    openForm({ inputs: [{ kind: "ref", value: "a..b" }], onSubmit });
    const before = dialog.value;
    const event = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      container.querySelector("form")!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog.value).toBe(before);
  });

  it("closes first, then hands over one value per input in order", () => {
    let open: DialogState | null | undefined;
    const onSubmit = vi.fn(() => {
      open = dialog.value;
    });
    openForm({
      inputs: [
        { kind: "ref", value: "x" },
        {
          kind: "select",
          value: "b",
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" }
          ]
        },
        { kind: "text", value: "" },
        { kind: "textarea", value: "t" },
        { kind: "checkbox", label: "Box", value: false }
      ],
      onSubmit
    });
    type(textFields()[0]!, "feature/y");
    act(() => {
      const select = container.querySelector("select")!;
      select.value = "a";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const event = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      container.querySelector("form")!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(["feature/y", "a", "", "t", true]);
    expect(open).toBeNull();
    expect(panel()).toBeNull();
  });

  it("sends the last edit even when the submit follows it at once, and sends only once", () => {
    const onSubmit = vi.fn();
    openForm({ inputs: [{ kind: "ref", value: "" }], onSubmit });
    act(() => {
      const field = textFields()[0]!;
      field.value = "late";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("form")!.requestSubmit();
      container.querySelector("form")!.requestSubmit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(["late"]);
  });

  it("keeps a dialog that the submit callback opens", () => {
    openForm({ onSubmit: () => openErrorDialog("Second") });
    act(() => submitButton().click());
    expect(dialog.value).toMatchObject({ kind: "error", message: "Second" });
    expect(panel()?.textContent).toContain("Second");
  });

  it("closes on Cancel without submitting", () => {
    const onSubmit = vi.fn();
    openForm({ inputs: [{ kind: "text", value: "x" }], onSubmit });
    const cancel = container.querySelector<HTMLButtonElement>("[data-dialog-cancel]")!;
    expect(cancel.textContent).toBe("dialogCancel");
    expect(cancel.type).toBe("button");
    expect(container.querySelectorAll("[data-dialog-cancel]")).toHaveLength(1);
    act(() => cancel.click());
    expect(dialog.value).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("running dialogs", () => {
  it("shows the operation, its detail and a ticking timer, and stops ticking on close", () => {
    fakeIntervals(100_000);
    useStrings({
      elapsedSeconds: "{0} elapsed",
      operationKeepsRunning: "Git continues running when this dialog is hidden.",
      hideOperation: "Hide"
    });
    const baseline = vi.getTimerCount();
    act(() => openRunningDialog("Pushing", { detail: "/repo\ngit push", started: 97_400 }));
    expect(panel()!.textContent).toBe(
      "Pushing .../repo\ngit push2s elapsedGit continues running when this dialog is hidden.Hide"
    );
    expect(title()!.textContent).toBe("Pushing ...");
    act(() => void vi.advanceTimersByTime(1000));
    expect(panel()!.textContent).toContain("3s elapsed");
    act(() => void vi.advanceTimersByTime(60_000));
    expect(panel()!.textContent).toContain("63s elapsed");
    act(() => closeDialog());
    act(() => void vi.runOnlyPendingTimers());
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it("shows no detail, no timer and no interval without them", () => {
    fakeIntervals();
    const baseline = vi.getTimerCount();
    act(() => openRunningDialog("Loading"));
    expect(panel()!.textContent).toBe("Loading ...hideOperation");
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it("shows zero seconds for a start in the future and no empty detail", () => {
    useStrings({ elapsedSeconds: "{0} elapsed" });
    act(() => openRunningDialog("Future", { detail: "", started: Date.now() + 100_000 }));
    expect(panel()!.textContent).toBe("Future ...0s elapsedoperationKeepsRunninghideOperation");
  });

  it("asks to stop without closing, and hides on Hide", () => {
    const onCancel = vi.fn();
    act(() => openRunningDialog("R", { detail: "", started: Date.now(), onCancel }));
    const running = dialog.value;
    act(() => button("cancelOperation").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(dialog.value).toBe(running);
    act(() => button("hideOperation").click());
    expect(dialog.value).toBeNull();
  });

  it("keeps the spinner still for people who prefer reduced motion", () => {
    act(() => openRunningDialog("R"));
    const spinner = panel()!.querySelector("svg")!;
    expect(spinner.getAttribute("aria-hidden")).toBe("true");
    expect(spinner.getAttribute("focusable")).toBe("false");
    expect(spinner.classList.contains("animate-spin")).toBe(true);
    expect(spinner.classList.contains("motion-reduce:animate-none")).toBe(true);
  });
});

describe("error dialogs", () => {
  it("shows a reason with a copy button", () => {
    act(() => openErrorDialog("E", "a\nb"));
    expect(panel()!.textContent?.startsWith("E")).toBe(true);
    expect([...panel()!.querySelectorAll("p")].some((p) => p.textContent === "a\nb")).toBe(true);
    expect(labels()).toEqual(["copyError", "dialogDismiss"]);
  });

  it("treats an empty reason as no reason", () => {
    act(() => openErrorDialog("E"));
    const without = panel()!.childElementCount;
    expect(panel()!.textContent).toBe("EdialogDismiss");
    expect(labels()).toEqual(["dialogDismiss"]);
    act(() => openErrorDialog("E", ""));
    expect(panel()!.childElementCount).toBe(without);
    expect(panel()!.textContent).toBe("EdialogDismiss");
    expect(labels()).toEqual(["dialogDismiss"]);
    act(() => openErrorDialog("E", "r"));
    expect(panel()!.childElementCount).toBe(without + 1);
  });

  it("copies the reason and stays open", async () => {
    const request = vi.spyOn(rpcClient, "request").mockResolvedValue(true as never);
    act(() => openErrorDialog("E", "r"));
    const error = dialog.value;
    await act(async () => button("copyError").click());
    expect(request).toHaveBeenCalledWith("clipboard.copy", "r");
    expect(dialog.value).toBe(error);
  });

  it("reports a copy that failed", async () => {
    vi.spyOn(rpcClient, "request").mockResolvedValue(false as never);
    act(() => openErrorDialog("E", "r"));
    await act(async () => button("copyError").click());
    expect(dialog.value).toMatchObject({ kind: "error", message: "unableToCopyToClipboard" });
  });

  it("dismisses", () => {
    act(() => openErrorDialog("E", "r"));
    act(() => button("dialogDismiss").click());
    expect(dialog.value).toBeNull();
  });
});

describe("content dialogs", () => {
  it("shows a heading, the caller's content and Close", () => {
    act(() => openContentDialog("T", h("p", null, "body"), true));
    expect(title()?.tagName).toBe("H2");
    expect(title()?.textContent).toBe("T");
    expect(panel()!.textContent).toBe("Tbodyclose");
    expect(labels()).toEqual(["close"]);
    expect(panel()!.className).toContain("960px");
    act(() => button("close").click());
    expect(dialog.value).toBeNull();
  });

  it("uses the normal width unless asked for a wide one", () => {
    act(() => openContentDialog("T", "plain string content"));
    expect(panel()!.textContent).toBe("Tplain string contentclose");
    expect(panel()!.className).toContain("600px");
    expect(panel()!.className).not.toContain("960px");
  });
});
