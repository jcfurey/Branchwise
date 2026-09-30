// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Select } from "@/webview/components/ui/Select";

const SIZES = [
  { label: "Small", value: "s" },
  { label: "Medium", value: "m" },
  { label: "Large", value: "l" }
];

type Props = Parameters<typeof Select>[0];

let host: HTMLDivElement;

/** Draw a size picker, set to Medium unless told otherwise, and return the select. */
function picker(props: Partial<Props> = {}) {
  act(() => render(h(Select, { options: SIZES, value: "m", onChange: () => {}, ...props }), host));
  return host.querySelector("select")!;
}

/** What a script or the browser does when a choice is made: set the value, then fire `type`. */
function pick(select: HTMLSelectElement, value: string, type: "input" | "change" = "change") {
  select.value = value;
  act(() => {
    select.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("Select", () => {
  it("is a native select holding one option per entry, in order", () => {
    const select = picker();
    expect(host.childElementCount).toBe(1);
    expect(host.firstElementChild).toBe(select);
    expect([...select.children].map((option) => option.tagName)).toEqual([
      "OPTION",
      "OPTION",
      "OPTION"
    ]);
    expect([...select.options].map((option) => [option.value, option.text])).toEqual([
      ["s", "Small"],
      ["m", "Medium"],
      ["l", "Large"]
    ]);
    expect(select.selectedIndex).toBe(1);
    expect(select.textContent).toBe("SmallMediumLarge");
  });

  it("names itself only with the attributes it is given", () => {
    let select = picker();
    for (const name of ["id", "aria-label", "aria-labelledby"]) {
      expect(select.hasAttribute(name)).toBe(false);
    }

    select = picker({ "aria-labelledby": undefined });
    expect(select.hasAttribute("aria-labelledby")).toBe(false);

    select = picker({ id: "size", "aria-label": "Size", "aria-labelledby": "question" });
    expect(select.id).toBe("size");
    expect(select.getAttribute("aria-label")).toBe("Size");
    expect(select.getAttribute("aria-labelledby")).toBe("question");
  });

  it("reports each committed change, but not input on its own", () => {
    const onChange = vi.fn();
    const select = picker({ onChange });
    expect(onChange).not.toHaveBeenCalled();

    pick(select, "l", "input");
    expect(onChange).not.toHaveBeenCalled();

    pick(select, "l");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("l");

    // The same value again is still reported: the component does not filter.
    pick(select, "l");
    expect(onChange.mock.calls).toEqual([["l"], ["l"]]);
  });

  it("chooses nothing for a value that no option has", () => {
    const onChange = vi.fn();
    const select = picker({ value: "xl", onChange });
    expect(select.selectedIndex).toBe(-1);
    expect(select.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    const empty = picker({ options: [], value: "" });
    expect(empty.options).toHaveLength(0);
    expect(empty.selectedIndex).toBe(-1);
  });

  it("shows the first of several options that share the value", () => {
    const select = picker({
      options: [
        { label: "Twin one", value: "t" },
        { label: "Twin two", value: "t" }
      ],
      value: "t"
    });
    expect(select.selectedIndex).toBe(0);
  });

  it("goes back to the parent's value when the parent draws it again", () => {
    const select = picker();
    pick(select, "s");
    // Until the parent draws again, the control shows the user's choice.
    expect(select.value).toBe("s");

    picker();
    expect(select.value).toBe("m");
  });

  it("is the only control the Tab key reaches", () => {
    picker();
    expect(host.querySelectorAll("button, input, a, textarea, [tabindex]")).toHaveLength(0);
  });
});
