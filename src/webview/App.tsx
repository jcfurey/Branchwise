import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import type { GitRepo } from "@/types";

import { DetailsPane } from "./components/commit/DetailsPane";
import { NavigationEffects } from "./components/history/NavigationEffects";
import { ReflogView } from "./components/history/ReflogView";
import { SearchBar } from "./components/history/SearchBar";
import { StatisticsView } from "./components/history/StatisticsView";
import { WorkspacePane } from "./components/history/WorkspacePane";
import { RefsPane } from "./components/repository/RefsPane";
import { RepositoryStatus } from "./components/repository/RepositoryStatus";
import { Announcer } from "./components/ui/Announcer";
import { ContextMenu } from "./components/ui/ContextMenu";
import { Dialog } from "./components/ui/Dialog";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { ScrollShadow } from "./components/ui/ScrollShadow";
import { GraphView } from "./layout/GraphView";
import { MainHeader } from "./layout/MainHeader";
import { type DockedPosition, detailsPosition, paneSizes } from "./lib/details-pane";
import {
  activeTab,
  historyActive,
  refsVisible,
  searchVisible,
  workspaceVisible
} from "./lib/navigation";
import { pageScrollTop, scrollPageTo } from "./lib/page-scroll";
import { expandedCommit, selectedRepo } from "./lib/stores";

/**
 * The sidebar sits beside the graph from the `md` width up. There it stays in view while the
 * graph scrolls, starting right below the header, whose height depends on how often it wraps.
 * While the details are docked it fills the height of the graph's own scroller instead.
 */
const SIDEBAR_CLASS = [
  "flex w-full shrink-0 flex-col border-r border-line-soft",
  "md:sticky md:top-[var(--main-header-height,3rem)]",
  "md:h-[var(--sidebar-height,calc(100vh_-_var(--main-header-height,3rem)))]",
  "md:w-72 md:max-w-[40vw]"
].join(" ");

/** Thickness of the splitter between the graph and docked details, in pixels: Tailwind's `1`. */
const SPLITTER = 4;

/**
 * Everything below the header while the details are docked. The graph scrolls in an element of
 * its own, above or beside the pane, and the window stays still. The header is outside that
 * scroller, so inside it the header's height counts as nothing: the table heading and the sidebar
 * stick to its top, and the sidebar is as tall as the scroller.
 */
function DockedLayout({
  position,
  open,
  children
}: {
  position: DockedPosition;
  open: boolean;
  children: ComponentChildren;
}) {
  const below = position === "bottom";
  const share = Math.round(paneSizes.value.bottom * 1000) / 10;
  const pane = open && below ? ` - ${share}vh - ${SPLITTER}px` : "";
  const dock = {
    "--sidebar-height": `calc(100vh - var(--main-header-height, 3rem)${pane})`
  } as JSX.CSSProperties;
  return (
    <div
      data-details-dock={position}
      class={`flex min-h-0 flex-1 ${below ? "flex-col" : "flex-row"}`}
      style={dock}
    >
      <div
        data-graph-scroller
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
        style={{ "--main-header-height": "0px" } as JSX.CSSProperties}
      >
        {children}
      </div>
      {open && <DetailsPane position={position} />}
    </div>
  );
}

/**
 * Keep the graph where it was when it moves between scrolling with the window and scrolling in
 * the docked layout's own element. The position is read while rendering, before the layout
 * changes and the browser moves it.
 */
function useScrollAcrossLayouts(docked: boolean) {
  const layout = useRef({ docked, top: 0 });
  if (layout.current.docked !== docked) {
    layout.current = { docked, top: pageScrollTop() };
  }
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scrollPageTo(layout.current.top);
  }, [docked]);
}

/** The page once there is a repository to show. */
export function App({ repos }: { repos: Array<GitRepo> }) {
  const refs = refsVisible.value;
  const workspace = workspaceVisible.value;
  const tab = activeTab.value;
  // An active filter keeps the search row open, since it is where the filter is shown and changed.
  // It belongs to the graph, so other views hide it.
  const search = tab === "graph" && (searchVisible.value || historyActive.value);
  const position = detailsPosition();
  useScrollAcrossLayouts(position !== "inline");

  const content = (
    <>
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
            {/* A new repository starts each view's filters afresh. */}
            {tab === "reflog" ? (
              <ReflogView key={selectedRepo.value} />
            ) : tab === "statistics" ? (
              <StatisticsView key={selectedRepo.value} />
            ) : (
              <GraphView />
            )}
          </ErrorBoundary>
        </div>
      </div>
    </>
  );

  return (
    <div
      data-branchwise
      class={position === "inline" ? "flex min-h-screen flex-col" : "flex h-screen flex-col"}
    >
      <MainHeader repos={repos} />
      {position === "inline" ? (
        content
      ) : (
        // Details belong to the graph; the other views have the whole height.
        <DockedLayout position={position} open={tab === "graph" && expandedCommit.value !== null}>
          {content}
        </DockedLayout>
      )}
      <NavigationEffects />
      <ScrollShadow />
      <ContextMenu />
      <Announcer />
      <ErrorBoundary>
        <Dialog />
      </ErrorBoundary>
    </div>
  );
}
