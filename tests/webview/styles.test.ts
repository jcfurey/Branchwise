import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

/** The stylesheet as esbuild.js builds it, split into its top-level layers. */
let css = "";
let theme = "";
let components = "";
let utilities = "";

/** The text of the top-level `@layer name { … }` block. */
function layer(name: string) {
  const start = css.indexOf(`\n@layer ${name} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}\n", start);
  return css.slice(start, end);
}

/** Where a rule for `selector` begins in `text`: the selector is followed by its block. */
function ruleAt(text: string, selector: string) {
  const at = text.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return at;
}

/** The declarations of the first rule for `selector` in `text`. */
function ruleOf(text: string, selector: string) {
  const start = ruleAt(text, selector);
  return text.slice(start, text.indexOf("}", start));
}

beforeAll(async () => {
  // Tailwind loads the stylesheet itself, relative to `from`, which is relative to the project
  // root that Vitest runs in. It then scans the stylesheet's folder for class names, as in a build.
  const result = await postcss([tailwindcss()]).process('@import "./styles.css";', {
    from: "src/webview/styles.test.css"
  });
  // A selector list is printed on one line or several, depending on how the file was loaded.
  css = result.css.replaceAll(/,\n\s*/g, ", ");
  theme = layer("theme");
  components = layer("components");
  utilities = layer("utilities");
});

describe("styles.css", () => {
  it("declares the layers so that any utility beats a hand-written rule", () => {
    expect(css).toContain("@layer theme, base, components, utilities;");
  });

  it("names the design tokens after VS Code's theme variables", () => {
    for (const token of [
      "--text-ui: 13px;",
      "--radius-md: 5px;",
      "--color-line: rgba(128, 128, 128, 0.5);",
      "--color-focus: var(--vscode-focusBorder);",
      "--color-graph: var(--vscode-focusBorder);",
      "--color-git-deleted: var(--vscode-gitDecoration-deletedResourceForeground);",
      "--default-font-family: var(--vscode-font-family);"
    ]) {
      expect(theme).toContain(token);
    }
  });

  it("no longer defines the unused dialog width", () => {
    expect(css).not.toContain("--container-dialog");
  });

  it("builds the utilities the webview's components use", () => {
    expect(ruleOf(utilities, ".text-ui")).toContain("font-size: var(--text-ui);");
    expect(ruleOf(utilities, ".shadow-head")).toContain("var(--color-graph)");
    expect(ruleOf(utilities, ".shadow-scroll")).toContain("var(--vscode-scrollbar-shadow)");
    expect(ruleOf(utilities, ".text-fg\\/60")).toContain("var(--color-fg)");
    expect(ruleOf(utilities, ".wrap-anywhere")).toContain("overflow-wrap: anywhere;");

    // The labelled grid is only ever asked for from the small breakpoint up.
    const small = utilities.indexOf("@media (width >= 40rem)");
    expect(small).toBeGreaterThanOrEqual(0);
    expect(ruleAt(utilities, ".sm\\:grid-cols-labelled")).toBeGreaterThan(small);
    expect(utilities).not.toContain(".grid-cols-labelled {");
  });

  it("lets a caller's background replace a button's, and hovering replace both", () => {
    const own = ruleAt(utilities, ".bg-btn");
    const pressed = ruleAt(utilities, ".bg-row-selected");
    const hovered = ruleAt(utilities, ".enabled\\:hover\\:bg-btn-hover:enabled:hover");
    expect(pressed).toBeGreaterThan(own);
    expect(hovered).toBeGreaterThan(pressed);
  });

  it("gives the graph's scroller a slim themed scrollbar that darkens when held", () => {
    expect(ruleOf(components, ".graph-scrollbar::-webkit-scrollbar")).toContain("height: 8px;");
    const thumb = ruleOf(components, ".graph-scrollbar::-webkit-scrollbar-thumb");
    expect(thumb).toContain("border-radius: 4px;");
    expect(thumb).toContain("var(--vscode-scrollbarSlider-background)");
    expect(ruleOf(components, ".graph-scrollbar::-webkit-scrollbar-thumb:hover")).toContain(
      "var(--vscode-scrollbarSlider-hoverBackground)"
    );
    expect(ruleOf(components, ".graph-scrollbar::-webkit-scrollbar-thumb:active")).toContain(
      "var(--vscode-scrollbarSlider-activeBackground)"
    );
  });

  it("colours a commit row by its relation to the focused branch", () => {
    const row = ruleOf(components, ".branch-focus-row");
    expect(row).toContain("--color-graph: var(--branch-display-colour);");
    expect(row).toContain(
      "scroll-margin-top: calc(var(--main-header-height, 0px) + var(--graph-top, 32px));"
    );

    const merged = '.branch-focus-row[data-branch-relation="merged"]';
    expect(ruleOf(components, merged)).toContain("color: var(--color-fg);");
    const mixed = components.slice(components.indexOf("@supports (color: color-mix("));
    expect(ruleOf(mixed, merged)).toContain(
      "color: color-mix(in srgb, var(--color-fg) 80%, var(--color-muted));"
    );
    expect(ruleOf(components, '.branch-focus-row[data-branch-relation="unrelated"]')).toContain(
      "color: var(--color-muted);"
    );
  });

  it("shows a row in use in full, whatever its relation", () => {
    const emphasis = [
      ".branch-focus-row:hover",
      ".branch-focus-row:focus-within",
      '.branch-focus-row[data-emphasized="true"]'
    ].join(", ");
    const rule = ruleOf(components, emphasis);
    expect(rule).toContain("color: var(--color-fg);");
    expect(rule).toContain("--color-graph: var(--branch-colour);");

    // Equal specificity, so the emphasis must come after every relation rule.
    const last = Math.max(
      components.lastIndexOf('[data-branch-relation="merged"]'),
      components.lastIndexOf('[data-branch-relation="unrelated"]')
    );
    expect(ruleAt(components, emphasis)).toBeGreaterThan(last);
  });

  it("fades the scroll shade in over the first pixel of scrolling", () => {
    expect(components).toMatch(/@keyframes scroll-shadow \{\s+from \{\s+opacity: 0;/);
    const shade = ruleOf(components, ".animate-scroll-shadow");
    const shorthand = shade.indexOf("animation: scroll-shadow linear both;");
    expect(shorthand).toBeGreaterThanOrEqual(0);
    // After the shorthand, which would reset them.
    expect(shade.indexOf("animation-timeline: scroll(root block);")).toBeGreaterThan(shorthand);
    expect(shade.indexOf("animation-range: 0 1px;")).toBeGreaterThan(shorthand);
  });
});
