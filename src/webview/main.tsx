import "./styles.css";

import { render } from "preact";
import { useEffect } from "preact/hooks";

import { App } from "./App";
import { Button } from "./components/ui/Button";
import { selectRepo } from "./lib/actions";
import { initDispatcher } from "./lib/dispatcher";
import { loadRepoList, repoListError } from "./lib/load-repos";
import { rpcClient } from "./lib/rpc/rpc-client";
import { shellText } from "./lib/shell-text";
import { initializeStores, selectedRepo } from "./lib/stores";
import { repoListStore } from "./lib/stores/repo-list.store";
import { vscode } from "./lib/vscode";
import { initializeWebviewConfig } from "./lib/webview-config";
import { LoadingPage } from "./pages/LoadingPage";
import { NoRepoPage } from "./pages/NoRepoPage";

/** The layout of a message that takes the whole page because nothing else can be shown. */
const FAILURE_CLASS = "mx-auto max-w-lg space-y-4 px-6 py-16 text-ui break-words text-fg";

/** `template` with its `{0}` replaced by `message`, which is inserted as it is. */
function fill(template: string, message: string) {
  return template.replace("{0}", () => message);
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Keep a repository of the list selected, or none once the list is empty. */
function followRepoList(repos: ReturnType<typeof repoListStore.get>) {
  if (repos === undefined) {
    return;
  }
  const first = repos[0];
  if (first === undefined) {
    selectedRepo.value = undefined;
  } else if (!repos.some((repo) => repo.path === selectedRepo.peek())) {
    selectRepo(first.path);
  }
}

/** Everything after start-up: the repositories, or why there are none to show. */
function Page() {
  const repos = repoListStore.get();
  const error = repoListError.value;

  // Decide on the list as it is when the effect runs: the extension may have added and selected
  // a repository since this render, and a stale list would switch away from it.
  useEffect(() => followRepoList(repoListStore.get()), [repos]);

  if (error !== undefined) {
    return (
      <div role="alert" class={FAILURE_CLASS}>
        <p>{fill(window.l10n.unableToLoadRepositories, error)}</p>
        <Button onClick={() => void loadRepoList()}>{window.l10n.retry}</Button>
      </div>
    );
  }
  if (repos === undefined) {
    return <LoadingPage />;
  }
  if (repos.length === 0) {
    return <NoRepoPage />;
  }
  return <App repos={repos} />;
}

async function start(root: HTMLElement) {
  try {
    const { l10n, config } = await rpcClient.request("webview.initialize", null);
    window.l10n = l10n;
    initializeWebviewConfig(config);
    initializeStores(config.initialLoadCommits);
    render(<Page />, root);
    await loadRepoList();
    // The extension holds back a pending repository or pane until the page says it listens.
    vscode.postMessage({ command: "viewReady" });
  } catch (error: unknown) {
    // The strings may not have arrived, so the message comes from the page's shell.
    render(
      <div role="alert" class={FAILURE_CLASS}>
        {fill(shellText("initFailed"), messageOf(error))}
      </div>,
      root
    );
  }
}

const root = document.getElementById("app")!;
// Both listeners are in place before the first request, so no early message is missed.
rpcClient.init();
initDispatcher();
render(<LoadingPage />, root);
void start(root);
