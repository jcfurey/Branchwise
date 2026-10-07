import { randomBytes } from "node:crypto";

import * as vscode from "vscode";

import { EXTENSION_NAME } from "@/extension/constants";

const ATTRIBUTE_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  '"': "&quot;",
  "<": "&lt;",
  ">": "&gt;"
};

/** Text that can sit between double quotes in an attribute without ending or breaking it. */
export function escapeAttribute(value: string): string {
  return value.replaceAll(/[&"<>]/g, (character) => ATTRIBUTE_ENTITIES[character] ?? character);
}

/**
 * The page a graph webview loads. Its scripts run only with this call's nonce, and the root
 * element carries the few strings the page shows before its localized strings arrive over RPC:
 * while it loads, when that request fails, and when any request times out.
 */
export function createWebviewHtml(ctx: vscode.ExtensionContext, webview: vscode.Webview): string {
  // 24 random bytes give 192 bits in 32 base64url characters, with no padding.
  const nonce = randomBytes(24).toString("base64url");
  const source = webview.cspSource;
  const bundled = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "out", file)).toString();

  const policy = [
    "default-src 'none'",
    `style-src ${source} 'unsafe-inline'`,
    `script-src ${source} 'nonce-${nonce}'`,
    "img-src data:",
    `connect-src ${source}`,
    // The worker that matches custom issue-link patterns away from the page (custom-links.ts).
    "worker-src blob:"
  ]
    .map((directive) => `${directive};`)
    .join(" ");

  // The page reads these as document.documentElement.dataset.loading, .initFailed and .rpcTimeout.
  const rootAttributes: [name: string, value: string][] = [
    ["lang", vscode.env.language],
    ["data-loading", vscode.l10n.t("Loading…")],
    ["data-init-failed", vscode.l10n.t("Unable to open the graph: {0}")],
    ["data-rpc-timeout", vscode.l10n.t("The extension did not answer in time: {0}")]
  ];
  const root = rootAttributes
    .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
    .join(" ");

  return `<!DOCTYPE html>
<html ${root}>
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${policy}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${bundled("web.min.css")}">
    <title>${EXTENSION_NAME}</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${bundled("web.min.js")}"></script>
  </body>
</html>
`;
}
