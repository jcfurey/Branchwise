import { beforeEach, describe, expect, test, vi } from "vitest";

import { createWebviewHtml, escapeAttribute } from "@/extension/html";

const fake = vi.hoisted(() => ({
  env: { language: "en" },
  translate: vi.fn((key: string) => key),
  joinPath: vi.fn((base: unknown, ...segments: string[]) => [base, ...segments].join("/"))
}));

vi.mock("vscode", () => ({
  env: fake.env,
  l10n: { t: fake.translate },
  Uri: { joinPath: fake.joinPath }
}));

const toWebview = vi.fn((resource: unknown) => `U(${String(resource)})`);

function page() {
  return createWebviewHtml(
    { extensionUri: "ext" } as unknown as import("vscode").ExtensionContext,
    { cspSource: "csp", asWebviewUri: toWebview } as unknown as import("vscode").Webview
  );
}

/** The value of `name` in the first tag that matches `tag`. */
function attributeOf(html: string, tag: RegExp, name: string) {
  const element = tag.exec(html)?.[0] ?? "";
  return new RegExp(`\\s${name}="([^"]*)"`).exec(element)?.[1];
}

const policyOf = (html: string) =>
  attributeOf(html, /<meta http-equiv="Content-Security-Policy"[^>]*>/, "content") ?? "";
const scriptNonceOf = (html: string) => attributeOf(html, /<script [^>]*>/, "nonce") ?? "";

beforeEach(() => {
  fake.env.language = "en";
  vi.clearAllMocks();
});

describe("graph page", () => {
  test("allows only the extension's own resources, its nonce-bearing script and a blob worker", () => {
    const html = page();
    const nonce = scriptNonceOf(html);
    const directives = policyOf(html)
      .split(";")
      .map((directive) => directive.trim())
      .filter((directive) => directive !== "");
    expect(directives).toEqual([
      "default-src 'none'",
      "style-src csp 'unsafe-inline'",
      `script-src csp 'nonce-${nonce}'`,
      "img-src data:",
      "connect-src csp",
      // The page builds the worker that matches custom issue links from a blob of its own.
      "worker-src blob:"
    ]);
    expect(policyOf(html).trimEnd()).toMatch(/;$/);
  });

  test("uses a fresh, unguessable nonce for every page", () => {
    const first = page();
    const second = page();
    for (const html of [first, second]) {
      expect(scriptNonceOf(html)).toMatch(/^[A-Za-z0-9_-]{22,}$/);
      expect(policyOf(html)).toContain(`'nonce-${scriptNonceOf(html)}'`);
    }
    expect(scriptNonceOf(first)).not.toBe(scriptNonceOf(second));
  });

  test("loads the bundled stylesheet and script through webview URIs", () => {
    const html = page();
    expect(fake.joinPath.mock.calls).toEqual(
      expect.arrayContaining([
        ["ext", "out", "web.min.css"],
        ["ext", "out", "web.min.js"]
      ])
    );
    expect(toWebview.mock.calls.map(([resource]) => resource).toSorted()).toEqual([
      "ext/out/web.min.css",
      "ext/out/web.min.js"
    ]);
    expect(attributeOf(html, /<link [^>]*>/, "rel")).toBe("stylesheet");
    expect(attributeOf(html, /<link [^>]*>/, "href")).toBe("U(ext/out/web.min.css)");
    expect(attributeOf(html, /<script [^>]*>/, "src")).toBe("U(ext/out/web.min.js)");
  });

  test("has the document skeleton the page renders into", () => {
    const html = page();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    const head = /<head>([\s\S]*)<\/head>/.exec(html)?.[1] ?? "";
    const inOrder = [
      '<meta charset="UTF-8">',
      '<meta http-equiv="Content-Security-Policy"',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<link rel="stylesheet"',
      "<title>Branchwise</title>"
    ].map((part) => head.indexOf(part));
    expect(inOrder.every((position) => position >= 0)).toBe(true);
    expect(inOrder).toEqual(inOrder.toSorted((a, b) => a - b));

    const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
    expect(body.match(/<div id="app"><\/div>/g)).toHaveLength(1);
    expect(body.indexOf('<div id="app"></div>')).toBeLessThan(body.indexOf("<script"));
    expect(body).toMatch(/<script [^>]*><\/script>/);
  });

  test("puts the four root attributes in a fixed order", () => {
    const root = /<html\s([^>]*)>/.exec(page())?.[1] ?? "";
    expect([...root.matchAll(/([\w-]+)="/g)].map(([, name]) => name)).toEqual([
      "lang",
      "data-loading",
      "data-init-failed",
      "data-rpc-timeout"
    ]);
  });

  test("escapes the display language like the translated strings", () => {
    fake.env.language = 'en"<x>&';
    expect(attributeOf(page(), /<html\s[^>]*>/, "lang")).toBe("en&quot;&lt;x&gt;&amp;");
  });

  test("translates exactly the three strings shown before the page is localized", () => {
    const html = page();
    expect(fake.translate.mock.calls).toEqual([
      ["Loading…"],
      ["Unable to open the graph: {0}"],
      ["The extension did not answer in time: {0}"]
    ]);
    expect(attributeOf(html, /<html\s[^>]*>/, "data-rpc-timeout")).toBe(
      "The extension did not answer in time: {0}"
    );
  });
});

describe("escapeAttribute", () => {
  test.each([
    ["&quot;", "&amp;quot;"],
    ["it's", "it's"],
    ["", ""],
    ['a&&b<<>>""', "a&amp;&amp;b&lt;&lt;&gt;&gt;&quot;&quot;"],
    ["中文 «»", "中文 «»"]
  ])("turns %j into %j", (input, output) => {
    expect(escapeAttribute(input)).toBe(output);
  });
});
