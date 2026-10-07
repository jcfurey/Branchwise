import type { GitCommitNode } from "@/backend/types";
import type { BranchRelation, GraphLine } from "@/webview/graph/types";
import type { FocusDimming } from "@/webview/types";

export function commitRelations(
  commits: GitCommitNode[],
  focus: { direct: ReadonlyArray<string>; merged: ReadonlyArray<string> } | null
): BranchRelation[] {
  if (focus === null) {
    return commits.map(() => "normal");
  }
  const direct = new Set(focus.direct);
  const merged = new Set(focus.merged);
  return commits.map(({ hash }) =>
    hash === "*"
      ? "normal"
      : direct.has(hash)
        ? "direct"
        : merged.has(hash)
          ? "merged"
          : "unrelated"
  );
}

/** Colour the Git edge, not whichever commit happens to share its lane or row. */
export function lineRelation(
  line: GraphLine,
  commits: GitCommitNode[],
  relations: BranchRelation[]
): BranchRelation {
  const relation = relations[line.child] ?? "normal";
  if (relation !== "direct" || line.parent === null) {
    return relation;
  }
  return commits[line.child]?.parentHashes[0] === commits[line.parent]?.hash ? "direct" : "merged";
}

/**
 * How far history outside the emphasis fades: a focus's chosen dimming, or the lighter fade of
 * a branch preview, which keeps some of each lane's own colour so the graph still reads as it
 * did while the pointer rests on a label.
 */
export type Dimming = FocusDimming | "preview";

export function focusColour(
  colour: string | undefined,
  relation: BranchRelation,
  keepMergedBright = false,
  dimming: Dimming = "subtle"
): string {
  const base = colour ?? "var(--vscode-focusBorder)";
  const gray = "var(--vscode-descriptionForeground, #808080)";
  const muted =
    dimming === "strong"
      ? `color-mix(in srgb, ${gray} 45%, var(--vscode-editor-background))`
      : dimming === "preview"
        ? `color-mix(in srgb, ${base} 35%, ${gray})`
        : gray;
  if (relation === "unrelated") {
    return muted;
  }
  if (relation === "merged" && !keepMergedBright) {
    const share = dimming === "strong" ? 25 : dimming === "preview" ? 70 : 40;
    return `color-mix(in srgb, ${base} ${share}%, ${muted})`;
  }
  return base;
}
