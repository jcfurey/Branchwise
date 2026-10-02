import { useEffect, useState } from "preact/hooks";

import type { ReflogEntry } from "@/backend/types";
import { Button } from "@/webview/components/ui/Button";
import { Checkbox } from "@/webview/components/ui/Checkbox";
import { KebabIcon } from "@/webview/components/ui/Icons";
import { INPUT_CLASS } from "@/webview/components/ui/Input";
import { Select } from "@/webview/components/ui/Select";
import { openContextMenu, openFormDialog } from "@/webview/lib/actions";
import { checkoutCommit, resetToCommit } from "@/webview/lib/menus";
import { focusHistory } from "@/webview/lib/navigation";
import { sendRepositoryAction } from "@/webview/lib/repository-actions";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";
import { getCommitDate } from "@/webview/utils/date";

import { PageControls, QueryStatus } from "./QueryControls";

/** How long the filter waits after the last key before it asks again. */
const FILTER_DELAY = 250;

/** Text and border colours of an operation's badge, by what the operation does to history. */
const ACTION_COLOURS: Record<string, string> = {
  commit: "text-git-added border-git-added",
  reset: "text-git-deleted border-git-deleted",
  checkout: "text-focus border-focus",
  branch: "text-focus border-focus",
  clone: "text-focus border-focus",
  rebase: "text-git-modified border-git-modified",
  merge: "text-git-modified border-git-modified",
  pull: "text-git-modified border-git-modified",
  "cherry-pick": "text-git-modified border-git-modified",
  revert: "text-git-modified border-git-modified"
};

const CELL = "px-3 py-1.5 align-top";
const HEAD_CELL = "px-3 py-1.5 text-left font-semibold";

/** A ref as the graph names it: `HEAD`, a branch, or a remote branch. */
function refName(ref: string) {
  return ref.replace(/^refs\/(?:heads|remotes)\//, "");
}

/** What the entry says happened, without the operation it starts with. */
function description(entry: ReflogEntry) {
  const colon = entry.message.indexOf(": ");
  return colon < 0 ? entry.message : entry.message.slice(colon + 2);
}

function recover(entry: ReflogEntry) {
  openFormDialog({
    message: (
      <>
        {window.l10n.recoverBranch}: <code>{entry.hash.slice(0, 12)}</code>
      </>
    ),
    inputs: [
      {
        kind: "ref",
        label: window.l10n.recoveryBranchName,
        value: "recovered/" + entry.hash.slice(0, 8)
      }
    ],
    action: window.l10n.recoverBranch,
    source: null,
    onSubmit: ([name]) => sendRepositoryAction({ kind: "recoverBranch", name, hash: entry.hash })
  });
}

function Row({ entry, index }: { entry: ReflogEntry; index: number }) {
  const l10n = window.l10n;
  const date = getCommitDate(entry.date);
  const source = `reflog:${index}:${entry.selector}`;
  const operation = entry.detail === "" ? entry.action : `${entry.action} · ${entry.detail}`;
  return (
    <tr data-reflog-entry={entry.selector} class="border-b border-line-soft hover:bg-row-hover">
      <td class={`${CELL} whitespace-nowrap text-muted`} title={date.title}>
        {date.value}
      </td>
      <td class={`${CELL} max-w-40 truncate`} title={entry.ref}>
        {refName(entry.ref)}
      </td>
      <td class={CELL}>
        <span
          class={`inline-block rounded border px-1.5 text-xs whitespace-nowrap ${
            ACTION_COLOURS[entry.action] ?? "border-line text-muted"
          }`}
        >
          {operation}
        </span>
      </td>
      <td class={`${CELL} break-words`}>{description(entry)}</td>
      <td class={CELL}>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <code class="text-muted" title={entry.hash}>
            {entry.hash.slice(0, 8)}
          </code>
          <span class="min-w-0 break-words">{entry.subject}</span>
          {entry.lost && (
            <span class="rounded bg-row-selected px-1.5 text-xs" title={l10n.reflogLostHint}>
              {l10n.reflogLost}
            </span>
          )}
        </div>
      </td>
      <td class={`${CELL} whitespace-nowrap text-right`}>
        <div class="flex items-center justify-end gap-1">
          <Button onClick={() => focusHistory(entry.hash)}>{l10n.showInGraph}</Button>
          <Button
            aria-label={l10n.reflogEntryActions.replace("{0}", entry.selector)}
            title={l10n.reflogEntryActions.replace("{0}", entry.selector)}
            aria-haspopup="menu"
            onClick={(event) =>
              openContextMenu(event, source, [
                { title: l10n.recoverBranch + "…", onClick: () => recover(entry) },
                null,
                { title: l10n.checkout + "…", onClick: () => checkoutCommit(entry.hash) },
                { title: l10n.reset + "…", onClick: () => resetToCommit(entry.hash) }
              ])
            }
          >
            <KebabIcon class="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Where HEAD and the branches have been: every move the reflog recorded, with what moved, the
 * operation, and the commit it moved to. Commits that only the reflog still reaches are marked
 * and can be kept on a recovery branch.
 */
export function ReflogView() {
  const l10n = window.l10n;
  const [ref, setRef] = useState("");
  const [action, setAction] = useState("");
  const [draft, setDraft] = useState("");
  const [text, setText] = useState("");
  const [lostOnly, setLostOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setText(draft.trim());
      setOffset(0);
    }, FILTER_DELAY);
    return () => clearTimeout(timer);
  }, [draft]);

  const query = useRepositoryQuery<"reflog">({
    kind: "reflog",
    offset,
    ...(ref ? { ref } : {}),
    ...(action ? { action } : {}),
    ...(text ? { text } : {}),
    ...(lostOnly ? { lostOnly } : {})
  });
  const data = query.data;
  // The choices stay while a narrower query loads, so the pickers do not jump.
  const [choices, setChoices] = useState<{ refs: string[]; actions: string[] }>({
    refs: [],
    actions: []
  });
  useEffect(() => {
    if (data !== null) {
      setChoices({ refs: data.refs, actions: data.actions });
    }
  }, [data]);

  /** Change a filter and start again from the first page. */
  function filtered<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setOffset(0);
    };
  }

  return (
    <main data-reflog-view class="space-y-3 p-3 text-ui">
      <p class="text-muted">{l10n.reflogHint}</p>
      <div class="flex flex-wrap items-center gap-2">
        <div class="w-48">
          <Select
            aria-label={l10n.reflogRef}
            value={ref}
            onChange={filtered(setRef)}
            options={[
              { label: l10n.reflogAllRefs, value: "" },
              ...choices.refs.map((name) => ({ label: refName(name), value: name }))
            ]}
          />
        </div>
        <div class="w-44">
          <Select
            aria-label={l10n.reflogOperation}
            value={action}
            onChange={filtered(setAction)}
            options={[
              { label: l10n.reflogAllActions, value: "" },
              ...choices.actions.map((name) => ({ label: name, value: name }))
            ]}
          />
        </div>
        <input
          data-reflog-filter
          class={INPUT_CLASS + " max-w-xs flex-1"}
          aria-label={l10n.reflogFilter}
          placeholder={l10n.reflogFilter}
          value={draft}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <Checkbox
          label={l10n.reflogLostOnly}
          checked={lostOnly}
          onInput={(event) => filtered(setLostOnly)(event.currentTarget.checked)}
        />
      </div>
      <QueryStatus loading={query.loading && data === null} error={query.error} />
      {data !== null && (
        <>
          {data.entries.length === 0 ? (
            <p class="text-muted">{l10n.noReflog}</p>
          ) : (
            <div class="overflow-x-auto">
              <table class="w-full border-collapse">
                <thead class="border-b border-line">
                  <tr>
                    <th class={HEAD_CELL}>{l10n.reflogWhen}</th>
                    <th class={HEAD_CELL}>{l10n.reflogRef}</th>
                    <th class={HEAD_CELL}>{l10n.reflogOperation}</th>
                    <th class={HEAD_CELL}>{l10n.reflogDescription}</th>
                    <th class={HEAD_CELL}>{l10n.reflogCommit}</th>
                    <th class={HEAD_CELL}>
                      <span class="sr-only">{l10n.reflogActionsColumn}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry, index) => (
                    <Row key={entry.selector + index} entry={entry} index={offset + index} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <PageControls
            offset={offset}
            count={data.entries.length}
            more={data.more}
            change={setOffset}
          />
        </>
      )}
    </main>
  );
}
