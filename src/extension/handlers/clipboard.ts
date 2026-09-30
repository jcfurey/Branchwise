import * as vscode from "vscode";

/**
 * Put text from the page on the system clipboard. Resolves whether that worked; rejects when the
 * page sent something other than text.
 */
export async function copyToClipboard(params: unknown): Promise<boolean> {
  if (typeof params !== "string") {
    throw new Error("Invalid copyToClipboard parameters");
  }
  try {
    await vscode.env.clipboard.writeText(params);
    return true;
  } catch {
    // The page tells the user it could not copy; the reason would not help them.
    return false;
  }
}
