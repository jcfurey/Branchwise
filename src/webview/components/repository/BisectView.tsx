import { useState } from "preact/hooks";

import { QueryStatus, TextField } from "@/webview/components/history/QueryControls";
import { Button } from "@/webview/components/ui/Button";
import { closeDialog, openContentDialog } from "@/webview/lib/actions";
import { focusHistory } from "@/webview/lib/navigation";
import { confirmRepositoryAction, sendRepositoryAction } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";

const drafts = new Map<string, { good: string; bad: string }>();

function BisectView({ repo }: { repo: string }) {
  const query = useRepositoryQuery<"bisect">({ kind: "bisect" }, repo);
  const draft = drafts.get(repo) ?? { good: "", bad: "HEAD" };
  const [good, setGood] = useState(draft.good);
  const [bad, setBad] = useState(draft.bad);
  const state = query.data?.state;
  return (
    <div class="space-y-3 text-left">
      <p class="text-muted">{window.l10n.bisectHint}</p>
      <QueryStatus {...query} />
      {state ? (
        <>
          <p class="break-all">
            {window.l10n.bisectOriginal}: <b>{state.original}</b>
          </p>
          {state.firstBad ? (
            <p>
              <b>{window.l10n.bisectFound}</b>
              <br />
              <code class="break-all">{state.firstBad}</code>
            </p>
          ) : state.ambiguous ? (
            <p role="status">{window.l10n.bisectAmbiguous}</p>
          ) : (
            <p>{window.l10n.bisectRemaining.replace("{0}", String(state.remaining))}</p>
          )}
          <button
            class="block w-full cursor-pointer rounded border border-line-soft p-3 text-left hover:bg-row-hover"
            onClick={() => {
              closeDialog();
              focusHistory(state.firstBad ?? state.head);
            }}
          >
            <code>{(state.firstBad ?? state.head).slice(0, 12)}</code> {state.subject}
          </button>
          <div class="flex flex-wrap gap-2">
            {!state.firstBad &&
              !state.ambiguous &&
              (["good", "bad", "skip"] as const).map((mark) => (
                <Button
                  key={mark}
                  disabled={query.loading}
                  onClick={() => sendRepositoryAction({ kind: "bisectMark", state, mark }, repo)}
                >
                  {
                    window.l10n[
                      mark === "good"
                        ? "bisectMarkGood"
                        : mark === "bad"
                          ? "bisectMarkBad"
                          : "bisectSkip"
                    ]
                  }
                </Button>
              ))}
            <Button
              disabled={query.loading}
              onClick={() =>
                confirmRepositoryAction(
                  window.l10n.bisectResetConfirm.replace("{0}", state.original),
                  window.l10n.bisectReset,
                  { kind: "bisectMark", state, mark: "reset" },
                  repo
                )
              }
            >
              {window.l10n.bisectReset}
            </Button>
          </div>
        </>
      ) : (
        query.data && (
          <form
            class="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (query.data?.head && good.trim() && bad.trim()) {
                drafts.set(repo, { good, bad });
                sendRepositoryAction(
                  { kind: "bisectStart", good, bad, expectedHead: query.data.head },
                  repo
                );
              }
            }}
          >
            <TextField
              label={window.l10n.bisectGood}
              value={good}
              change={(value) => {
                setGood(value);
                drafts.set(repo, { good: value, bad });
              }}
            />
            <TextField
              label={window.l10n.bisectBad}
              value={bad}
              change={(value) => {
                setBad(value);
                drafts.set(repo, { good, bad: value });
              }}
            />
            <Button
              type="submit"
              disabled={query.loading || !query.data.head || !good.trim() || !bad.trim()}
            >
              {window.l10n.bisectStart}
            </Button>
          </form>
        )
      )}
    </div>
  );
}
export function openBisect() {
  const repo = selectedRepo.value;
  if (repo) {
    openContentDialog(window.l10n.bisectTitle, <BisectView repo={repo} />);
  }
}
export function chooseBisectCommit(kind: "good" | "bad", hash: string) {
  const repo = selectedRepo.value;
  if (!repo) {
    return;
  }
  drafts.set(repo, { ...(drafts.get(repo) ?? { good: "", bad: "HEAD" }), [kind]: hash });
  openBisect();
}
export function BisectStatus() {
  const query = useRepositoryQuery<"bisect">({ kind: "bisect" });
  if (!query.data?.state) {
    return null;
  }
  const state = query.data.state;
  return (
    <div class="flex flex-wrap items-center gap-2" role="status">
      <b>{state.firstBad ? window.l10n.bisectFound : window.l10n.bisectActive}</b>
      <code>{(state.firstBad ?? state.head).slice(0, 12)}</code>
      <Button onClick={openBisect}>{window.l10n.bisectTitle}</Button>
    </div>
  );
}
