// @vitest-environment jsdom
import { h, render, type FunctionComponent } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BranchIcon,
  ChevronDownIcon,
  DetachedIcon,
  EyeClosedIcon,
  EyeIcon,
  GearIcon,
  Icon,
  KebabIcon,
  PausedIcon,
  PlusIcon,
  PublishIcon,
  RefreshIcon,
  RemoteIcon,
  RevealIcon,
  SearchIcon,
  StashIcon,
  TagIcon,
  WorktreeIcon
} from "@/webview/components/ui/Icons";

type Named = FunctionComponent<Record<string, string>>;

const NAMED = {
  BranchIcon,
  ChevronDownIcon,
  DetachedIcon,
  EyeClosedIcon,
  EyeIcon,
  GearIcon,
  KebabIcon,
  PausedIcon,
  PlusIcon,
  PublishIcon,
  RefreshIcon,
  RemoteIcon,
  RevealIcon,
  SearchIcon,
  StashIcon,
  TagIcon,
  WorktreeIcon
} as Record<string, Named>;

let host: HTMLDivElement;

/** Draw a named icon with the given attributes and return its root. */
function glyph(icon: Named, attributes: Record<string, string> = {}) {
  render(h(icon, attributes), host);
  expect(host.childElementCount).toBe(1);
  return host.firstElementChild as SVGSVGElement;
}

/** The attributes of an element as a plain object, to compare in one go. */
function attributesOf(element: Element) {
  return Object.fromEntries([...element.attributes].map((item) => [item.name, item.value]));
}

beforeEach(() => {
  host = document.createElement("div");
});

afterEach(() => {
  render(null, host);
});

describe("Icon", () => {
  it("wraps the shapes in a decorative 16 × 16 drawing in the text colour", () => {
    render(h(Icon, { children: h("path", { d: "M1 1h2" }) }), host);
    const svg = host.firstElementChild!;
    expect(svg.tagName).toBe("svg");
    expect(attributesOf(svg)).toEqual({
      width: "16",
      height: "16",
      viewBox: "0 0 16 16",
      fill: "currentColor",
      "aria-hidden": "true",
      focusable: "false"
    });
    expect(svg.innerHTML).toBe('<path d="M1 1h2"></path>');
  });

  it("lets every attribute from the caller replace its default", () => {
    render(
      h(Icon, {
        class: "size-5",
        viewBox: "0 0 12 16",
        width: "24",
        fill: "none",
        "aria-hidden": "false",
        children: h("circle", { r: "1" })
      }),
      host
    );
    expect(attributesOf(host.firstElementChild!)).toEqual({
      class: "size-5",
      width: "24",
      height: "16",
      viewBox: "0 0 12 16",
      fill: "none",
      "aria-hidden": "false",
      focusable: "false"
    });
  });
});

describe.each(Object.entries(NAMED))("%s", (_name, icon) => {
  it("is one decorative svg with nothing to read or focus", () => {
    const svg = glyph(icon, { class: "k" });
    expect(svg.tagName).toBe("svg");
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.classList.contains("k")).toBe(true);
    expect(svg.textContent).toBe("");
    expect(svg.childElementCount).toBeGreaterThan(0);
    expect(svg.querySelector("title, [id], [role], [tabindex]")).toBeNull();
    for (const name of ["id", "role", "tabindex"]) {
      expect(svg.hasAttribute(name)).toBe(false);
    }
  });

  it("takes the caller's value for any attribute it sets itself", () => {
    const overrides = {
      viewBox: "0 0 4 4",
      fill: "red",
      stroke: "blue",
      "stroke-width": "3",
      "aria-hidden": "false"
    };
    const svg = glyph(icon, overrides);
    for (const [name, value] of Object.entries(overrides)) {
      expect(svg.getAttribute(name)).toBe(value);
    }
    expect(svg.getAttribute("focusable")).toBe("false");
  });
});

describe("the named icons", () => {
  it("tell a shown eye from a hidden one by their drawing", () => {
    expect(glyph(EyeIcon as Named).innerHTML).not.toBe(glyph(EyeClosedIcon as Named).innerHTML);
  });

  it("draw each picture differently", () => {
    const drawings = Object.values(NAMED).map((icon) => glyph(icon).innerHTML);
    expect(new Set(drawings).size).toBe(drawings.length);
  });

  it.each([
    ["BranchIcon", BranchIcon],
    ["TagIcon", TagIcon]
  ])("fill %s, so a ref label can paint it with the CSS fill", (_name, icon) => {
    const svg = glyph(icon as Named);
    expect(svg.getAttribute("fill")).not.toBe("none");
    expect(svg.hasAttribute("stroke")).toBe(false);
    for (const shape of svg.querySelectorAll("*")) {
      expect(shape.getAttribute("fill") ?? "inherited").not.toBe("none");
      expect(shape.getAttribute("stroke") ?? "none").toBe("none");
    }
  });
});
