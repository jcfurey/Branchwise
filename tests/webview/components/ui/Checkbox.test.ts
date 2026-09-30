// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Checkbox } from "@/webview/components/ui/Checkbox";

type Props = Parameters<typeof Checkbox>[0];

let host: HTMLDivElement;

/** Draw a checkbox labelled "Prune" (unless told otherwise) and return its parts. */
function box(props: Partial<Props> = {}) {
  act(() => render(h(Checkbox, { label: "Prune", ...props }), host));
  const label = host.firstElementChild as HTMLLabelElement;
  return { label, input: label.querySelector("input")! };
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("Checkbox", () => {
  it("is a label around a native checkbox, a hidden tick and its text", () => {
    const { label, input } = box();
    expect(host.childElementCount).toBe(1);
    expect(label.tagName).toBe("LABEL");
    expect(label.hasAttribute("for")).toBe(false);
    expect(label.querySelectorAll("input")).toHaveLength(1);
    expect(input.type).toBe("checkbox");
    expect(input.closest("label")).toBe(label);

    const ticks = label.querySelectorAll('svg[aria-hidden="true"][focusable="false"]');
    expect(ticks).toHaveLength(1);
    expect(label.querySelectorAll("svg")).toHaveLength(1);
    expect(label.textContent).toBe("Prune");
    expect(label.lastChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("offers the Tab key the checkbox and nothing else", () => {
    const { label } = box();
    expect(label.querySelectorAll("button, select, textarea, a, [tabindex]")).toHaveLength(0);
  });

  it("gives the input the props other than the label", () => {
    const { input } = box({ id: "prune", checked: true, disabled: true, name: "prune" });
    expect(input.id).toBe("prune");
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(true);
    expect(input.name).toBe("prune");
  });

  it("toggles from a click anywhere on the label and reports the new state", () => {
    const seen: Array<boolean> = [];
    const onInput = vi.fn((event: Event) => {
      seen.push((event.currentTarget as HTMLInputElement).checked);
    });
    const onChange = vi.fn();
    const { label, input } = box({ checked: false, onInput, onChange });

    act(() => label.click());
    expect(onInput).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(seen).toEqual([true]);

    act(() => input.click());
    expect(seen).toEqual([true, false]);
  });

  it("ignores clicks while disabled", () => {
    const onInput = vi.fn();
    const { label, input } = box({ disabled: true, onInput });
    act(() => label.click());
    act(() => input.click());
    expect(onInput).not.toHaveBeenCalled();
    expect(input.checked).toBe(false);
  });

  it("goes back to its checked prop when the parent draws it again", () => {
    const { label, input } = box({ checked: false });
    act(() => label.click());
    // Until the parent draws again, the box shows the click.
    expect(input.checked).toBe(true);

    box({ checked: false });
    expect(input.checked).toBe(false);
  });

  it("lets its text wrap, breaking long words, instead of running out of its container", () => {
    const { label } = box({ label: "/home/someone/projects/a-very-long-repository-name" });
    expect(label.classList.contains("whitespace-nowrap")).toBe(false);
    expect(label.classList.contains("wrap-anywhere")).toBe(true);
  });
});
