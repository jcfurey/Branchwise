import { expect, it, vi } from "vitest";

import { createWebviewHtml, escapeAttribute } from "@/extension/html";

vi.mock("vscode", () => ({
  env: { language: "zh-tw" },
  l10n: { t: (message: string) => `«${message}» "quoted" & <tagged>` },
  Uri: { joinPath: (_base: unknown, ...parts: string[]) => parts.join("/") }
}));

it("carries the display language and the strings shown before the page is localized", () => {
  const html = createWebviewHtml(
    { extensionUri: "ext" } as unknown as import("vscode").ExtensionContext,
    { cspSource: "csp", asWebviewUri: (uri: unknown) => uri } as unknown as import("vscode").Webview
  );
  const root = /<html ([^>]*)>/.exec(html)![1]!;
  const attribute = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(root)?.[1];
  expect(attribute("lang")).toBe("zh-tw");
  expect(attribute("data-loading")).toBe(escapeAttribute('«Loading…» "quoted" & <tagged>'));
  expect(attribute("data-init-failed")).toContain("Unable to open the graph: {0}");
  expect(attribute("data-rpc-timeout")).toContain("The extension did not answer in time: {0}");
  // Quotes cannot end the attribute early.
  expect(root).not.toContain('"quoted"');
});

it("escapes text for a double-quoted attribute", () => {
  expect(escapeAttribute(`a "b" & <c>`)).toBe("a &quot;b&quot; &amp; &lt;c&gt;");
});
