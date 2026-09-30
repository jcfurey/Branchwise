// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Dialog } from "@/webview/components/ui/Dialog";
import { dialog } from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

// A form refuses a ref name that `hasInvalidRefChars` refuses. These names used to pass the form
// and fail in Git instead; they are now caught before the form is sent.

let host: HTMLElement;
let openings = 0;

/** Open a form whose only field is a ref name holding `name`. */
function askForBranch(name: string) {
  act(() => {
    dialog.value = {
      kind: "form",
      message: "New branch",
      inputs: [{ kind: "ref", label: "Name", value: name }],
      action: "Create",
      onSubmit: () => {},
      source: null,
      token: ++openings
    };
  });
  const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  return { submit, tooltip: submit.parentElement!.getAttribute("title") };
}

beforeAll(() => {
  setupWebviewTest();
  Object.defineProperty(window, "l10n", {
    value: new Proxy(
      { invalidCharacters: "Cannot {0} with that name." },
      { get: (strings, key) => Reflect.get(strings, key) ?? String(key) }
    ),
    configurable: true
  });
});
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  act(() => render(h(Dialog, null), host));
});
afterEach(() => {
  act(() => {
    dialog.value = null;
  });
  act(() => render(null, host));
  host.remove();
});

describe("ref fields of a form", () => {
  it.each(["HEAD", ".hidden", "a.lock/b", "a\tb", "a\u007fb"])(
    "keep the form from being sent with %j",
    (name) => {
      const { submit, tooltip } = askForBranch(name);

      expect(submit.disabled).toBe(true);
      expect(tooltip).toBe("Cannot Create with that name.");
    }
  );

  it("still let a name through that Git accepts", () => {
    const { submit, tooltip } = askForBranch("release./x");

    expect(submit.disabled).toBe(false);
    expect(tooltip).toBeNull();
  });
});
