import { describe, expect, it, vi } from "vitest";

import { createRepoSelection, getSourceControlRepo } from "@/extension/repoSelection";

function makeSelection() {
  let receive: ((message: unknown) => void) | undefined;
  const dispose = vi.fn();
  const webview = {
    onDidReceiveMessage: (handler: (message: unknown) => void) => {
      receive = handler;
      return { dispose };
    }
  };
  const send = vi.fn();
  const selection = createRepoSelection(webview as unknown as import("vscode").Webview, send);
  return { selection, send, dispose, receive: (message: unknown) => receive?.(message) };
}

describe("Source Control repository selection", () => {
  it("uses the clicked Source Control root rather than the active editor", () => {
    const sourceControl = {
      rootUri: { fsPath: "/workspace/src/child module" } as import("vscode").Uri
    };
    expect(getSourceControlRepo(sourceControl)).toBe("/workspace/src/child module");
    expect(getSourceControlRepo()).toBeUndefined();
    expect(getSourceControlRepo({ rootUri: undefined })).toBeUndefined();
  });

  it("retains only the most recent click while the graph is loading", () => {
    const { selection, send, receive } = makeSelection();
    selection.select("/workspace/first");
    selection.select("/workspace/second");
    receive(null);
    receive({ command: "loadRepos" });
    expect(send).not.toHaveBeenCalled();
    receive({ command: "viewReady" });
    expect(send.mock.calls).toEqual([["/workspace/second"]]);
  });

  it("switches an initialized graph and does not replay an old selection on another ready event", () => {
    const { selection, send, receive } = makeSelection();
    receive({ command: "viewReady" });
    selection.select("/workspace/first");
    selection.select("/workspace/second");
    receive({ command: "viewReady" });
    expect(send.mock.calls).toEqual([["/workspace/first"], ["/workspace/second"]]);
  });

  it("discards queued clicks when the panel closes", () => {
    const { selection, send, receive, dispose } = makeSelection();
    selection.select("/workspace/first");
    selection.dispose();
    receive({ command: "viewReady" });
    expect(send).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
