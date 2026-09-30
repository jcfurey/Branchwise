import { shellText } from "@/webview/lib/shell-text";

type LoadingProps = {
  /** Added to the indicator's own classes, for its place in the layout. */
  class?: string;
  variant?: "inline" | "page";
};

/** Where each variant puts the graphic and how big it draws it. */
const LAYOUT = {
  inline: {
    root: "flex items-center justify-center gap-3 py-4",
    graphic: "relative flex size-8 shrink-0 items-center justify-center",
    glyph: "size-4"
  },
  page: {
    root: "text-center",
    graphic: "relative mx-auto mb-6 flex size-20 items-center justify-center",
    glyph: "size-10"
  }
};

const TEXT_CLASS = "text-ui font-medium text-fg";

/** A small graph: a trunk that bends towards one commit and a branch that rises to another. */
function Glyph({ class: size }: { class: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      class={size}
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
 * because it is shown before `window.l10n` has arrived. The page variant puts the text in a
 * heading and adds a pulsing bar under it. Neither moves for people who prefer less motion.
 */
export function Loading({ class: extra, variant = "inline" }: LoadingProps) {
  const layout = LAYOUT[variant];
  const text = shellText("loading");

  return (
    <div role="status" class={extra ? `${layout.root} ${extra}` : layout.root}>
      <div class={layout.graphic}>
        <div class="absolute inset-0 animate-spin rounded-full border-2 border-line-soft border-t-focus motion-reduce:animate-none" />
        <Glyph class={layout.glyph} />
      </div>
      {variant === "page" ? (
        <>
          <h1 class={TEXT_CLASS}>{text}</h1>
          <div aria-hidden="true" class="mx-auto mt-3 h-px w-12 overflow-hidden bg-line-soft">
            <div class="h-full w-1/2 animate-pulse bg-focus motion-reduce:animate-none" />
          </div>
        </>
      ) : (
        <span class={TEXT_CLASS}>{text}</span>
      )}
    </div>
  );
}
