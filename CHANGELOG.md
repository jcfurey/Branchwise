# Changelog

Branchwise was named (neo) Git Graph, `jcfurey.neo-git-graph`, through its 0.9.6 builds. Releases
0.6.0 and earlier are from [asispts/neo-git-graph](https://github.com/asispts/neo-git-graph);
see [its changelog](https://github.com/asispts/neo-git-graph/blob/v0.6.0/CHANGELOG.md) for them.
Branchwise's history up to 0.9.7, including how it replaced the code it inherited, is in
[jcfurey/neo-git-graph](https://github.com/jcfurey/neo-git-graph).

## [Unreleased]

### Added

- A **Legend** in **Settings & Tools** that explains every symbol of the graph, each drawn by the graph's own components: dots and rings, push marks, the conflict mark, labels, dimmed history and the strips above the graph. See [getting started](docs/git-actions.md#getting-started).
- **Clone Repository…** and **Open Folder…** beside **Initialize Repository** when the workspace has no Git repository.
- Buttons that widen a search that found nothing: **Search all branches**, **Clear filters (N)**, **Turn off regular expressions** and **Search changes instead**, each shown when it applies. See [search](docs/git-actions.md#search-file-history-and-comparison).
- Forecast conflicts with teammates' work: remote branches with commits in the last 30 days that would not merge cleanly into the checked-out branch get the same red mark as local ones, in the graph and the Branches pane, and the tooltip says whose last commit it is and when. A line above the graph counts them and opens a list that focuses the chosen branch. The checked-out branch's upstream, `<remote>/HEAD` and hidden remotes and branches are left out. The new `branchwise.conflictForecast` setting chooses `localAndRemote` (the default), `local` or `off`. See [teammates' branches](docs/git-actions.md#teammates-branches).
- Pin local branches to the top of the Branches pane, and list local branches by their latest commit instead of by name. Both choices are remembered per repository.
- Flag local branches in the Branches pane that are already merged into the checked-out branch, whose upstream is gone, that have had no commits for 90 days, or that would conflict if merged. Ahead and behind counts turn amber when a branch has diverged from its upstream.
- Fast-forward every local branch that is only behind its upstream in one step, from **Settings & Tools → Fast-forward Branches**, without checking any of them out. The review lists the branches that stay and why: diverged, checked out in another worktree, or checked out here with uncommitted changes.
- **Go to Branch, Tag or Commit…** (Ctrl+Alt+G, or Cmd+Alt+G on macOS, while the graph has focus; also in the Command Palette and **Settings & Tools**) picks a local branch, remote branch, tag or typed commit ID and selects its commit in the graph, opening the history at a commit the graph has not loaded. See [search](docs/git-actions.md#search-file-history-and-comparison).
- **Open Commit on GitHub** or **GitLab** in the commit menu, **Open Tag on …** in the tag menu, and **Open Branch on …** for a local branch whose upstream is on one of those hosts, including self-hosted GitLab. See [commit details](docs/git-actions.md#commit-details).
- Search inside changes: **Text added or removed** under **Filters**, or `changes:` (alias `diff:`) in the search box, finds the commits that add or remove a string (`git log -S`), or with **Regular expressions** the commits that add or remove matching lines (`git log -G`). It combines with the other fields, such as `path:`, and pages through the matches 100 at a time. See [search](docs/git-actions.md#search-file-history-and-comparison).
- Forecast merge conflicts: a local branch that would not merge cleanly into the checked-out branch shows a red mark with the number of conflicted files on its label, and its tooltip names them. Git tries each merge in memory with `git merge-tree`, leaving the work tree, the index and the refs untouched; it needs Git 2.38 or later. See [conflict forecast](docs/git-actions.md#conflict-forecast).
- Squash selected commits: with consecutive commits of the current branch selected in the graph, **Squash N Commits…** in the selection bar opens the interactive rebase editor with the oldest commit as Pick and the rest as Squash, ready to review before starting. When the selection cannot be squashed, such as commits from another branch, a gap, a merge or the repository's first commit, the button is disabled and its tooltip says why. See [rebasing](docs/git-actions.md#rebasing).
- Edit a commit of the checked-out branch in place. **Edit Message…**, in the commit menu and the commit details, rewrites one commit's message: `HEAD` is amended with only the message, and an older commit is reworded by an interactive rebase that keeps every commit's files. **Add Staged Changes to This Commit…** commits the staged changes as a `fixup!` commit and folds it in with an autosquash rebase straight away, after a confirmation that lists the staged files and the later commits it rewrites. Both warn when the commit is already on a remote, and refuse merges in the way, the first commit (unless it is `HEAD`) and a branch that moved after the dialog opened. See [editing one commit in place](docs/git-actions.md#editing-one-commit-in-place).
- Absorb staged changes into the commits they fix: **Absorb Staged Changes…**, beside the staged files in the uncommitted changes' details, gives each staged hunk to the unpushed commit of the branch that last changed its lines and commits one `fixup!` commit per commit, leaving unstaged changes alone. A preview first lists which hunks go where and which stay staged and why; **Create and Squash Now** then opens the interactive rebase editor with the fixups arranged. See [absorbing staged changes](docs/git-actions.md#absorbing-staged-changes-into-the-commits-they-fix).
- Hide branches by name pattern, such as `dependabot/*` or `renovate/*`: **Settings & Tools → Hidden Branches…**, or **Hide Branches Like This…** on a branch's menu, takes one glob per line and previews how many branches each one hides. Matching local and remote branches leave the graph, the branch picker and history searches, along with commits only they reach; they stay listed but dimmed in the Branches pane, and a line above the graph counts them, with a way to show them all again. The checked-out branch and the selected branch always stay shown. Patterns are saved per repository. See [hiding branches by name](docs/git-actions.md#hiding-branches-by-name).
- See what needs attention across the workspace: the Workspace pane totals the repositories that are conflicted or mid-operation, behind, unpushed or changed, and each total filters the tree. Rows show badges for an operation in progress, conflicted files, an unpublished branch, other branches ahead, stashes and a fetch older than a day, and **Needs attention first** sorts the most urgent repositories to the top. **Fetch All**, **Pull All** (fast-forward only) and **Push All** (branches with an upstream only) list what each repository will do, and skip with a reason anything unsafe, before they run. See [workspace status](docs/git-actions.md#workspace-status).

### Changed

- Show screenshots of the graph, branch focus and the Statistics tab in the README, and add search keywords such as `git log`, `git history`, `reflog` and `visualization`. `pnpm run screenshots` regenerates the images from a demo repository (see [testing](docs/testing.md)).
- Show grey placeholder rows, with a quiet shimmer that stops for reduced motion, instead of a spinner while a repository's graph first loads.

## [0.9.10] - 2026-10-03

### Changed

- Fit the header into one row: lighter view tabs; the repository, branch and view pickers as compact icon menus; and Search, Jump to HEAD, Refresh, Fetch, Compare, the Branches and Workspace panes and Settings & Tools as icon buttons with tooltips.
- Slim the branch status line, the branch focus bar and the actions hint to one short line each. The hint closes with a × button.
- Show a remote branch named like a local branch on the same commit, such as `origin/main` beside `main`, as a cloud at the end of the local branch's label; a remote's `HEAD`, such as `origin/HEAD`, joins a branch label the same way. Right-click the cloud for the remote branch's actions. A row with more than two labels shows the first one and a **+N** button that lists the rest and opens each one's menu.
- Show each author's initials beside their name in the graph.
- Shorten the README, and record where Branchwise came from, the license at each stage, and the third-party code it bundles in a new [provenance](docs/provenance.md) document.
- Redraw the icon as an open Git graph: a blue trunk with three commits, and an orange and a pink branch merged back into it for the bowls of the B, in the graph's own default lane colours and without a background tile. The graph's tab icon and the Source Control button use the same B, and the marketplace banner is now a neutral dark grey.

### Fixed

- Ship the license and copyright notices of the open-source packages bundled into the extension, such as simple-git and Preact, in `THIRD-PARTY-NOTICES.txt`. The file is generated from what the build bundles, and CI fails when it is out of date.

## [0.9.9] - 2026-10-02

### Added

- Search by committer, and by branch or tag name, which lists the commits those branches or tags point to. Type fields straight into the search box, such as `tag:v1.2` or `author:"Ann Lee"`, or tick **Regular expressions** to match patterns. Branches and tags whose names contain the search text are listed above the results.
- **Graph** and **Reflog** tabs in the header. The reflog becomes a full view of every move of HEAD and the local branches, filtered by ref, operation or text, with each operation coloured, commits that no branch reaches marked and listed on their own, and **Show in Graph**, **Create Recovery Branch**, **Check Out** and **Reset** on each entry. **Recover lost commits (reflog)** opens the tab.
- A **Statistics** tab: commits, contributors and active days for every branch or one local branch over the last 30 days, 90 days, year or all time, a grid of commits per day over the last year, and each contributor's commits, share and first and last commit, merged through `.mailmap`. **Count lines changed** adds lines added and deleted outside merges. Clicking a contributor searches the graph for their commits.
- Find repositories cloned inside other repositories, not only submodules, up to `nestedRepoSearchDepth` folders deep (3 by default; 0 turns it off). The Workspace pane becomes a tree that lists submodules and nested repositories under the repository holding them, by their path inside it, and each repository with others under it can be collapsed.
- Mark commits that no remote has yet with a dot, and commits on a tracked remote branch that are not pulled yet with a ring.
- Show commit messages with inline and fenced code, bold, italics and links, and link issue and merge request references such as `#12`, `GH-12`, `owner/repo#12` and `!12` to the repository's GitHub or GitLab remote.
- **Copy Short ID** and **Copy Full ID** buttons in the commit details, and **Copy Short Commit ID** in the commit menu.
- A **Jump to HEAD** button next to search, highlighted while the checked-out commit is out of sight. Down Arrow in the search box moves into the results.

### Fixed

- Wait for all of Git's output before reading it. On a busy machine, a large output such as a long log or ref list could be cut short without an error, because a Git process counted as finished 50 ms after it exited.

## [0.9.8] - 2026-10-01

### Changed

- Replace the icon with a B drawn as a Git graph: a trunk with three commits, and a branch merged back into it for each bowl. The graph's tab icon and the Source Control button use the same B.
- Rewrite the README around installing from Open VSX, with the features grouped by task, and move building from source to a new contributing guide.
- Publish releases to Open VSX through trusted publishing, so no Open VSX token needs to be stored, and to the VS Marketplace only when its token is configured. The packaging guide now walks through a release and the one-time setup.

## [0.9.7] - 2026-09-26

### Added

- A lint rule that reports hard-coded text in the webview.
- Tests that submit each classic action dialog and check the request, the action dispatch table, and the repository lock, with CI keeping `menus.tsx` function coverage at 80% or more.
- Rewritten tests for the Git queries and actions, repository discovery, the extension host, the menus and the webview utilities, so that each test can fail when the behaviour it names breaks. New checks include tags created on commits other than HEAD, branches that are never force-updated, and the walkthrough and guide the extension opens.

### Changed

- Rename the extension to Branchwise, `jcfurey.branchwise`: its commands and settings move from the `neo-git-graph.` prefix to `branchwise.`, settings saved under the old names are copied the first time Branchwise starts in each workspace, and the manifest no longer names the upstream author or sponsor.
- Replace the icons inherited from Git Graph with Branchwise's own: the Marketplace icon, the graph tab icons, and the Source Control button.
- Redraw the icons and illustrations inside the graph view, with the branch and tag glyphs in the same square as the others.
- Add a Getting Started step on branch focus and remote visibility, describe per-remote eye buttons and the clickable Uncommitted Changes row in the walkthroughs, and ship only the user guide, whose links now all resolve.
- Name the fork's maintainer in CODEOWNERS and override development dependencies with high-severity advisories (js-yaml, vite, serialize-javascript) and a moderate one (qs).
- Publish from a protected `release` environment after checking both registry tokens, pin third-party actions to commit SHAs, update the artifact actions, and allow a manual dry run of the release workflow.
- Remove the unused avatar code, its storage, and the Clear Avatar Cache command; activation deletes the old avatar cache once, and the deprecated `fetchAvatars` setting has no effect.
- Reword the graph's buttons, menus, dialogs, error titles, tooltips and settings descriptions, with new Simplified and Traditional Chinese translations. Confirmations name their action instead of asking whether you are sure, and their buttons repeat the action instead of saying Yes. Error titles use sentence case, the pickers say **Repository**, the commit columns are **Message** and **ID**, **Load More Commits** is **Load Older Commits**, the reset options say exactly what each mode keeps, and the uncommitted changes row counts files in the singular for one file. The translation check also covers the settings translations, and it reports empty or malformed entries instead of passing or crashing.
- Rewrite the build, test, lint, editor and CI configuration and the extension manifest. The watch build reports one start and one finish per round, including after an error without a location, shows esbuild's warnings, and a production build ships no source maps. The lint configuration keeps the project's conventions in one file, the translation check also compares the manifest's `%key%` references with `package.nls.json`, the manifest no longer lists the upstream authors, and the Nix development shell is gone.
- Release Branchwise under the Apache License 2.0 now that it has replaced everything it inherited; earlier versions remain available under the MIT License. The changelog links to asispts/neo-git-graph's for releases 0.6.0 and earlier instead of repeating them, the README's header, headings, and remaining feature and setting descriptions are rewritten, and bug reports and feature requests use issue forms that also ask for the Git version and any remote connection.

### Fixed

- Keep Git operation locks and watcher mutes when the graph is closed and reopened while an action is still running.
- Stage only the selected conflicted file when its name contains Git pathspec patterns such as `[ab].txt`.
- Read every Git log in UTF-8 regardless of the user's output encoding, preserving names and messages in the graph, history, and interactive rebase.
- Update vulnerable development dependencies and allow Marketplace publishing without Open VSX credentials.
- Keep a repository's saved settings when its folder is only unreachable for now, such as on an offline drive; only a folder that no longer exists loses them. A failure while handling a message from the graph or saving settings is logged instead of going unhandled, a repository path with a trailing slash no longer escapes the lock that keeps two Git actions from running at once, and a file-watcher hiccup no longer fails the graph.
- A file version or diff that fails to load is tried again the next time it is opened, instead of staying empty until it is closed; opening the same one twice at once runs Git once, a version Git cannot find is empty instead of showing the latest commit when a file in the working tree matches its name, and the focus badge's tooltip shows a branch name containing `$` as written.
- Configure Upstream selects the current upstream by name and sends nothing when it is unchanged, so an upstream named like the "None" choice is no longer removed. Save in Remotes sends nothing when the default push remote is unchanged, and no longer sends one that names a missing remote; renaming a remote to its own name sends nothing; Add Remote trims the name and URL; and a rebase confirmation starts on Cancel.
- Show branch names, revisions and error messages that contain `$` as written in the focus and history banners and the start-up errors, show "History at" in full for anything but a full commit ID, offer Retry after a failed history search, keep the current search when File History is given an empty path, and disable the View picker while a repository has no branches. The search button reports whether the search row is open, and Settings & Tools whether its menu is open.
- With auto-centring off, opening a commit's details keeps its row below the sticky headers, and Escape on that row closes them. E-mail links keep the `@`, an empty e-mail shows no `<>`, row labels follow Strong dimming like the graph, the row whose menu is open is drawn in full colour, double-clicking the checked-out branch runs no checkout, and worktree paths containing `$` show as written. Rows re-render only when their own menu opens, and the graph's lines are rebuilt only when they can change.
- A failed copy says why, instead of "Unable to Copy Copy Error Details to Clipboard". A finished action reloads the graph only while the repository shown when it started is still shown, commit details no longer stay loading after a commit-ID mismatch, the newest repository scan alone decides the list and its error, and a message named like a built-in property is reported as unknown instead of throwing.
- Checkbox labels wrap long repository paths and branch names instead of overflowing, focus returns to Initialize Repository once it finishes and its error shows the reason as written, and the graph's scrollbar thumb shows VS Code's pressed colour.
- Catch branch, tag and remote names that Git refuses before asking it: names with control characters, names starting with a dot, names with a part ending in `.lock`, and `HEAD`.
- Checkout Branch only switches to an existing local branch, and checking out, resetting to, cherry-picking or reverting a commit only accepts a commit ID, so none of them can restore a file and discard its uncommitted changes, create a branch, or read the value as a Git option. A reset only takes soft, mixed or hard, a merge that was already in progress reports Git's own error instead of "stopped on conflicts", and a tag cannot be named `HEAD`.
- Refresh the graph at least every two seconds while files keep changing, as during a build, instead of waiting until they stop; count changes to project lock files such as `yarn.lock` and to a shallow clone's depth, and watch a bare repository once.
- Open the graph when `branchwise.graphColours` holds something other than a list, using the default colours; cap whole-number settings at 1,000,000; keep a file history that was asked for while the graph was still opening; and list a repository reached through a symbolic link once in the repository search.
- Draw and lay out long histories much faster: a graph of 50,000 commits takes milliseconds instead of seconds, and one with thousands of branches no longer slows down out of proportion. The line from Uncommitted Changes to the checked-out commit stays grey all the way down.
- Open a file's diff once on a double-click in the commit details, show renamed paths in full in their tooltip even when they contain `$`, render folders nested thousands deep, toggle folders in a large commit quickly, and mark binary files as unavailable to assistive technology.
- Close an open context menu when the repository changes, and do nothing when showing or hiding a remote that is already in that state, when loading more commits with no branch selected, or when opening commit details with no repository.
- Offer only what applies on a remote's default-branch label, such as `origin/HEAD`: no Checkout, Delete Remote Branch or Focus entry, and double-clicking it does nothing. Renaming a branch to its own name sends nothing.
- Keep context menus inside the window near any edge, close them with Tab, and make ArrowUp from nothing go to the last item. Space never scrolls the page behind an open menu, a menu opened again starts without a highlight, and no divider appears at a menu's edge or twice in a row.
- A dropdown disabled while open, such as the branch list during a refresh, stays closed when it is enabled again. Its panel is placed again whenever its options change, arrow keys on its button no longer close it, closing it with its button keeps focus there, pointing at an option no longer scrolls the list, and its filter is named after the dropdown.
- Start a running operation's dialog on Hide and an error on Dismiss, so a quick Enter no longer stops Git or copies the error. A dialog skips a disabled first button when it opens, leaves an Escape that a control inside it used alone, shows no empty reason, keeps Tab within all of its controls, and stops its spinner when reduced motion is preferred.
- Load the graph when a commit has an unusual author line or a date Git leaves empty, showing that date as unknown, and open repositories without a work tree without the uncommitted-changes row.
- Show a merge's changes against its first parent in the commit details, even when there are none, instead of another parent's changes; list files whose type changed, such as a file that became a symbolic link; and read names and messages as UTF-8 whatever `i18n.logOutputEncoding` says.
- Sort the files and folders of the commit details in the display language, with numbers in numeric order, and ignore empty path segments.
- Resize table columns more predictably: a click on a column divider no longer fixes every width, only the primary button drags, a drag ends when the button is released outside the view, a drag never moves a divider the opposite way, and a repository change during a drag saves nothing to either repository.
- A request from the graph to the extension fails at once, instead of after 30 seconds, when its response is malformed or cannot be delivered.
- Relative commit dates move up a unit instead of reading "60 minutes ago" or "24 hours ago", round the same way for dates in the past and the future, and read "0 seconds ago" for a commit a moment ahead of the clock. The date column's tooltip keeps its date and time in the same time zone after the system's zone changes.
- Show the remaining webview text in VS Code's display language: the loading and startup messages, repository-load failures, timeouts, reflog dates, and elapsed times, and mark the page with that language.
- Keep keyboard focus on an entry moved in the interactive rebase and batch editors and announce its new position, keep the sync preview and its focus through background refreshes, and name Branches pane buttons with their full ref.
- Keep dropdown lists inside the window at any width, opening upwards when there is more room above, and keep the Branches and Workspace sidebar below the header when the header wraps.
- Keep the uncommitted-changes list, its focus, and its scroll position on screen while it refreshes, follow a staged file to its new group, and show large groups 200 files at a time.
- Apply changed settings to an open graph instead of on its next start, and read fractional or negative commit counts and search depths as whole numbers within range.
- Open menus activated with Enter, Space, or the context-menu key next to their button instead of in the window's top-left corner.
- Refresh the restore dialog when the file changed after its preview, instead of failing on every click with "Preview the restore again".
- Label an untracked nested repository in the uncommitted-changes list and explain it, with Open Its Graph, instead of failing when it is clicked.
- Rename or remove a remote with many branches in a moment instead of seconds, and prepare interactive rebases and batch cherry-picks or reverts with one Git process instead of one or two per commit.
- Keep the Branches pane and branch dropdown responsive with thousands of refs: menus no longer re-render every row, and long lists show 200 at a time with **Show more** or keyboard paging.
- Keep contents that a file restore replaces as a Git object and offer **Undo Restore**, and refuse to restore a file with unsaved editor changes, which saving later would silently undo.
- Keep failures of hidden or superseded Git operations visible in the header until Git Activity is opened, and keep a dialog opened by a double-click from closing on the second click.
- Open conflicted files in repositories that VS Code's Git extension does not track, open one-sided conflicts as files, and explain conflicts where both sides deleted the file.
- Open file diffs and restore previews while another view or Git action is running, instead of reporting that another operation is running.
- Show commits whose dates are out of range, such as `@99999999999999`, with an unknown date instead of an empty graph, and keep a failing graph or dialog from blanking the whole view.
- Name the Reset mode and merge parent choices for screen readers.
- Offer **Stop Git** while a push, pull, fetch, or other network action runs, so an unresponsive server no longer leaves the repository locked, and never let Git wait for a password typed in a terminal.
- Load the graph on Windows when a hidden remote has hundreds of branches, which exceeded the command-line limit.
- Refresh the graph after commits and other changes in linked worktrees and submodules, whose Git data lives outside their folder, and when a merge, cherry-pick, revert, rebase, or bisect starts or stops.
- List a repository once under its real path when a workspace folder is a subfolder of it or a symlink to it, and match Source Control and File History selections to that entry.
- Show the same repositories in the picker and the Workspace pane, follow added or removed workspace folders, respect the search depth for newly created repositories, and stop listing every repository ever viewed.
- Load the whole graph when a commit subject or author name contains a carriage return, and show an error instead of a silently truncated graph if Git's log output is incomplete.
- Reject invalid branch, tag, and remote names such as `a..b`, `x@{1}`, or `has space` before running Git; the previous check never saw Git's refusal.
- Activate and register every command even when the last viewed repository was deleted, a workspace folder is missing, or no folder is open, and skip folders of virtual workspaces instead of failing; virtual and untrusted workspaces are declared unsupported.
- Recognize repositories by Git's output and exit status instead of English or German "not a repository" text, so scanning behaves the same in every language.
- Accept a `git.path` that contains spaces or parentheses, such as `C:\Program Files\Git\bin\git.exe`, or lists several paths, and prefer the Git that VS Code's own Git extension found.
- Stop background reads from rewriting or locking the index while you commit, and keep refreshing the graph after reads; only actions that change a repository pause its file watcher.
- Detect merge conflicts from Git's exit status instead of its English output, so a conflicted merge in another language is no longer reported as successful, and explain how to continue or abort it.
- Ignore `log.showSignature`, forced color, and hidden untracked files in the user's Git configuration when reading Git output, so signed commits no longer end the graph or break details, history, and plans, and removing a worktree no longer discards untracked files that `status.showUntrackedFiles=no` hid.
- List branches without parsing `git branch`, so a rebase, bisect, or detached HEAD no longer adds phantom branches such as `(no`, and colored or translated Git output no longer breaks checkout or remote renames.
- Show exact names and line counts in commit details for files with non-ASCII characters, tabs, quotes, newlines, or backslashes, so their diffs, history, and restore work, and diff a file named like `0:foo` against its own staged version.
- Explain instead of deleting when a remote branch's remote is no longer configured; previously the name was cut by another remote's length. Checking out such a branch suggests its own path and creates an untracked local branch.
- Ignore a held Enter or Space key in dialogs and menus, and open destructive confirmations with focus on Cancel, so holding Enter on a menu item can no longer delete a branch, tag, or stash.
- Warn before restoring over local edits that `git status` hides, such as skip-worktree and assume-unchanged files, or a file whose on-disk name differs only in letter case or Unicode form.
- Refuse to restore a file into a submodule or nested repository, where the superproject cannot see or warn about local edits.
- Pass existing branch and tag names to Git so that names such as `-d` or `--output=x`, which fetches can create, are never read as options, and filter or merge a branch rather than a tag with the same name.
- Open `neo-git-graph:` documents only for full object IDs in repositories the extension has opened, so links and other extensions cannot pass options such as `--output` to `git show`.
- Disable the restore preview and restore buttons while a Git operation in that repository is still running, such as the preview's own diff still opening.

## [0.9.6] - 2026-09-23

### Added

- Click the Uncommitted Changes row to browse staged, unstaged, untracked, and conflicted files and open their native diff or merge editor.
- Failure-time UI screenshots, DOM snapshots, browser errors, and extension logs, with an automated failure/recovery check and a minimum-version VS Code smoke test in CI.
- Repeatable backend focus and VS Code interaction benchmarks for large histories, with timing reports and hover CPU profiles in Linux CI.
- Graph topology and rendering regression coverage for complex merges, partial history, both graph styles, zoom, resizing, and expanded details.
- Keyboard and contrast checks for graph focus and remote visibility in built-in light, dark, and high-contrast themes.
- Per-remote graph visibility controls with saved choices, consistent history searches, and automatic reveal when selecting a hidden remote branch.
- Horizontal scrolling within the Graph column for wide histories, using a scrollbar, trackpad or Shift+mouse wheel.
- Sticky column headings keep graph scrolling accessible deep in history; selecting a commit reveals its lane, with a **Reveal selected lane** button to return after panning.
- Selectable branch focus with full-colour direct history, muted merged history and gray unrelated commits, plus an option to keep all ancestors bright.
- Focus branches from their context menus, identify the target with a Focus badge, choose subtle or strong graph dimming, and pause/resume focus without losing the target.
- Submodule commit comparisons and parent pointer staging/unstaging.
- Workspace fetch with individual results and reviewed fast-forward updates.
- Push/pull commit previews, selected merged-branch cleanup, and guided Git bisect.
- Portable workflow UI checks, three-platform CI, and a large-history benchmark.
- Branches pane beside the graph listing local branches, remotes, tags and stashes with inline actions and a toggle that hides remote branches.
- Settings cog in the header that gathers the repository tools and opens the extension's settings.
- Getting Started walkthrough, a Learn more entry that opens the shipped guide, a first-use hint above the graph, and a menu button on every commit row.

### Changed

- Save focus mode, target, dimming, pause state, and Show Remote Branches per repository across graph reopening and VS Code restarts; document temporary search and scrolling state.
- Make fork VSIX packaging repeatable with `pnpm run package:vsix`, and verify upgrades and activation in an isolated VS Code profile.
- Gate tag publishing on matching fork identity/version and the full validation workflow; publish the same VSIX that passed package checks.
- Refresh fork installation instructions, shipped features, and remaining work in the README.
- Cancel superseded repository queries, restore focus after dialogs, and adapt controls to narrow windows.
- Localize the backend's error messages through `@vscode/l10n`, with Simplified and Traditional Chinese translations.
- Reuse the workspace repository scan between refreshes until a repository appears or vanishes.
- Remove the unused pre-RPC activation path and its duplicate configuration module.
- Share one field style between dialogs and pages, and replace the header's text glyphs with icons.
- Open the search row on demand from the header or with `/`, give advanced menu items plain-language names, and explain how to undo in the reset, checkout, delete, drop, rebase and force-push dialogs.

### Fixed

- Make uncommitted changes keyboard accessible, restore focus when closing details, count individual untracked files, and remove placeholder commit metadata from the changes row.
- Resolve staged diff contents to immutable blobs so reopening a file after staging shows the current changes.
- Avoid scanning all loaded commits for every row's keyboard tab stop; keep graph hover updates from rerendering text rows and reuse unchanged graph line paths.
- Keep explicitly cleared focus cleared after reopening, and save a current-branch fallback when the old target disappears.
- Merge individual preference updates so focus, column widths, and remote visibility cannot overwrite one another.
- Keep hidden remote labels readable using the theme's muted text color instead of fading the entire row.
- Give keyboard column-resize handles localized names and visible focus outlines.
- Place native select focus outlines outside the dropdown background for clearer contrast in dark themes.
- Restore saved remote visibility when reopening the graph, preserve it on remote rename, and remove obsolete preferences after remote deletion.
- Show graph-loading errors with a Retry button instead of empty history or an indefinite loading indicator.
- Keep detached-HEAD commits and their uncommitted changes visible in the all-branches graph.
- Ignore superseded graph, branch, and commit-details replies, including stale errors, and cancel obsolete graph reads.
- Include the webview-bridge regression tests in the extension test suite, with watcher recovery coverage.
- Clip graph lines to the actual column width so wide graphs cannot overlap commit text.
- Include staged-only submodule pointer changes in the workspace filter.
- Report a diff that VS Code cannot open instead of leaving the request pending.
- Keep dialog fields and checkboxes visible on themes whose input and dialog backgrounds match.

[Unreleased]: https://github.com/jcfurey/Branchwise/commits/main
