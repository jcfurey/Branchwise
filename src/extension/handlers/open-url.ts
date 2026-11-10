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
  // Parsed only to refuse what VS Code cannot read. Opened, a Uri is taken apart and put
  // together again, which undoes the escaping inside a value: in the name of a branch that a
  // merge request is opened for, `%2B` would arrive as a space and `%26` would start another
  // parameter. VS Code opens a string as it is written, though its types name only the Uri.
  vscode.Uri.parse(params, true);
  return vscode.env.openExternal(params as unknown as vscode.Uri);
}
