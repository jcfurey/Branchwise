import { shellText } from "@/webview/lib/shell-text";

type LoadingProps = {
  /** Added to the indicator's own classes, for its place in the layout. */
  class?: string;
};

const ROOT_CLASS = "flex items-center justify-center gap-3 py-4";

/** A small graph: a trunk that bends towards one commit and a branch that rises to another. */
function Glyph() {
  return (
    <svg
      viewBox="0 0 40 40"
      class="size-4"
      fill="none"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path class="stroke-muted" d="M13 11V22Q13 29 20 29H27M13 20C13 15 27 17 27 11" />
      <circle cx="13" cy="11" r="3.5" class="fill-focus stroke-focus" />
      <circle cx="27" cy="11" r="3.5" class="fill-editor stroke-fg" />
      <circle cx="27" cy="29" r="3.5" class="fill-editor stroke-fg" />
    </svg>
  );
}

/**
 * A spinner with the word "Loading", announced politely. Its text comes from the page's shell
 * because it can be shown before `window.l10n` has arrived. It does not spin for people who
 * prefer less motion.
 */
export function Loading({ class: extra }: LoadingProps) {
  return (
    <div role="status" class={extra ? `${ROOT_CLASS} ${extra}` : ROOT_CLASS}>
      <div class="relative flex size-8 shrink-0 items-center justify-center">
        <div class="absolute inset-0 animate-spin rounded-full border-2 border-line-soft border-t-focus motion-reduce:animate-none" />
        <Glyph />
      </div>
      <span class="text-ui font-medium text-fg">{shellText("loading")}</span>
    </div>
  );
}

/**
 * The lane of each placeholder row's dot and how much of its description it fills, in percent,
 * so that the rows read as a history rather than as a list.
 */
const SKELETON_ROWS: ReadonlyArray<readonly [lane: number, width: number]> = [
  [0, 62],
  [0, 48],
  [1, 71],
  [0, 55],
  [1, 40],
  [2, 66],
  [1, 52],
  [0, 74],
  [0, 45],
  [0, 58]
];

/** One placeholder bar, with the quiet shimmer of `.skeleton-shimmer`. */
const BAR = "skeleton-shimmer h-2.5 shrink-0 rounded-sm";

/**
 * Rows of grey placeholders in the shape of the commit table, shown while a repository's graph
 * first loads. It is busy and says "Loading" to screen readers; the rows themselves are hidden
 * from them. The shimmer stops for people who prefer less motion.
 */
export function GraphSkeleton() {
  return (
    <div role="status" aria-busy="true" data-graph-skeleton class="w-full py-1">
      <span class="sr-only">{shellText("loading")}</span>
      <div aria-hidden="true">
        {SKELETON_ROWS.map(([lane, width], index) => (
          <div key={index} class="flex h-6 items-center gap-3 px-2">
            <span class="flex w-14 shrink-0">
              <span
                class="skeleton-shimmer size-2.5 rounded-full"
                style={{ marginLeft: `${lane * 16}px` }}
              />
            </span>
            <span class="flex min-w-0 flex-1">
              <span class={BAR} style={{ width: `${width}%` }} />
            </span>
            <span class={`${BAR} w-20`} />
            <span class={`${BAR} w-16`} />
            <span class={`${BAR} w-12`} />
          </div>
        ))}
      </div>
    </div>
  );
}
