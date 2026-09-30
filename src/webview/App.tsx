import type { GitRepo } from "@/types";

import { NavigationEffects } from "./components/history/NavigationEffects";
import { SearchBar } from "./components/history/SearchBar";
import { WorkspacePane } from "./components/history/WorkspacePane";
import { RefsPane } from "./components/repository/RefsPane";
import { RepositoryStatus } from "./components/repository/RepositoryStatus";
import { ContextMenu } from "./components/ui/ContextMenu";
import { Dialog } from "./components/ui/Dialog";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { ScrollShadow } from "./components/ui/ScrollShadow";
import { GraphView } from "./layout/GraphView";
import { MainHeader } from "./layout/MainHeader";
import { historyActive, refsVisible, searchVisible, workspaceVisible } from "./lib/navigation";

/**
 * The sidebar sits beside the graph from the `md` width up. There it stays in view while the
 * graph scrolls, starting right below the header, whose height depends on how often it wraps.
 */
const SIDEBAR_CLASS = [
  "flex w-full shrink-0 flex-col border-r border-line-soft",
  "md:sticky md:top-[var(--main-header-height,3rem)] md:h-[calc(100vh_-_var(--main-header-height,3rem))]",
  "md:w-72 md:max-w-[40vw]"
].join(" ");

/** The page once there is a repository to show. */
export function App({ repos }: { repos: Array<GitRepo> }) {
  const refs = refsVisible.value;
  const workspace = workspaceVisible.value;
  // An active filter keeps the search row open, since it is where the filter is shown and changed.
  const search = searchVisible.value || historyActive.value;

  return (
    <div data-branchwise class="flex min-h-screen flex-col">
      <MainHeader repos={repos} />
      {search && <SearchBar />}
      <RepositoryStatus />
      <div class="flex min-w-0 flex-1 flex-col items-start md:flex-row">
        {(refs || workspace) && (
          <div class={SIDEBAR_CLASS}>
            {refs && <RefsPane />}
            {workspace && <WorkspacePane />}
          </div>
        )}
        <div class="flex w-full min-w-0 flex-1 flex-col self-stretch">
          {/* A view that fails to render replaces only the graph; the header and panes stay. */}
          <ErrorBoundary>
            <GraphView />
          </ErrorBoundary>
        </div>
      </div>
      <NavigationEffects />
      <ScrollShadow />
      <ContextMenu />
      <ErrorBoundary>
        <Dialog />
      </ErrorBoundary>
    </div>
  );
}
