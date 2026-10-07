import type {
  ActionRequest,
  ActionResponse,
  GitFileChangeType,
  GraphQueryCommand,
  QueryRequest,
  QueryResponse
} from "@/backend/types";

// The older `{ command }` messages between the page and the extension, and the per-repository
// record the extension keeps for the page. The records are stored as JSON in workspace state and
// cross the wire, so they hold plain data only.

/**
 * How the chosen branch shapes the graph. `"filter"` loads that branch's history only; `"focus"`
 * loads everything and brings out the branch's first-parent line; `"ancestors"` loads everything
 * and keeps every ancestor of the branch bright, merged ones included.
 */
export type BranchDisplay = "filter" | "focus" | "ancestors";

/** How far history outside the emphasis is faded. */
export type FocusDimming = "subtle" | "strong";

/** The view choices remembered with a repository and restored when it is selected again. */
export type GraphPreferences = {
  branchDisplay: BranchDisplay;
  /**
   * The branch to emphasise again, spelt as in the branch list (`remotes/<remote>/<branch>` for a
   * remote one), or `"*"` when the user chose every branch. Left out in filter mode; when left out,
   * or when the branch is gone, the checked-out branch is chosen instead.
   */
  focusBranch?: string;
  /** The emphasis is switched off, but its branch is kept. */
  focusPaused: boolean;
  focusDimming: FocusDimming;
  /** Whether remote-tracking branches appear in the graph at all. */
  showRemoteBranches: boolean;
};

/** What the extension remembers about one repository. A new record is `{ columnWidths: null }`. */
export type GitRepoState = {
  /**
   * Widths in CSS pixels of the graph, date, author and commit columns, in that order, or `null`
   * while the user has not resized the table. The description column takes what is left.
   */
  columnWidths: number[] | null;
  /** Remotes whose branches the user hid, sorted and without repeats. Left out when there are none. */
  hiddenRemotes?: string[];
  /**
   * Globs naming branches to hide from the graph and the branch lists, one per entry, in the
   * order the user wrote them. Local branches are matched by name and remote-tracking ones by
   * their name after the remote. Left out until the user first sets some.
   */
  hiddenBranchPatterns?: string[];
  /** Left out until the page first saves them. */
  graphPreferences?: GraphPreferences;
  /** Local branches pinned to the top of the Branches pane, in the order pinned. */
  pinnedBranches?: string[];
  /** How the Branches pane orders local branches; by name until the user chooses. */
  branchSort?: BranchSort;
};

/** By name, or by the date of each branch's last commit, newest first. */
export type BranchSort = "name" | "recent";

/** The records of every repository, keyed by the repository's root path. */
export type GitRepoSet = { [repo: string]: GitRepoState };

/** Show `repo`: the extension answers with its `repoState` and starts watching it. */
export type RequestSelectRepo = { command: "selectRepo"; repo: string };

/**
 * Store the fields present in `state` over the record of `repo`, keeping the others. The page
 * sends one field per message. There is no answer.
 */
export type RequestSaveRepoState = {
  command: "saveRepoState";
  repo: string;
  state: Partial<GitRepoState>;
};

/**
 * Open VS Code's diff of one file between `commitHash^` and `commitHash`. Paths are relative to the
 * repository root, with `/` separators.
 */
export type RequestViewDiff = {
  command: "viewDiff";
  repo: string;
  commitHash: string;
  oldFilePath: string;
  newFilePath: string;
  type: GitFileChangeType;
};

/** Whether VS Code opened the diff that `viewDiff` asked for. */
export type ResponseViewDiff = { command: "viewDiff"; success: boolean };

/** Reload everything shown for the selected repository. */
export type ResponseRefresh = { command: "refresh" };

/** A `{ command }` message from the page to the extension. */
export type RequestMessage =
  /** Stop the running action that has this id, if it runs in `repo`. */
  | { command: "cancelAction"; repo: string; requestId: string }
  /** Stop the repository query that has this id; it then answers nothing. */
  | { command: "cancelRepositoryQuery"; repo: string; requestId: string }
  /** The page has its first repository list and listens. Read outside the legacy bridge. */
  | { command: "viewReady" }
  | ActionRequest
  | QueryRequest
  | RequestSelectRepo
  | RequestSaveRepoState
  | RequestViewDiff;

/** A `{ command }` message from the extension to the page. */
export type ResponseMessage =
  /** The stored record of `repo`. Its `hiddenRemotes` overrule the page's own. */
  | { command: "repoState"; repo: string; state: GitRepoState }
  /** A graph read failed and was not superseded; `message` is the error's text. */
  | {
      command: "graphQueryError";
      query: GraphQueryCommand;
      repo: string;
      requestId: string;
      message: string;
    }
  /**
   * Open the history of `path`, relative to `repo` with `/` separators. With `lines`, only the
   * commits that changed those lines, counted from 1 in the file at `revision` or else at HEAD.
   */
  | {
      command: "fileHistory";
      repo: string;
      path: string;
      lines?: { start: number; end: number };
      revision?: string;
    }
  | ActionResponse
  | QueryResponse
  | ResponseViewDiff
  | ResponseRefresh;
