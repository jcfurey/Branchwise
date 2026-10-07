import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";

import type { GitCommitNode, GitRef } from "@/backend/types";
import { CommitGraph } from "@/webview/components/commit/CommitGraph";
import { MoreRefs, PushDot } from "@/webview/components/commit/CommitRow";
import { ConflictBadge, RefLabel } from "@/webview/components/commit/RefLabel";
import { HiddenBranchesStrip } from "@/webview/components/repository/HiddenBranches";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { computeGraphLayout } from "@/webview/graph/layout";
import type { BranchRelation } from "@/webview/graph/types";
import { FocusBanner } from "@/webview/layout/GraphView";
import { openContentDialog } from "@/webview/lib/actions";
import { focusDimming } from "@/webview/lib/stores";
import { rowHeight } from "@/webview/lib/webview-config";

/** A commit of the legend's small graphs; only its place in the history matters. */
function sample(hash: string, parentHashes: Array<string> = []): GitCommitNode {
  return { hash, parentHashes, author: "", email: "", date: 0, message: "", refs: [] };
}

const sampleRef = (type: GitRef["type"], name: string): GitRef => ({ type, name, hash: "" });

/** Nothing is hovered or revealed in the legend's graphs. */
const NOT_HOVERED = signal<string | null>(null);
const NONE_REVEALED: ReadonlySet<number> = new Set();
const NO_ROWS: ReadonlyMap<string, number> = new Map();

/**
 * A few rows of the real graph, drawn by the graph's own component, so that every dot looks
 * exactly as it does in the graph. `relations` dims rows as a branch focus would.
 */
function GraphSample({
  rows,
  head = null,
  relations
}: {
  rows: Array<GitCommitNode>;
  head?: string | null;
  relations?: Array<BranchRelation>;
}) {
  const layout = computeGraphLayout(rows, head);
  return (
    <CommitGraph
      layout={layout}
      expansion={null}
      relations={relations ?? layout.vertices.map(() => "normal")}
      relationForLine={(line) => relations?.[line.child] ?? "normal"}
      keepMergedBright={false}
      dimming={focusDimming.value}
      revealed={NONE_REVEALED}
      hovered={NOT_HOVERED}
      commitRows={NO_ROWS}
      rowHeight={rowHeight()}
    />
  );
}

/**
 * Whether the graph draws a merge in a shape of its own. The layout marks merges only where the
 * graph has that shape; without it a merge looks like any commit, and the legend leaves it out.
 */
function mergesHaveAShape() {
  const [vertex] = computeGraphLayout([sample("m", ["a", "b"])], null).vertices;
  return (vertex as { isMerge?: boolean } | undefined)?.isMerge === true;
}

type Entry = {
  key: string;
  term: string;
  description: string;
  symbol: ComponentChildren;
  /** A strip as wide as the graph, drawn above its words rather than beside them. */
  wide?: boolean;
};

function entries(): Array<Entry> {
  const l10n = window.l10n;
  const branch = sampleRef("head", l10n.legendSampleBranch);
  const remote = sampleRef("remote", `origin/${l10n.legendSampleBranch}`);
  const tag = sampleRef("tag", "v1.0");
  const list: Array<Entry | false> = [
    {
      key: "commit",
      term: l10n.legendCommit,
      description: l10n.legendCommitHint,
      symbol: <GraphSample rows={[sample("c")]} />
    },
    {
      key: "head",
      term: l10n.legendHead,
      description: l10n.legendHeadHint,
      symbol: <GraphSample rows={[sample("h")]} head="h" />
    },
    mergesHaveAShape() && {
      key: "merge",
      term: l10n.legendMerge,
      description: l10n.legendMergeHint,
      symbol: <GraphSample rows={[sample("m", ["a", "b"])]} />
    },
    {
      key: "uncommitted",
      term: l10n.legendUncommitted,
      description: l10n.legendUncommittedHint,
      symbol: <GraphSample rows={[sample(UNCOMMITTED_CHANGES, ["h"])]} head="h" />
    },
    {
      key: "unpushed",
      term: l10n.legendUnpushed,
      description: l10n.commitUnpushed,
      symbol: <PushDot state="unpushed" />
    },
    {
      key: "unpulled",
      term: l10n.legendUnpulled,
      description: l10n.commitUnpulled,
      symbol: <PushDot state="unpulled" />
    },
    {
      key: "conflict",
      term: l10n.legendConflict,
      description: l10n.legendConflictHint,
      symbol: (
        <ConflictBadge
          entry={{
            branch: branch.name,
            remote: false,
            files: ["README.md", "src/app.ts"],
            committer: "",
            date: 0
          }}
        />
      )
    },
    {
      key: "branch",
      term: l10n.legendBranch,
      description: l10n.legendBranchHint,
      symbol: <RefLabel gitRef={branch} active={false} remotes={[remote]} />
    },
    {
      key: "remote",
      term: l10n.legendRemote,
      description: l10n.legendRemoteHint,
      symbol: <RefLabel gitRef={remote} active={false} />
    },
    {
      key: "tag",
      term: l10n.legendTag,
      description: l10n.legendTagHint,
      symbol: <RefLabel gitRef={tag} active={false} />
    },
    {
      key: "more",
      term: l10n.legendMore,
      description: l10n.legendMoreHint,
      symbol: (
        <MoreRefs
          hidden={[
            { ref: sampleRef("tag", "v1.1"), remotes: [] },
            { ref: sampleRef("tag", "v1.2"), remotes: [] }
          ]}
          headBranch={null}
        />
      )
    },
    {
      key: "dimmed",
      term: l10n.legendDimmed,
      description: l10n.legendDimmedHint,
      symbol: (
        <GraphSample rows={[sample("d", ["u"]), sample("u")]} relations={["direct", "unrelated"]} />
      )
    },
    {
      key: "focus",
      term: l10n.legendFocus,
      description: l10n.legendFocusHint,
      symbol: <FocusBanner target={branch.name} loading={false} failed={false} />,
      wide: true
    },
    {
      key: "hidden",
      term: l10n.legendHidden,
      description: l10n.legendHiddenHint,
      symbol: <HiddenBranchesStrip count={3} />,
      wide: true
    }
  ];
  return list.filter((entry): entry is Entry => entry !== false);
}

/**
 * Every symbol the graph uses, each drawn by the component the graph draws it with and named
 * beside it. The samples are inert: they cannot be focused or clicked, so their menus and
 * buttons act on nothing, and screen readers read the words instead.
 */
export function Legend() {
  return (
    <ul data-legend class="grid list-none gap-3 text-left text-ui">
      {entries().map(({ key, term, description, symbol, wide }) => (
        <li
          key={key}
          data-legend-entry={key}
          class={wide ? "grid gap-1" : "grid grid-cols-[6rem_1fr] items-center gap-x-4"}
        >
          <div inert class={wide ? "overflow-hidden rounded border border-line-soft" : "flex"}>
            {symbol}
          </div>
          <div>
            <p class="font-semibold">{term}</p>
            <p class="text-muted">{description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function openLegend(): void {
  openContentDialog(window.l10n.legend, <Legend />, true);
}
