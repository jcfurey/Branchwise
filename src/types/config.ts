import type { ConflictForecastScope } from "@/backend/types";

/**
 * Values of the `branchwise.dateFormat` setting. The extension passes a hand-edited value on
 * unchecked, so readers show anything they do not recognise as `"Date & Time"`.
 */
export type DateFormat = "Date & Time" | "Date Only" | "Relative";

/** Values of the `branchwise.graphStyle` setting. Readers draw curves for anything but angular. */
export type GraphStyle = "rounded" | "angular";

/**
 * The display settings the page works from. The extension builds a fresh object from the
 * `branchwise.*` settings and the display language, sends it in `webview.initialize`, and sends the
 * whole of it again in `config.changed`; the page replaces its copy rather than editing it.
 */
export type WebviewConfig = Readonly<{
  /** Centre the opened commit details in the window, rather than scroll only as far as needed. */
  autoCenterCommitDetailsView: boolean;
  /**
   * Which branches the conflict forecast tries. The page reads anything but `local` and `off` as
   * `localAndRemote`, the default.
   */
  conflictForecast: ConflictForecastScope;
  dateFormat: DateFormat;
  /** Let commits and branches be dragged onto branch labels to start an action. */
  dragAndDrop: boolean;
  /**
   * The branch palette, in the order the graph hands colours out. Entries are kept exactly as
   * written in the setting, and the list may be empty.
   */
  graphColours: readonly string[];
  graphStyle: GraphStyle;
  /** Rows asked for when a branch is first shown: a whole number from 1 to 1 000 000. */
  initialLoadCommits: number;
  /** Rows added by each "load more", with the same bounds. */
  loadMoreCommits: number;
  /** VS Code's display language (`en`, `fr`, `zh-cn`, ...), used for every `Intl` format. */
  locale: string;
  /** In filter mode, open a repository on its checked-out branch rather than on every branch. */
  showCurrentBranchByDefault: boolean;
  /** Let single keys, such as `b` for Create Branch, act on the focused commit row. */
  singleKeyShortcuts: boolean;
}>;
