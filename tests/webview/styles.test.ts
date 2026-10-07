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
      "--color-drop: var(--vscode-list-dropBackground);",
      "--color-card: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));",
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

  it("sizes commit rows and branch labels from the row height of the table they are in", () => {
    expect(ruleOf(utilities, ".h-\\(--row-height\\)")).toContain("height: var(--row-height);");
    expect(ruleOf(utilities, ".leading-\\(--row-height\\)")).toContain(
      "line-height: var(--row-height);"
    );
    // Written into the rule rather than read from the root, which has no row height of its own.
    const label = "min(18px, calc(var(--row-height, 24px) - 4px))";
    expect(ruleOf(utilities, ".h-ref-label")).toContain(`height: ${label};`);
    expect(ruleOf(utilities, ".size-ref-label")).toContain(`width: ${label};`);
    expect(theme).not.toContain("--spacing-ref-label");
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

  it("draws a day's first row with a themed line that leaves the row's height alone", () => {
    expect(theme).toContain(
      "--color-day-line: var(--vscode-tree-indentGuidesStroke, rgba(128, 128, 128, 0.4));"
    );
    const rule = ruleOf(components, ".branch-focus-row[data-day-start] > td");
    expect(rule).toContain(
      "background-image: linear-gradient(var(--color-day-line), var(--color-day-line));"
    );
    expect(rule).toContain("background-size: 100% 1px;");
    expect(rule).not.toContain("border");
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

  it("prefers Branchwise's own theme colours for the conflict mark and the unpushed dot", () => {
    expect(theme).toMatch(
      /--color-git-conflict: var\(\s*--vscode-branchwise-conflict,\s*var\(--vscode-gitDecoration-conflictingResourceForeground\)\s*\);/
    );
    expect(theme).toMatch(
      /--color-unpushed: var\(\s*--vscode-branchwise-unpushed,\s*var\(--vscode-gitDecoration-modifiedResourceForeground\)\s*\);/
    );
    // Outside the layers, so it wins over the dot's own background utility.
    const unlayered = css.slice(css.lastIndexOf("\n}\n", css.indexOf('[data-push="unpushed"] {')));
    expect(ruleOf(unlayered, '[data-push="unpushed"]')).toContain(
      "background-color: var(--color-unpushed);"
    );
    expect(ruleAt(css, '[data-push="unpushed"]')).toBeGreaterThan(
      css.indexOf("@layer utilities {")
    );
  });

  it("outlines what high contrast themes cannot see as shading", () => {
    const tokens = ruleOf(components, ".vscode-high-contrast, .vscode-high-contrast-light");
    expect(tokens).toContain(
      "--color-line: var(--vscode-contrastBorder, rgba(128, 128, 128, 0.5));"
    );
    expect(tokens).toContain(
      "--color-line-soft: var(--vscode-contrastBorder, rgba(128, 128, 128, 0.25));"
    );
    const hovered = ruleOf(
      components,
      ".vscode-high-contrast .branch-focus-row:hover, .vscode-high-contrast-light .branch-focus-row:hover"
    );
    expect(hovered).toContain(
      "outline: 1px dashed var(--vscode-contrastActiveBorder, transparent);"
    );
    const selected = ruleOf(
      components,
      ["", "-light"]
        .flatMap((kind) =>
          ["selected", "expanded"].map(
            (state) => `.vscode-high-contrast${kind} .branch-focus-row[aria-${state}="true"]`
          )
        )
        .join(", ")
    );
    expect(selected).toContain(
      "outline: 1px solid var(--vscode-contrastActiveBorder, transparent);"
    );
  });

  it("keeps focus, selection and the graph's marks visible in forced colours", () => {
    const start = css.indexOf("@media (forced-colors: active) {");
    expect(start).toBeGreaterThan(css.indexOf("@layer utilities {"));
    const forced = css.slice(start);
    expect(ruleOf(forced, ":focus-visible, .branch-focus-row:focus")).toContain(
      "outline: 2px solid Highlight;"
    );
    expect(
      ruleOf(
        forced,
        '.branch-focus-row[aria-selected="true"], .branch-focus-row[aria-expanded="true"]'
      )
    ).toContain("outline: 2px solid Highlight;");
    expect(ruleOf(forced, "[data-conflicts]")).toContain("color: LinkText;");
    const unpushed = ruleOf(forced, '[data-push="unpushed"]');
    expect(unpushed).toContain("forced-color-adjust: none;");
    expect(unpushed).toContain("background-color: CanvasText;");
    expect(ruleOf(forced, '[data-push="unpulled"]')).toContain("border-color: CanvasText;");
    expect(ruleOf(forced, "[data-ref], [data-more-refs]")).toContain("border-color: CanvasText;");
    expect(ruleOf(forced, "[data-hover-card]")).toContain("border-color: CanvasText;");
    const cap = ruleOf(forced, "[data-ref] > svg:first-child");
    expect(cap).toContain("background-color: CanvasText;");
    expect(cap).toContain("color: Canvas;");
    const splitter = ruleOf(forced, "[data-details-splitter]");
    expect(splitter).toContain("forced-color-adjust: none;");
    expect(splitter).toContain("background-color: CanvasText;");
    expect(
      ruleOf(forced, "[data-details-splitter]:hover, [data-details-splitter]:focus")
    ).toContain("background-color: Highlight;");
  });

  it("colours the overview strip from the theme, and from system colours when forced", () => {
    expect(theme).toContain(
      "--color-overview-band: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));"
    );
    expect(theme).toContain("--color-overview-unpushed: var(--color-unpushed);");
    // The canvas reads its colours from probes, which the utilities colour.
    for (const kind of ["head", "selected", "details", "branch", "tag", "unpushed"]) {
      expect(ruleOf(utilities, `.text-overview-${kind}`)).toContain(
        `color: var(--color-overview-${kind});`
      );
    }
    expect(css).not.toContain("overview-match");
    const strip = ruleOf(components, ".overview-strip");
    expect(strip).toContain("forced-color-adjust: none;");
    expect(strip).toContain("--overview-tag-alpha: 0.55;");
    expect(
      ruleOf(
        components,
        ".vscode-high-contrast .overview-strip, .vscode-high-contrast-light .overview-strip"
      )
    ).toContain("--overview-tag-alpha: 1;");
    const forced = ruleOf(
      css.slice(css.indexOf("@media (forced-colors: active) {")),
      ".overview-strip"
    );
    expect(forced).toContain("--color-overview-head: CanvasText;");
    expect(forced).toContain("--color-overview-selected: Highlight;");
    expect(forced).toContain("--overview-band-alpha: 0.4;");
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

  it("shimmers the graph's placeholders quietly, and not at all for less motion", () => {
    const shimmer = ruleOf(components, ".skeleton-shimmer");
    expect(shimmer).toContain("var(--color-btn-hover)");
    expect(shimmer).toContain("animation: skeleton-shimmer 1.8s ease-in-out infinite;");
    expect(components).toMatch(/@keyframes skeleton-shimmer \{\s+from \{\s+background-position/);
    const reduced = components.slice(components.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(ruleOf(reduced, ".skeleton-shimmer")).toContain("animation: none;");
  });

  it("eases a branch preview in, and not at all for less motion", () => {
    const selector = ":where([data-branch-preview]) :is(.branch-focus-row, [data-branch-relation])";
    expect(ruleOf(components, selector)).toContain("color 150ms ease-out");
    const reduced = components.slice(components.lastIndexOf("@media (prefers-reduced-motion"));
    expect(ruleOf(reduced, selector)).toContain("transition: none;");
  });
});
