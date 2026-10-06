import * as vscode from "vscode";

/**
 * Open a web page from the page in the browser, such as a commit on its hosting site. Only web
 * addresses are accepted, so the page cannot start another program through a URI handler.
 * Resolves whether it opened; the user may decline a site they do not trust.
 */
export async function openUrl(params: unknown): Promise<boolean> {
  if (typeof params !== "string" || !/^https?:\/\/[^/\s]/i.test(params)) {
    throw new Error("Invalid openUrl parameters");
  }
  return vscode.env.openExternal(vscode.Uri.parse(params, true));
}
