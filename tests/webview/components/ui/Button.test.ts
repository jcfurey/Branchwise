// @vitest-environment jsdom
import { h, render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/webview/components/ui/Button";

let host: HTMLDivElement;

/** Draw one button labelled "Go" and return it. */
function draw(props: Parameters<typeof Button>[0] = {}) {
  render(h(Button, props, "Go"), host);
  expect(host.childElementCount).toBe(1);
  return host.querySelector("button")!;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("Button", () => {
  it("is a plain button unless told to submit", () => {
    const plain = draw();
    expect(plain.type).toBe("button");
    expect(plain.getAttribute("type")).toBe("button");

    expect(draw({ type: "submit" }).type).toBe("submit");
  });

  it("passes other attributes to the button as given", () => {
    // JSX takes any data-* attribute, but the props type names none, so this one is spread in.
    const data = { "data-x": "1" };
    const button = draw({
      title: "Tip",
      "aria-label": "Named",
      "aria-expanded": true,
      "aria-haspopup": "menu",
      disabled: true,
      ...data
    });
    expect(button.title).toBe("Tip");
    expect(button.getAttribute("aria-label")).toBe("Named");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.disabled).toBe(true);
    expect(button.dataset["x"]).toBe("1");
  });

  it("adds a caller's class to its own", () => {
    const own = [...draw().classList];
    expect(own.length).toBeGreaterThan(1);

    const extended = draw({ class: "extra" });
    expect([...extended.classList]).toEqual([...own, "extra"]);

    expect(draw({ class: "" }).getAttribute("class")).toBe(own.join(" "));
  });

  it("draws the primary look with classes of its own", () => {
    const standard = draw().getAttribute("class");
    const primary = draw({ variant: "primary" }).getAttribute("class");
    expect(primary).not.toBe(standard);
    expect(draw({ variant: "default" }).getAttribute("class")).toBe(standard);
  });

  it("holds exactly its children", () => {
    render(h(Button, {}, h("svg", { class: "glyph" }), "Save"), host);
    const button = host.querySelector("button")!;
    expect(button.textContent).toBe("Save");
    expect(button.firstElementChild?.getAttribute("class")).toBe("glyph");
    expect(button.childNodes).toHaveLength(2);
  });

  it("does not submit a form it sits in unless it is a submit button", () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const onClick = vi.fn();
    const form = (type?: "submit") =>
      h("form", { onSubmit }, h(Button, type ? { type, onClick } : { onClick }, "Send"));

    render(form(), host);
    host.querySelector("button")!.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();

    render(form("submit"), host);
    host.querySelector("button")!.click();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("ignores clicks while disabled", () => {
    const onClick = vi.fn();
    draw({ disabled: true, onClick }).click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
