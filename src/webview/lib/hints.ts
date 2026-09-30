import { effect, signal } from "@preact/signals";

import { contextMenu } from "@/webview/lib/stores";
import { vscode } from "@/webview/lib/vscode";

type HintState = { commitMenu?: boolean };

const initial = vscode.getState() as { hints?: HintState } | null;
let saved: HintState = initial?.hints ?? {};

/** The line above the graph that says where a commit's actions are. It goes once a commit menu opens. */
export const commitMenuHintDismissed = signal(saved.commitMenu === true);

export function dismissCommitMenuHint() {
  if (commitMenuHintDismissed.value) {
    return;
  }
  commitMenuHintDismissed.value = true;
  saved = { ...saved, commitMenu: true };
  const current = vscode.getState();
  vscode.setState({
    ...(typeof current === "object" && current !== null ? current : {}),
    hints: saved
  });
}

effect(() => {
  if (contextMenu.value?.source.startsWith("commit:")) {
    dismissCommitMenuHint();
  }
});
