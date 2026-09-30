import { useState } from "preact/hooks";

import type { RemoteDetails, RepositoryState } from "@/backend/types";
import { Button } from "@/webview/components/ui/Button";
import { Select } from "@/webview/components/ui/Select";
import { closeDialog, openFormDialog } from "@/webview/lib/actions";
import { openRemoteAction } from "@/webview/lib/remote-actions";
import {
  confirmRepositoryAction,
  openRepositoryManager,
  requestRepositoryQuery,
  sendRepositoryAction
} from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import type { ContextMenuEntry } from "@/webview/types";
import { format } from "@/webview/utils/format";

/** The non-blank lines of a text area, trimmed, in the order typed. */
function urlLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function addRemote(repo: string): void {
  const l10n = window.l10n;
  openFormDialog({
    message: l10n.addRemote,
    inputs: [
      { kind: "ref", label: l10n.remoteName, value: "" },
      { kind: "text", label: l10n.remoteUrl, value: "" },
      { kind: "checkbox", label: l10n.fetchAfterAdding, value: true }
    ],
    action: l10n.addRemote,
    source: null,
    onSubmit: ([name, url, fetch]) =>
      sendRepositoryAction({ kind: "addRemote", name: name.trim(), url: url.trim(), fetch }, repo)
  });
}

export function editRemote(remote: RemoteDetails, repo: string): void {
  const l10n = window.l10n;
  openFormDialog({
    message: (
      <>
        {l10n.editRemote}: <b>{remote.name}</b>
      </>
    ),
    inputs: [
      { kind: "textarea", label: l10n.fetchUrls, value: remote.fetchUrls.join("\n") },
      { kind: "textarea", label: l10n.pushUrls, value: remote.pushUrls.join("\n") }
    ],
    action: l10n.save,
    source: null,
    onSubmit: ([fetchText, pushText]) =>
      sendRepositoryAction(
        {
          kind: "editRemote",
          name: remote.name,
          fetchUrls: urlLines(fetchText),
          pushUrls: urlLines(pushText)
        },
        repo
      )
  });
}

export function renameRemote(remote: RemoteDetails, repo: string): void {
  openFormDialog({
    message: window.l10n.renameRemote,
    // Unlabelled: the dialog's message names the field.
    inputs: [{ kind: "ref", value: remote.name }],
    action: window.l10n.renameRemote,
    source: null,
    onSubmit: ([newName]) => {
      // Git refuses a rename onto the same name, so keeping it is not an action.
      if (newName !== remote.name) {
        sendRepositoryAction({ kind: "renameRemote", name: remote.name, newName }, repo);
      }
    }
  });
}

export function removeRemote(remote: RemoteDetails, repo: string): void {
  confirmRepositoryAction(
    format(window.l10n.removeRemoteConfirm, <b>{remote.name}</b>),
    window.l10n.removeRemote,
    { kind: "removeRemote", name: remote.name },
    repo
  );
}

/** The actions of one remote in the refs pane. Fetch works on the selected repository. */
export function remoteMenu(remote: RemoteDetails, repo: string): Array<ContextMenuEntry> {
  const l10n = window.l10n;
  return [
    { title: `${l10n.fetch}…`, onClick: () => openRemoteAction("fetch", "", `${remote.name}/`) },
    { title: `${l10n.editRemote}…`, onClick: () => editRemote(remote, repo) },
    { title: `${l10n.renameRemote}…`, onClick: () => renameRemote(remote, repo) },
    { title: `${l10n.removeRemote}…`, onClick: () => removeRemote(remote, repo) },
    null,
    { title: l10n.manageRemotes, onClick: () => openRemotes() }
  ];
}

function RemoteEntry({ remote, repo }: { remote: RemoteDetails; repo: string }) {
  const l10n = window.l10n;
  // Pre-wrapped so one URL per line shows as a list, and selectable so a URL can be copied.
  const urls = "whitespace-pre-wrap break-all select-text";
  return (
    <div class="space-y-2 rounded border border-line p-2">
      <b>{remote.name}</b>
      {remote.fetchUrls.length > 0 && <p class={urls}>{remote.fetchUrls.join("\n")}</p>}
      {remote.pushUrls.length > 0 && (
        <p class={urls}>
          {l10n.remotePushUrls}: {remote.pushUrls.join("\n")}
        </p>
      )}
      <div class="flex flex-wrap gap-2">
        <Button onClick={() => editRemote(remote, repo)}>{l10n.editRemote}</Button>
        <Button onClick={() => renameRemote(remote, repo)}>{l10n.renameRemote}</Button>
        <Button onClick={() => removeRemote(remote, repo)}>{l10n.removeRemote}</Button>
      </div>
    </div>
  );
}

/**
 * The remotes of `state`, as loaded when the dialog opened, with the default push remote.
 * Every action replaces the dialog with its own progress, so nothing here refreshes.
 */
export function RemoteManager({ state, repo }: { state: RepositoryState; repo: string }) {
  const l10n = window.l10n;
  // A default naming a remote that no longer exists would be sent back unseen; start from Git's.
  const [initialChoice] = useState(() => {
    const configured = state.pushDefault ?? "";
    return state.remotes.some(({ name }) => name === configured) ? configured : "";
  });
  const [choice, setChoice] = useState(initialChoice);
  const options = [
    { label: l10n.defaultSetting, value: "" },
    ...state.remotes.map(({ name }) => ({ label: name, value: name }))
  ];
  const save = () => {
    if (choice === initialChoice) {
      closeDialog();
    } else {
      sendRepositoryAction({ kind: "pushDefault", remote: choice || null }, repo);
    }
  };

  return (
    <div class="space-y-3 text-left">
      {/* First, so the dialog starts on it rather than on a remote's buttons. */}
      <Button onClick={() => addRemote(repo)}>{l10n.addRemote}</Button>
      {state.remotes.map((remote) => (
        <RemoteEntry key={remote.name} remote={remote} repo={repo} />
      ))}
      <label class="block">
        {l10n.defaultPushRemote}
        <Select options={options} value={choice} onChange={setChoice} />
      </label>
      <Button onClick={save}>{l10n.save}</Button>
    </div>
  );
}

export function openRemotes(): void {
  openRepositoryManager(window.l10n.manageRemotes, (state, repo) => (
    <RemoteManager state={state} repo={repo} />
  ));
}

/** Ask which branch `branch` should track, from every remote-tracking ref and local branch. */
function chooseUpstream(state: RepositoryState, branch: string, repo: string) {
  const l10n = window.l10n;
  const upstream = state.branches.find(({ name }) => name === branch)?.upstream ?? "";
  const remoteRefs = state.remoteBranches.map(({ name }) => ({
    label: name,
    value: `refs/remotes/${name}`
  }));
  const localBranches = state.branches
    .filter(({ name }) => name !== branch)
    .map(({ name }) => ({ label: name, value: `refs/heads/${name}` }));
  // Matched by name, remote-tracking refs first, as Git shows an upstream by its short name.
  const match =
    upstream === ""
      ? undefined
      : (remoteRefs.find(({ label }) => label === upstream) ??
        localBranches.find(({ label }) => label === upstream));
  const preselected = match?.value ?? "";
  // A gone upstream matches nothing and shows as None; saving None must still remove it.
  const showsCurrent = upstream === "" || match !== undefined;

  openFormDialog({
    message: (
      <>
        {l10n.configureUpstream}: <b>{branch}</b>
      </>
    ),
    inputs: [
      {
        kind: "select",
        label: l10n.upstreamBranch,
        value: preselected,
        options: [{ label: l10n.none, value: "" }, ...remoteRefs, ...localBranches]
      }
    ],
    action: l10n.save,
    source: `ref:head:${branch}`,
    onSubmit: ([ref]) => {
      if (showsCurrent && ref === preselected) {
        return;
      }
      sendRepositoryAction({ kind: "setTracking", branch, upstream: ref || null }, repo);
    }
  });
}

/** Load the selected repository's branches, then ask for `branch`'s upstream. */
export function openTracking(branch: string): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  requestRepositoryQuery(
    { kind: "state" },
    (data) => {
      if (data.kind === "state") {
        chooseUpstream(data.state, branch, repo);
      }
    },
    repo
  );
}
