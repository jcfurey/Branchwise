import { useState } from "preact/hooks";

import type { SplitAssignment, SplitFile, SplitHunk, SplitPlan } from "@/backend/types";
import { CHANGE_COLOUR } from "@/webview/components/commit/FileTree";
import { Consequences, Target } from "@/webview/components/repository/EditCommit";
import { Button } from "@/webview/components/ui/Button";
import { Select } from "@/webview/components/ui/Select";
import { openContentDialog } from "@/webview/lib/actions";
import { requestRepositoryQuery, sendRepositoryAction } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { format } from "@/webview/utils/format";

/** A localized template filled with text only, as one string. */
const text = (template: string, ...parts: string[]) => format(template, ...parts).join("");

/** How many files each part changes. A file split by hunk counts in every part it has a hunk in. */
export function filesPerPart(assignment: SplitAssignment, parts: number): number[] {
  const counts = Array.from({ length: parts }, () => 0);
  for (const choice of assignment) {
    for (const part of new Set([choice].flat())) {
      counts[part] = (counts[part] ?? 0) + 1;
    }
  }
  return counts;
}

/** Why the split cannot be made yet, or null once every part has a change and a message. */
export function splitProblem(messages: string[], assignment: SplitAssignment): string | null {
  const empty = filesPerPart(assignment, messages.length).indexOf(0);
  if (empty !== -1) {
    return text(window.l10n.splitEmptyPart, String(empty + 1));
  }
  const unnamed = messages.findIndex((message) => !message.trim());
  return unnamed === -1 ? null : text(window.l10n.splitNoMessage, String(unnamed + 1));
}

/** The commits the split will make, as "3 commits: Part 1 (4 files), Part 2 (1 file), …". */
export function splitSummary(counts: number[]): string {
  const l10n = window.l10n;
  const parts = counts.map((count, index) =>
    text(
      count === 1 ? l10n.splitPartOneFile : l10n.splitPartFiles,
      String(index + 1),
      String(count)
    )
  );
  return text(
    l10n.splitPreview,
    String(counts.length),
    parts.reduce((list, part) => text(l10n.splitPartsJoin, list, part))
  );
}

/** A hunk as a unified diff names it, by its lines before and after. */
function hunkName(hunk: SplitHunk) {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

type Options = Array<{ label: string; value: string }>;

/** A file of the commit with the part it goes to and, for a text file, a part for each hunk. */
function FileChoice({
  file,
  choice,
  options,
  onChoose
}: {
  file: SplitFile;
  choice: number | number[];
  options: Options;
  onChoose: (choice: number | number[]) => void;
}) {
  const l10n = window.l10n;
  const partOf = (at: number) => (Array.isArray(choice) ? choice[at]! : choice);
  const mixed = Array.isArray(choice) && choice.some((part) => part !== choice[0]);
  const name = file.status === "R" ? `${file.from} → ${file.path}` : file.path;
  return (
    <li class="py-1" data-split-file={file.path}>
      <div class="flex items-center gap-2">
        <span class={`w-3 shrink-0 font-mono text-xs ${CHANGE_COLOUR[file.status]}`}>
          {file.status}
        </span>
        <span class="min-w-0 flex-1 font-mono text-xs break-all">{name}</span>
        <span class="w-32 shrink-0">
          <Select
            aria-label={text(l10n.splitFilePart, name)}
            value={mixed ? "" : String(partOf(0))}
            // A file whose hunks go to different parts shows that, until one part takes it all.
            options={mixed ? [{ label: l10n.splitByHunk, value: "" }, ...options] : options}
            onChange={(value) => value !== "" && onChoose(Number(value))}
          />
        </span>
      </div>
      {file.hunks !== null && (
        <details class="mt-1 ml-5">
          <summary class="cursor-pointer text-xs text-muted">
            {text(l10n.splitHunks, String(file.hunks.length))}
          </summary>
          {file.hunks.map((hunk, at) => (
            <div key={at} class="mt-1 rounded border border-line-soft">
              <div class="flex items-center gap-2 px-1 pt-1">
                <code class="min-w-0 flex-1 text-xs text-muted">{hunkName(hunk)}</code>
                <span class="w-32 shrink-0">
                  <Select
                    aria-label={text(l10n.splitHunkPart, name, hunkName(hunk))}
                    value={String(partOf(at))}
                    options={options}
                    onChange={(value) =>
                      onChoose(file.hunks!.map((_, i) => (i === at ? Number(value) : partOf(i))))
                    }
                  />
                </span>
              </div>
              <pre class="overflow-x-auto px-1 pb-1 font-mono text-xs">
                {hunk.lines.map((line, index) => (
                  <div
                    key={index}
                    class={line.startsWith("+") ? "text-git-added" : "text-git-deleted"}
                  >
                    {line}
                  </div>
                ))}
                {hunk.hidden > 0 && (
                  <div class="text-muted">{text(l10n.splitMoreLines, String(hunk.hidden))}</div>
                )}
              </pre>
            </div>
          ))}
        </details>
      )}
    </li>
  );
}

export function SplitEditor({ plan, repo }: { plan: SplitPlan; repo: string }) {
  const l10n = window.l10n;
  // Part 1 keeps the original message; every part after it needs its own.
  const [messages, setMessages] = useState(() => [plan.message, ""]);
  const [assignment, setAssignment] = useState<SplitAssignment>(() => plan.files.map(() => 0));
  const problem = splitProblem(messages, assignment);
  const options = messages.map((_, part) => ({
    label: text(l10n.splitPart, String(part + 1)),
    value: String(part)
  }));
  function choose(file: number, choice: number | number[]) {
    setAssignment((current) => current.map((old, index) => (index === file ? choice : old)));
  }
  /** Drop a part. Its changes join the part before it, and the parts after it move up. */
  function remove(part: number) {
    const moved = (old: number) => (old >= part ? old - 1 : old);
    setMessages((current) => current.filter((_, index) => index !== part));
    setAssignment((current) =>
      current.map((choice) => (Array.isArray(choice) ? choice.map(moved) : moved(choice)))
    );
  }
  return (
    <form
      class="space-y-3 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null) {
          sendRepositoryAction({ kind: "splitCommit", plan, messages, assignment }, repo);
        }
      }}
    >
      <p class="break-words">{format(l10n.splitIntro, <Target plan={plan} />)}</p>
      <Consequences plan={plan} />
      <p class="text-xs text-muted">{l10n.explainSplit}</p>
      <ul class="max-h-80 overflow-auto rounded border border-line-soft px-2 py-1">
        {plan.files.map((file, index) => (
          <FileChoice
            key={`${file.from}\0${file.path}`}
            file={file}
            choice={assignment[index]!}
            options={options}
            onChoose={(choice) => choose(index, choice)}
          />
        ))}
      </ul>
      {messages.map((message, part) => (
        <div key={part} class="space-y-1" data-split-part={part + 1}>
          <div class="flex items-center gap-2">
            <b class="flex-1">{text(l10n.splitPart, String(part + 1))}</b>
            {part > 0 && messages.length > 2 && (
              <Button variant="ghost" onClick={() => remove(part)}>
                {text(l10n.removeSplitPart, String(part + 1))}
              </Button>
            )}
          </div>
          <textarea
            rows={part === 0 ? 5 : 3}
            class="w-full rounded bg-input p-2 font-mono text-input-fg outline-1 outline-line focus:outline-focus"
            aria-label={text(l10n.splitPartMessage, String(part + 1))}
            value={message}
            onInput={(event) => {
              const value = event.currentTarget.value;
              setMessages((current) => current.map((old, index) => (index === part ? value : old)));
            }}
          />
        </div>
      ))}
      <Button onClick={() => setMessages((current) => [...current, ""])}>
        {l10n.addSplitPart}
      </Button>
      <div role="status" class="space-y-1">
        <p data-split-preview>{splitSummary(filesPerPart(assignment, messages.length))}</p>
        {problem !== null && (
          <p class="text-xs text-muted" data-split-problem>
            {problem}
          </p>
        )}
      </div>
      <Button type="submit" variant="primary" disabled={problem !== null}>
        {l10n.splitCommit}
      </Button>
    </form>
  );
}

/** Load the commit's files and hunks, then ask how to split it. */
export function openSplitCommit(hash: string) {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  requestRepositoryQuery(
    { kind: "splitPlan", target: hash },
    (data) => {
      if (data.kind === "splitPlan") {
        openContentDialog(
          window.l10n.splitCommit,
          <SplitEditor plan={data.plan} repo={repo} />,
          true
        );
      }
    },
    repo
  );
}
