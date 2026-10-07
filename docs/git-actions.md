# Working from the graph

All controls act on the repository selected in the graph, including initialized submodules. Clicking a repository's graph button in Source Control switches the graph to that repository. An action already running keeps its original repository; closing its dialog does not cancel Git.

## Getting started

After installing, VS Code offers the **Get started with Branchwise** walkthrough on the Welcome page, and the command **Branchwise: Open Getting Started Walkthrough** reopens it. Its five steps open the graph, explain how to read it, show where a commit's actions live, open the Branches pane, and cover recovery.

Inside the graph, a hint above the commit list says how to reach a commit's actions until the first menu opens. Every commit row shows a **⋯** button at its end on hover, and the settings cog holds **Getting Started**, **Legend** and **Learn more**, which opens this guide. **Legend** explains every symbol of the graph, each drawn as the graph draws it: commit dots and the checked-out commit's ring, the uncommitted changes, the unpushed dot and unpulled ring, the conflict mark, branch, remote branch and tag labels, the **+N** of labels that do not fit, dimmed history, and the branch focus and hidden-branches strips.

When the workspace holds no Git repository, the graph offers **Initialize Repository**, **Clone Repository…** and **Open Folder…**, which start VS Code's own flows for each. While a repository's graph first loads, grey placeholder rows stand in for its commits.

## Branches pane

The header's icon buttons are named by their tooltips. **Branches** (the panel icon near the right of the header) toggles a pane beside the graph with four sections: local branches, remotes, tags and stashes. Each section collapses independently, and the filter box narrows all of them at once. Clicking a local or remote branch selects its history using the header's **View** choice, and **All branches** restores every branch without dimming. Clicking a tag opens the graph at that commit. Clicking a stash opens its diff.

On a commit row, a remote branch named like a local branch on the same commit, such as `origin/main` beside `main`, appears as a cloud at the end of the local branch's label, and so does a remote's `HEAD`, such as `origin/HEAD`, which only names that remote's default branch; hover over the cloud for the names, and right-click it for the remote branch's actions. A row with more than two labels shows the first one and a **+N** button: its tooltip lists the others, and clicking it opens a menu of them that leads to each one's own actions.

The **View** selector offers three ways to read a selected branch:

- **Filter to branch** keeps the existing view showing only that branch's reachable history.
- **Focus direct history** keeps every visible branch in place. The selected branch's first-parent history stays in full colour, merged-in history uses muted colour, and commits outside its ancestry turn gray.
- **Focus all ancestors** also keeps the surrounding branches, but gives merged-in history full colour.

Focus changes the view without checking out a branch. When enabled from **All branches**, it starts with the checked-out branch when available. Switching focus between branches keeps the rows and lanes in place. **Clear focus** restores full colour, and the view choice is remembered per repository. Hovering, keyboard focus, selection and the checked-out commit retain clear text and markers. Search still filters the visible commits; in focus views it searches across branches and colours matches using their actual ancestry, even when connecting commits are outside the page.

Right-click a local or remote branch label in the graph, or a branch in the Branches pane, and choose **Focus this branch**. It enables direct-history focus or keeps your existing ancestor mode, and resumes focus if paused. A **Focus** badge marks the target in both places, separately from the bold checked-out branch.

Use **Pause focus** to temporarily restore every branch's colours, then **Resume focus** to return to the same target and mode. The badge reads **Paused** while paused. **Dimming → Subtle / Strong** adjusts the graph lines and commit dots; text stays readable at either strength. The target, dimming strength and pause state are remembered per repository. **Clear focus** removes the target and its badges.

### Commits the checked-out branch already has

After a cherry-pick or a rebase, the same change can sit on two branches under different commit IDs. While a branch other than the checked-out one is focused, or the graph is filtered to it, each of its commits whose change the checked-out branch already has shows a muted **applied** after its description. Hover over it for the checked-out branch's commit with that change, as in "Already in main as 1a2b3c4d: Fix the parser", and click it to select that commit; one the graph has not loaded opens as the history at that commit. Screen readers hear "already in main" in the row's summary.

Git decides by patch ID, which ignores line numbers and whitespace, so a commit picked as it was is marked, and one changed while it was picked is not. Branchwise runs `git log --cherry-mark --left-right --no-merges <checked-out>...<branch>` and pairs the marked commits up with `git patch-id --stable`. Merges have no single change and are never marked. Nothing in the repository changes. Only the focused or filtered branch is compared, never the whole graph; moving the focus, pausing it or clearing it stops a comparison under way, and answers are kept for each pair of branch tips, so a refresh that moves neither asks Git nothing. A branch with more than 2,000 commits the checked-out branch lacks is skipped without a mark. Turn the marks off with `branchwise.markAppliedCommits`.

**Find Equivalent Commit**, in the menu of a commit that is not on the checked-out branch's line, asks the same question for one commit at a time, whatever is focused: it compares the commit's stable patch ID with those of the checked-out branch's commits that it lacks and that change one of the same files, the newest 5,000 at most. It selects the commit it finds, or says that none makes the same change, or that the commit is on the checked-out branch already. It changes nothing either. A merge commit has no entry.

Local branches are listed by name. The clock button on the **Local Branches** section lists them by their last commit instead, newest first. Hover over a branch and click its pin to keep it at the top of the list, above the order chosen; pinned branches show a pin in place of the branch icon. The order and the pins are remembered per repository.

Short flags at the end of a local branch's row point out branches worth a look:

- **merged**: the checked-out branch already contains it, so deleting it loses no commits. A branch still at the checked-out commit, such as one just created, is not flagged.
- **gone**: its upstream was deleted on the remote.
- **stale**: it has had no commits for 90 days or more; the tooltip gives the number of days.
- A red collision mark: merging it into the checked-out branch would conflict; see [conflict forecast](#conflict-forecast).

Ahead and behind counts turn amber when a branch has diverged from its upstream, with commits on both sides. **Settings & Tools → Clean Up Merged Branches** deletes merged branches in one step; see [branch cleanup](#synchronization-review-and-branch-cleanup).

Every row carries the same context menu as the matching label in the graph, reached by right-click or its trailing menu button. The most common action is also inline: **Check Out** on a branch, **Fetch** on a remote, **Show in Graph** on a tag, and **Apply** or **Pop** on a stash. The **+** buttons create a branch at HEAD, add a remote, or save a stash.

Each remote has an eye button that hides its graph labels and commits reachable only through that remote. Shared history, local branches and tags remain visible. Hidden remote branches stay listed but dimmed; selecting or focusing one shows that remote again. Individual choices are saved per repository and also apply to history searches. Explicit commit or revision lookups can still open hidden history.

Hidden choices are restored when you reopen the graph. Renaming a remote through the extension keeps its visibility choice; removing it clears that choice. On refresh, choices for groups that no longer exist are removed, while groups with remaining remote-tracking refs keep their choice. A remote renamed outside the extension appears as a new, visible group.

The eye button on the **Remotes** section hides all remote branches temporarily. Showing them again preserves the individual hidden choices. Hiding a remote whose branch is selected clears that selection to **All branches** without checking out another branch. The settings cog in the header holds the global toggle and a shortcut to the extension's settings.

### Hiding branches by name

Repositories with many bot branches, such as `dependabot/*`, `renovate/*` or `gh-readonly-queue/*`, can hide them by name. Open **Settings & Tools → Hidden Branches…**, or right-click a branch label or a Branches pane row and choose **Hide Branches Like This…**, which adds a pattern for the branch's first path segment, such as `dependabot/*` for `dependabot/npm/foo`. Write one pattern per line; the dialog shows how many branches each one hides as you type, and nothing changes until you choose **Save**.

Patterns are globs, read as Git's `--exclude` reads them: `*` matches any characters, `/` included, `?` matches any one character, `[abc]` and `[a-z]` match one character of a set (`[!abc]` one outside it), and `\` takes the next character literally. A pattern must match the whole name, and case counts. Local branches are matched by their name and remote branches by their name after the remote, so `dependabot/*` hides both `dependabot/npm/foo` and `origin/dependabot/npm/foo`.

Hidden branches leave the graph with their labels and the commits only they reach; shared history, tags and other branches stay. They also leave the header's branch picker, history searches and the **All branches** count of the Statistics tab. In the Branches pane they stay listed but dimmed. A line above the graph says how many branches are hidden, with **Show all** to clear the patterns and **Edit patterns** to change them.

The checked-out branch is never hidden. Neither is the branch selected in the header: choosing a hidden branch from the Branches pane, or focusing it, shows it while it stays selected, and an eye-closed mark beside the branch picker says a pattern matches it. The pattern is kept, so the branch is hidden again once another one is selected. Patterns are saved per repository and restored when you reopen the graph; hiding branches never changes Git refs.

### Drag and drop

Drag and drop is a shortcut to three menu actions; each stays in its menu, for the keyboard too. A drop never acts on its own: it opens the confirmation of the matching menu entry, and nothing changes until you confirm it. Press Escape while dragging to cancel.

- Drag a commit row onto the label of the checked-out branch, in the graph or the Branches pane, to **Cherry-pick** it, as the commit's menu does. A merge commit asks which parent to cherry-pick against.
- Drag a local branch label, or a local branch in the Branches pane, onto the checked-out branch to merge it in, as the dragged branch's **Merge into Current Branch** does.
- Drag the checked-out branch onto another local or remote branch to rebase it onto that branch, as that branch's **Move the current branch onto this (rebase)** does.

While you drag, the note beside the pointer names what the drop will do. Git cherry-picks, merges and rebases on the checked-out branch only, so a branch that is not checked out refuses a commit, and two branches that are both not checked out refuse each other; the pointer shows that the drop is not allowed, and a note beside it says which branch to check out first. While you drag, a pill shows what is carried, such as `3a4b5c6d Fix parser` or a branch's name, and a branch that would take the drop is outlined. Dragging a tag or remote branch label drags its commit. A commit dropped on another commit does nothing.

Set `branchwise.dragAndDrop` to `false` to turn dragging off; clicking, selecting and the menus work the same either way.

## Wide graphs

Branch lines stay within the **Graph** column, including after column resizing. When the lanes do not fit, use the horizontal scrollbar under the Graph heading, a horizontal trackpad gesture, or **Shift+mouse wheel** over the graph. The scrollbar also accepts keyboard arrow keys when focused. Only the lanes move sideways; commit text stays in place, and commit selection and expanded details remain aligned. Drag the boundary beside **Graph** to give the lanes more room.

The column headings and graph scrollbar stay below the main controls as you scroll down the history, including when the controls wrap in a narrow window. Normal mouse-wheel scrolling still moves vertically.

Clicking or keyboard-navigating to a commit brings its lane into view with the smallest necessary horizontal movement. To find it again after panning, use the crosshair button beside **Message**, labelled **Reveal selected lane**. Refreshing or resizing keeps your manual position where the graph still fits; switching repositories resets it. Revealing a lane leaves the branch, checkout, focus mode, and commit text position unchanged.

## Loading errors

If Git cannot load the graph, the view shows the error and a **Retry** button. Repair the reported problem, such as an unavailable repository, Git executable, or invalid Git configuration, then retry. **This repository has no commits yet** is reserved for a successful load of a repository without commits.

## Remotes and tracking

Open **Settings & Tools → Remotes** to add a remote, edit its fetch and push URLs, rename or remove it, or choose the repository's default push remote. Multiple URLs are entered one per line. Leaving push URLs blank restores Git's fallback to fetch URLs. Removing a remote removes its local remote-tracking references, not the server or local branches.

Right-click a local branch and choose **Configure Upstream** to set, change or clear tracking without pushing. The status strip shows the checked-out branch's upstream and ahead/behind counts. Counts reflect the last fetch. In the graph, a filled dot before a commit's description marks a commit that no remote-tracking branch has yet, and a ring marks a commit on a branch that a local branch tracks but that no local branch has, such as one fetched but not pulled; hover over either for its meaning. Up to 1,000 commits of each kind are marked. Branch labels also show nonzero counts, and their tooltips identify worktree locations.

**Fetch** can update one or all remotes, optionally pruning stale remote-tracking branches. Remote checkout offers **Fetch the latest remote revision before checkout**, enabled by default. It creates an explicit tracking branch, or checks out and fast-forwards an existing local branch. Divergent history is not reset.

**Push Branch** works for any local branch, including one that is not checked out. Choose the remote and destination branch, and optionally set upstream tracking. **Pull Branch** is available on the checked-out branch and uses fast-forward only.

Tag pushes use a remote chooser. Remote branch and tag menus also offer deletion, with confirmation naming the destination remote. Deleting a remote ref leaves the local branch or tag intact.

For deliberately rewritten commits, select **Force with lease** in the push dialog. The confirmation captures the last fetched remote commit. The push fails if the server has moved from that exact commit, even if another client fetches in the meantime. Fetch and inspect the remote branch before retrying a rejected lease.

## Conflicts and interrupted operations

The status strip identifies merges, rebases, cherry-picks and reverts in progress, including operations started outside the extension. It lists conflicted files and offers **Open Conflict** and **Stage Resolution**. Open Conflict uses VS Code's merge editor, falling back to opening the file.

After resolving and staging conflicts, use **Continue**. **Abort** restores the operation's starting state. **Skip Commit** is available for rebase, cherry-pick and revert. Git's own checks still apply. Changes to the operation between displaying and submitting a confirmation require a fresh status.

## Conflict forecast

A local branch that would not merge cleanly into the checked-out branch shows a red collision mark and a count on its label in the graph. The tooltip names the files that would be in conflict, up to ten, and counts the rest. The forecast comes from `git merge-tree`, which tries each merge in memory: the work tree, the index and the refs are left as they are.

Only branches not yet merged into `HEAD` are tried: the 50 with the newest commits. Each result is remembered for that pair of commits, so a refresh tries again only the branches that moved, or all of them when `HEAD` does. Branches with no history in common with `HEAD`, which `git merge` refuses, get no mark. Nothing is forecast while a merge, rebase, cherry-pick or revert is under way, or with Git older than 2.38, which has no `merge-tree --write-tree`.

### Teammates' branches

Remote branches are forecast too, so a teammate's work that would conflict with yours shows up before either of you opens a pull request. A remote branch's label in the graph, and its row in the Branches pane, carry the same mark; the tooltip names the files and says whose work it is, from its last commit: "Last commit by Alice, 2 days ago". Fetch to see the latest.

While any remote branch would conflict, a line above the graph says how many, such as "2 teammates' branches would conflict with yours". Click it for a list of them, with the author and age of each one's last commit and the files in conflict; choosing one closes the list and focuses that branch in the graph.

Up to 50 remote branches are tried on top of the local ones, newest first, and only those:

- with a commit in the last 30 days;
- not merged into `HEAD`;
- other than the checked-out branch's own upstream, which only tells you that you are behind, and `<remote>/HEAD`;
- shown in the graph: hidden remotes, [hidden-branch patterns](#hiding-branches-by-name) and turning remote branches off all leave branches out;
- not at the same commit as a local branch, and not the upstream of a local branch that is tried, since the local branch's mark already says it.

The `branchwise.conflictForecast` setting chooses what is tried: `localAndRemote` (the default), `local` for local branches only, or `off`.

### Rebase, cherry-pick and revert forecast

The confirmations for **Move the current branch onto this (rebase)**, **Cherry-pick…** and **Revert…**, the interactive rebase editor, and the editors for cherry-picking or reverting selected commits say whether the operation would stop with conflicts before you start it. The line reads, for example, "Rebase would stop at 1a2b3c4d Add parser: conflicts in src/parser.ts, README.md", or "Replays 3 commits cleanly"; "Checking for conflicts…" shows while it is worked out. In the editors, the commit where it would stop is also marked, and the forecast is worked out again shortly after you reorder or drop commits. It only informs: every action can still be started.

Git replays the commits in memory, one at a time, with `git merge-tree --merge-base`, as the real operation would apply them: each commit onto the result of the one before. A rebase replays what `git rebase --rebase-merges` would: commits the target already has are left out, and merges are merged again from their replayed parents. A revert merges each commit's parent into the result, from the commit itself. The first commit that would conflict is reported with its files, and the forecast stops there, since what follows depends on how you resolve it. The merged trees and the throwaway commits between steps are written to a temporary folder that is deleted afterwards: the work tree, the index, the refs and the repository's objects are left as they are.

A merge picked or reverted from the commit menu has no forecast, as the result depends on the parent you choose; in the selection editors it is forecast against the parent chosen there. More than 200 commits are not forecast, and the line says so. The forecast needs Git 2.40 or later; with an older Git the line says that instead. Each answer is remembered for its exact commits, so asking again costs nothing.

## Stashes

Open **Settings & Tools → Stashes** to save changes, optionally including untracked files. Each stash can be inspected as a diff in VS Code, applied, popped or dropped. Apply and pop can restore staged changes as staged. A conflicting pop keeps the stash and displays the conflicts. Drop requires confirmation. Stash selections include the commit ID so a newer stash does not silently redirect a pending action.

## Rebasing

Right-click a branch and choose **Move the current branch onto this (rebase)**. Commit or stash changes first. This uses Git's merge-preserving rebase and offers the same recovery controls if it stops. The confirmation, like the interactive rebase editor, [forecasts](#rebase-cherry-pick-and-revert-forecast) the commit where it would stop with conflicts.

For interactive editing, right-click an ancestor commit and choose **Edit commits after this (interactive rebase)**. The plan contains the current branch's commits after that ancestor, from oldest to newest. Move commits earlier or later, choose Pick/Reword/Squash/Fixup/Drop, and edit messages for Reword. Squash combines with the preceding retained commit and keeps the combined messages; Fixup discards the fixup's message. At least one commit must remain, and the first retained commit cannot be Squash or Fixup. Below each group of commits that Squash combines, a box shows the combined commit's message as Git would write it: the first commit's message (as reworded, for Reword) and each Squash commit's message, a blank line apart, without Fixup messages. Edit it there before starting. An edited message is kept as typed apart from surrounding whitespace, so lines that start with `#` stay: the group is folded with Fixup and the result amended with that message, skipping the commit hooks as Git does for a squash. A message left as offered is combined by Git itself, as it would be without the box.

To combine several commits into one, select them in the graph (see [multiple commits](#reflog-and-multiple-commits)) and choose **Squash N Commits…** in the selection bar. This opens the same rebase editor, from the parent of the oldest selected commit: the oldest is Pick, the others are Squash, and the commits after them up to `HEAD` stay Pick. Nothing changes until **Start Rebase**, and the same checks apply, so uncommitted changes must be committed or stashed first. The combined commit keeps every selected commit's message, which can be edited in the editor first. The button is disabled, with the reason in its tooltip, unless the selected commits run without a gap along the current branch's first parents from `HEAD`, and neither they nor the commits after them include a merge. The repository's first commit cannot be squashed: it has no parent to rebase onto.

Stage changes in Source Control, then choose **Fold staged changes into this commit (fixup)** on the commit being corrected. Review the staged file list before submitting. **Arrange Fixup / Squash Commits** in the rebase editor places matching `fixup!` and `squash!` commits after their targets while preserving manual edits. Review the resulting order and actions before starting; ambiguous or unmatched targets remain Pick.

Interactive plans support linear ranges. A range containing merge commits is rejected instead of silently flattening its history. The plan is also rejected if the branch changes before submission. Plans and editor helpers live in that worktree's Git directory while a rebase is in progress and are removed after completion or abort; continuation works after reloading VS Code.

### Editing one commit in place

Three commit-menu entries change a single commit of the checked-out branch without a plan to arrange. They appear only on commits of the branch's own first-parent line, not on commits it gained through a merge, and the check is repeated before anything changes.

**Edit Message…**, also a button in the commit details, opens the commit's whole message for editing. The new message is kept as typed apart from surrounding whitespace, so lines that start with `#` stay. `HEAD` is amended with `git commit --amend --only`, which changes only the message: staged changes stay staged and other changes stay where they are. An older commit is reworded by an interactive rebase from its parent that picks every other commit; each commit keeps its files, and the later ones get new IDs. That rebase needs a clean working tree.

**Add Staged Changes to This Commit…** appears while changes are staged. Its confirmation lists the commit, the staged files and how many later commits will be rewritten. `HEAD` is amended with the staged changes, and unstaged changes are left alone. For an older commit, the staged changes are committed as `fixup! <subject>`, as **Fold staged changes into this commit (fixup)** does, and an autosquash rebase from the commit's parent folds them in at once. Like any autosquash, it also folds in other `fixup!` and `squash!` commits already waiting in that range. Nothing else may be unstaged or untracked, since the rebase needs a clean working tree. If the rebase stops on a conflict, the status strip offers Continue and Abort; Abort leaves the changes in the `fixup!` commit at the top of the branch.

Both are refused on a detached `HEAD`, on the first commit of the history unless it is `HEAD`, when the commit or one after it is a merge (again unless the commit is `HEAD`), and when the branch moved after the dialog opened. An empty message is refused too. When a remote-tracking branch already contains the commit, the dialog warns that sharing the rewritten history needs a force push; see [Remotes and tracking](#remotes-and-tracking) for **Force with lease**.

**Split Commit…**, in the commit menu and as a button in the commit details beside **Edit Message…**, breaks one commit into two or more. The dialog lists the files the commit changes, and a text file changed in place with more than one hunk can be opened to show its hunks. Choose a part for each file, or for each hunk, and add parts with **+ Part**. Each part has its own message: Part 1 starts with the original message and the others start empty. A line under the parts previews the result, such as "3 commits: Part 1 (4 files), Part 2 (2 files), Part 3 (1 file)", and **Split Commit** stays disabled until every part has a change and a message. An added, deleted or renamed file, a binary file and a change of file mode always go whole, so a rename stays one change in one part.

The parts are committed in order on the commit's parent, each with the original author and author date, and are built in a private index, so the working tree and the index are not touched. Together they must make exactly the original commit's files; if they would not, nothing changes. The commits after it are then made again on the last part with the same files, messages and authors and get new IDs; since their files do not change, no rebase runs, and staged, unstaged and untracked changes stay as they are. The branch moves only after all of that succeeds, and only if it has not moved since the dialog opened. When `commit.gpgSign` is set, the new commits are signed, and a signing failure leaves everything as it was. Split Commit is not offered for merge commits, and is refused on a detached `HEAD`, while another operation such as a merge or rebase is in progress, for a commit with only one change, and when a merge follows the commit on the branch. The first commit of the history can be split even when it is not `HEAD`.

### Absorbing staged changes into the commits they fix

When staged changes correct lines that earlier commits of the branch introduced, **Absorb Staged Changes…** splits them hunk by hunk into `fixup!` commits, one for each commit they correct. The button sits beside **Staged Changes** in the uncommitted changes' details, and appears while something is staged.

Each hunk of `git diff --cached` goes to the commit that last changed its lines, as `git blame` at `HEAD` tells; for a hunk that only adds lines, the lines just above and below it decide. Only the branch's own commits count: those on `HEAD`'s first-parent line after where it meets its upstream or, without an upstream, after the commits any remote-tracking branch or the local `main` or `master` already has. The search stops at a merge and after 100 commits. A hunk stays staged when its lines were last changed by a commit outside those, or by more than one commit, or when there is no line around it to go by. Added, deleted, renamed and binary files, and files whose mode or type changes, stay staged whole.

The preview lists, for each commit, its short ID and subject and the hunks it receives (file and lines), then what stays staged and why. Working this out changes nothing. **Create Fixup Commits** commits one `fixup! <subject>` per commit, oldest target first, on top of the branch. They are built in a temporary index, so unstaged and untracked changes are not touched, and the hunks that could not be absorbed stay staged. Before the branch moves, the fixups and the changes left staged must add up to exactly what was staged; otherwise, or if `HEAD` or the staged changes changed since the preview, nothing changes. Git's commit hooks do not run for these commits.

**Create and Squash Now** does the same and then opens the [interactive rebase](#rebasing) editor from the parent of the oldest target, with the fixups already arranged by **Arrange Fixup / Squash Commits**. Nothing is rewritten until **Start Rebase**. It is available only when nothing would be left staged, unstaged or untracked, as the rebase needs a clean working tree, and not when a fixup goes into the repository's first commit. When nothing can be absorbed, the preview says so and offers no action.

## Worktrees

Open **Settings & Tools → Worktrees** to inspect locations and checked-out branches, create a worktree, open one in a new VS Code window, or remove one. Creation accepts an absolute folder path and either a new branch with a start point or an existing branch. A branch already checked out elsewhere cannot be reused.

Removal preserves the branch. The main/current worktree cannot be removed from this control, and Git refuses removal of dirty or locked worktrees. No forced deletion is performed.

## Workspace and submodules

**Workspace** (the stacked boxes icon in the header) toggles a repository sidebar. It lists the same repositories as the picker: those found in the workspace folders within `maxDepthOfRepoSearch`, with their initialized submodules, plus any repository opened this session from Source Control or File History. Repositories cloned inside another repository, rather than added as its submodules, are found too, up to `nestedRepoSearchDepth` folders deep (3 by default, 0 to turn this off); that search skips hidden folders, `node_modules` and `bower_components`, and does not follow symlinks. A workspace folder inside a repository, or a symlink to one, lists that repository once under its real path, and the list follows added or removed folders and repositories. Each row shows the checked-out branch (or detached HEAD), changed file count, and ahead/behind counts from the last fetch. Click an initialized repository to switch its graph. The list is a tree: submodules and nested repositories sit under the repository that holds them, labelled by their path inside it and tagged **submodule** or **nested**, and the arrow beside a repository hides or shows the ones under it. Filter by name/path or show only repositories with changes; parent rows remain visible for context, and every match shows while a filter is on.

### Workspace status

The top of the Workspace pane totals what needs attention across the repositories the name filter matches, such as **3 repositories need attention**, **2 unpushed**, **1 behind**, **1 conflicted** and **4 with changes**. A repository needs attention when a merge, rebase, cherry-pick, revert or bisect is stopped partway or files are unmerged (**conflicted**), when it is behind its upstream, when it has commits no remote has (**unpushed**: ahead of its upstream, other local branches ahead of theirs, or a checked-out branch without an upstream in a repository with a remote), when it has uncommitted changes, or when it could not be read. Each total narrows the tree to its repositories, keeping their parents for context; click it again to show them all. The chosen total is remembered with the pane.

Rows add small badges for an operation in progress, conflicted files, an unpublished branch, other branches ahead of their upstream and stashes, and a muted **fetched 3 days ago** once the last fetch (when `FETCH_HEAD` was written) is more than a day old. A detached HEAD shows its own icon beside the commit. **Needs attention first**, in the ordering list, sorts repositories that are conflicted or mid-operation first, then those behind, unpushed, with changes, and clean ones last. It keeps the tree: siblings are sorted among themselves, and a repository sorts by the most urgent of itself and the repositories under it. All of this is read in the same bounded pass as the rest of the row and never changes a repository.

**Fetch All**, **Pull All** and **Push All** act on the repositories the filters match, not on parents shown for context. Each first lists what will happen in every repository and why anything is skipped, then runs after you confirm, two repositories at a time, with each repository's progress and a summary of completed, skipped and failed ones at the end:

- **Fetch All** fetches every remote, as **Workspace Fetch & Update** does. Repositories without a remote, uninitialized submodules and repositories that could not be read are skipped.
- **Pull All** only fast-forwards the checked-out branch to its fetched upstream, as the reviewed pull of one branch does. It skips repositories with uncommitted changes, a detached HEAD, no upstream (or one that was deleted), a branch that has diverged from its upstream, one already up to date, and any repository with an operation in progress. It does not fetch first; use **Fetch All** for that.
- **Push All** pushes every local branch that is strictly ahead of its upstream branch to that branch, never forced and never setting a new upstream. Branches without an upstream, with a deleted upstream, or with commits to pull first are skipped, and so is any repository with an operation in progress.

Each pull and push checks its branch and upstream again just before it runs, and refuses, changing nothing, when they moved or the work tree changed since the confirmation.

Submodule rows distinguish the actual HEAD, the revision recorded in the parent index, and the revision recorded in the parent commit. Their action menu offers **Initialize Submodule**, **Sync Submodule URLs**, and **Update to Recorded Revision**. Sync copies URLs from `.gitmodules`. Initialize/update use recursive Git checkout of the parent's recorded index revision, including nested submodules. Git checks for conflicting local changes; the extension rejects updates while an initialized child has an interrupted operation. No force checkout or `--remote` advancement is used.

Click either revision-change badge, or choose **Compare Submodule Revisions**, to inspect added and removed child commits. Toggle **Compare staged pointer** to compare the parent commit with its index; the other mode compares the index with the child checkout. **Stage Submodule Pointer** and **Unstage Submodule Pointer** change only that gitlink in the parent index, preserving other staged files, child files, and `.gitmodules`. Unstaging a newly added pointer removes it from the index. The dialog links to both graphs. Staged-only pointer changes count in the changed-repositories filter.

**Workspace Fetch & Update**, in the sidebar or Settings & Tools, fetches selected or all initialized repositories. Two workers run independently; a failed repository does not stop the others. Results remain available after hiding the dialog or switching graphs. Each successful fetch offers an upstream review for its current branch. Apply updates individually after inspecting the incoming commits; detached HEADs, missing upstreams, divergent branches, dirty worktrees, and active operations cannot be fast-forwarded through this control. Workspace results last for the current graph view.

## Synchronization review and branch cleanup

**Push Branch** opens **Preview Push** before sending commits. Review incoming/outgoing commits and the exact local and last-fetched remote tips. **Fetch & Refresh Preview** updates that information. New remote branches show the reachable outgoing history. Force-with-lease uses the reviewed remote tip as the expected server value; ordinary pushes retain Git's non-fast-forward protection. The pushed source is the reviewed commit ID, even if another client subsequently moves the local branch.

**Pull Branch** first fetches the selected remote, then displays the incoming and outgoing commits. **Apply Reviewed Fast-forward** requires a clean checkout of the selected branch and applies the exact reviewed commit without fetching again. A local or remote-tracking tip that changes before submission invalidates the plan. Refresh the preview to include later commits.

**Settings & Tools → Fast-forward Branches** moves every local branch whose upstream has new commits, and which has none of its own, up to that upstream in one step, without checking anything out. **Fetch All & Refresh** fetches every remote first. All movable branches are chosen to begin with; untick any to leave them. The list also names the branches that stay, and why: a branch with commits of its own has diverged and needs a pull or rebase; a branch checked out in another worktree is left for that worktree; and the checked-out branch moves only when it has no uncommitted changes, by a fast-forward merge. Each other branch moves only if it still points where the review saw it, and its reflog records the fast-forward.

**Settings & Tools → Clean Up Merged Branches** lists local branches whose tips are ancestors of the current HEAD. Select branches and confirm the names and tips before deleting them. Branches used by any worktree, `main`, `master`, and known remote default branches are excluded. The backend repeats these checks and compare-and-deletes each selected ref using its reviewed tip. A failure stops the remaining deletions and reports how many completed. Remote branches are unaffected.

## Finding regressions with bisect

Open **Settings & Tools → Find a Regression (Bisect)**, or use **Use as Good/Bad Bisect Commit** on graph commits. Choose known good and bad endpoints, commit or stash changes, then **Start Bisect**. Git checks out candidate commits. Build or test each candidate, reopen the bisect controls from the status strip, and choose **Mark Good**, **Mark Bad**, or **Skip Untestable Commit**.

The result displays the first bad commit, or explains when skipped commits prevent a unique result. **Reset Bisect** ends the session and restores Git's original checkout. Native Git bisect state survives reloading VS Code, and stale classifications are rejected if the session or checkout changed. Changes made while testing must be committed or stashed before advancing/resetting. Other history-changing workflows that require an idle repository also require resetting bisect first.

## Commit details

Click a commit to open its details: the commit ID with **Copy Short ID** and **Copy Full ID** buttons, and **Edit Message…** and **Split Commit…** on the checked-out branch's own commits (see [editing one commit in place](#editing-one-commit-in-place)), its parents, author, date and committer, the whole message, and the changed files. The commit menu also offers **Copy Commit ID** and **Copy Short Commit ID**. The message keeps its line breaks; inline code, fenced code blocks, `**bold**` and `*italic*` are styled, and web addresses become links. When the checked-out branch's remote, `origin` or the only remote is on github.com or a GitLab server, references such as `#12`, `GH-12`, `owner/repo#12` and, on GitLab, `!12` link to that issue or merge request. Keys of other trackers, such as Jira's `PROJ-123`, link to the addresses that the `branchwise.issueLinks` setting gives them.

Click a changed file to open its diff against the commit's first parent. **Open All Changes**, at the top of the file list and in the commit menu, opens every changed file in one VS Code multi-file diff editor instead, titled **Changes in** and the short commit ID, with the same two sides each file's own diff shows: an added file compares with an empty left side, a deleted file with an empty right side, and a renamed file shows its old name on the left. Should VS Code be unable to open that editor, the first file's diff opens on its own and a notification says why.

The same remote gives the commit menu **Open Commit on GitHub** or **Open Commit on GitLab**, and the tag menu **Open Tag on GitHub** (the tag's release page) or **Open Tag on GitLab**. A local branch that tracks a branch on such a host offers **Open Branch on GitHub** or **Open Branch on GitLab**, which opens the branch the remote has, under its name there. Self-hosted GitLab servers count when their host name contains `gitlab`, and HTTPS and SSH remote addresses both work. The page opens in your browser; the entries are missing when no remote is on a known host, and the branch entry is missing for a branch without an upstream or whose upstream was deleted.

The same branch offers **Create Pull Request…** on GitHub, or **Create Merge Request…** on GitLab, and so does a remote branch's menu. It opens the host's page for proposing the branch, under its name on the remote, against the remote's default branch: the branch `refs/remotes/<remote>/HEAD` points to, which a clone records and `git remote set-head <remote> --auto` updates. When that is unknown the host proposes its own default branch. The entry is missing for the default branch itself. A local branch without an upstream, or whose upstream was deleted, offers **Push and Create Pull Request…** (or **Merge Request…**) instead, when the remote a push would suggest (`remote.pushDefault`, else `origin`, else the first remote) is on a known host: it opens the push dialog with **Set as upstream branch** ticked, and opens the page for the remote and branch name you pushed to once the push succeeds. Nothing opens when the push fails or is cancelled.

Under the committer, once the rest of the details are showing, a line names the branches that contain the commit, with **Contained in:** and one chip per branch: the checked-out branch first, then the other local branches, then the remote ones. Branches the graph hides, those of hidden remotes or matching a hidden-branch pattern, are left out. Ten are shown; **and N more** lists the rest in its tooltip. A second line names the earliest tag, by its tag date, that contains the commit as **First released in v1.2.0**, counts the later ones as **also in N later tags** (hover to see them), and names the nearest tag before it, from its first parent, as **Follows v1.1.0**. Click a branch chip to focus that branch in the graph, or a tag chip to select its commit. Git answers with `git for-each-ref --contains` and `git describe`, which can take a moment in a repository with thousands of refs: the line reads **Checking…** meanwhile, the rest of the details never wait for it, and closing the details stops it. Answers are kept until a ref changes. A commit that no branch or tag contains shows neither line.

### Commit signatures

A small key after a commit's description in the graph means the commit carries a signature: OpenPGP (gpg), X.509 (gpgsm) or SSH. The graph only reads the commits for it and checks nothing, so its tooltip says to open the details to verify. The details then check the signature with the programs, keys and allowed signers your Git configuration names, as `git log --format=%G?` does, and show the verdict as an icon and words:

- **Good signature by** the signer, with the end of the key's fingerprint (the start of an SSH key's) and Git's trust level
- **Good signature from a key that is not trusted**: the signature matches, but no one certified the OpenPGP key, or no entry of `gpg.ssh.allowedSignersFile` names the SSH key
- **Bad signature**: the commit no longer matches its signature
- **Expired signature**, **Signed with an expired key** or **Signed with a revoked key**
- **Signature can't be checked**, with the reason: the signing key is not in your keyring; gpg, gpgsm or ssh-keygen could not be started, as on a remote host without gpg; SSH signatures need `gpg.ssh.allowedSignersFile`; or the check took longer than 10 seconds, as when gpg waits for an agent or a key server, and was stopped
- **Unsigned**

Checking changes nothing in the repository, and an unsigned commit starts no program. Verdicts are kept until VS Code restarts, except those your own setup decides: a key that is not trusted, a missing key or program, or a check that was stopped. Once you import the key or add the signer to your allowed signers, opening the details again checks again. To sign with SSH keys, set `gpg.format` to `ssh` and `user.signingKey` to your key. Turn off `branchwise.showSignatures` to leave out the graph's keys, which saves reading each loaded commit a second time; the details still check signatures.

## Search, file history, and comparison

The header's search button opens the search row, and `/` or Ctrl/Cmd+F opens and focuses it. The row stays open while a filter is active. It queries repository history beyond the graph's loaded commits, with 100 results per page. Enter words from a commit message, or a resolvable commit ID of at least seven characters. Down Arrow moves from the search box into the results.

**Filters** holds author and committer (name or e-mail), branch and tag names, a file or folder path, text added or removed by the changes, inclusive dates, rename following for a single file, and named filters saved per repository. A branch or tag name limits the results to the commits that the branches or tags whose names contain it point to; with both, either may match. Fields match literal text, ignoring case, unless **Regular expressions** is ticked. You can also type a field into the search box as `author:`, `committer:`, `branch:`, `tag:`, `path:`, `changes:` (or `diff:`), `since:` or `until:`, with quotes around a value that has spaces, as in `fix tag:v1.2 author:"Ann Lee"`; searching moves each one into its field.

**Text added or removed** answers "when did this string appear, or go?". It finds the commits that change how many times the text occurs in a file (`git log -S`), so a commit that only moves or edits the line around it is left out. With **Regular expressions** ticked it finds instead every commit that adds or removes a line matching the expression (`git log -G`), which includes such edits. For example, `changes:"parseConfig("` finds the commit that introduced a call and the one that removed it, and adding `path:src/app.ts` limits the search to one file. It finds the commits that made a change rather than the merges that brought it in, except while following renames, where a merge counts with what it changed on its first parent. Git reads each commit's changes to answer, so this search is slower than the others in a large repository: each page stops after its 100 results, and starting another search, or leaving the history, stops the one under way.

When the search text appears in the names of branches or tags, they are listed above the results; click one to open the history at the commit it points to. In **Filter to branch** view, a selected branch limits the history to that branch. Filtered results may omit commits between matches. **Return to Graph** clears the filters.

When a search finds nothing, buttons below the message widen it in one step, each shown only when it applies: **Search all branches** while the graph is filtered to one branch, **Clear filters (N)** with the number of Filters fields filled in (the search text stays), **Turn off regular expressions**, and **Search changes instead**, which moves message text into **Text added or removed**.

The **Jump to HEAD** button next to search scrolls to the checked-out commit and puts the keyboard on it. It is highlighted while that commit is out of sight. From a search it returns to the graph first, and when the graph has not loaded that commit, it opens the history at HEAD.

**Go to Branch, Tag or Commit…** jumps to a commit by name without opening the Branches pane. Press Ctrl+Alt+G (Cmd+Alt+G on macOS) while the graph has focus, run it from the Command Palette, or choose it from **Settings & Tools**. The picker lists local branches, remote branches and tags, newest first, each with its commit's short ID and subject; type to narrow the list by name, ID or subject. Typing four or more hexadecimal characters also offers **Commit ID**, which goes to the one commit whose ID starts with them. The chosen commit's row is scrolled into the middle of the graph, selected and given the keyboard, as with **Jump to HEAD**. A commit the graph has not loaded opens as the history at that commit, with its row first. To use another key, search for `branchwise.goTo` in **Keyboard Shortcuts**.

Right-click a file in Explorer, an editor title, or a commit's changed-file list and choose **File History**. Rename following retains the historical path at each commit. From a history row, open that file at its revision or choose **Restore File Contents**. The restore preview lets you choose the destination and compare its working contents with the historical version before confirming. Restore replaces the working file, including binary contents and Git file modes, and preserves the real index. A changed working file or index invalidates the preview. When the restore replaces different contents, they are first saved as a Git object, and the notification offers **Undo Restore**, which puts them back byte for byte unless the file changed again; Git keeps that object until its next garbage collection. Save or revert unsaved editor changes to the file first: the restore refuses to run while they exist, since saving them afterwards would overwrite it, and the preview warns that it shows them. Historical previews use VS Code text documents; binary restoration does not require a text preview.

**Compare** accepts branch names, tags, or commits. Ref/commit menus also provide **Compare with…**, and selecting two rows offers **Compare Selected**. The result lists changed files and commits unique to each endpoint, with native VS Code diffs that leave the comparison dialog open. **Open All Changes** beside the file count opens every listed file in one multi-file diff editor. **Show changes introduced since the common ancestor** compares that ancestor with the right revision; the unique-commit lists still compare the two endpoints. Clicking a listed commit opens graph context beginning at that commit and its ancestors.

## Reflog and multiple commits

The **Reflog** tab at the left of the header, also opened by **Settings & Tools → Recover lost commits (reflog)**, lists every move of HEAD and the local branches, newest first: when it happened, which ref moved, the operation (commit, checkout, reset, rebase, merge and so on, coloured by what it does to history), what Git recorded, and the commit the ref moved to. Choose one ref or one operation, or filter by text in the message, the commit subject or the commit ID.

A commit marked **Not on any branch** is one that no branch, tag, remote branch or HEAD still reaches, such as the commit before an amend or a reset, or the work on a deleted branch. **Only commits no branch reaches** lists just those. Each row's **Show in Graph** opens the commit's history in the graph, and its **⋯** menu offers **Create Recovery Branch…**, which keeps the commit under a new branch without checking it out, **Check Out…** and **Reset…**, each with the same confirmation as in the graph. Git deletes unreachable commits once their reflog entries expire, after 30 days by default.

The tab you were on is remembered when the panel reopens. Searching, **Jump to HEAD** and **Show in Graph** return to the **Graph** tab.

## Undo and the Safety Net

Before Branchwise runs an action that moves or deletes refs, it writes down which refs the action may change, where they point, and the branch HEAD is on, and keeps each old commit under `refs/branchwise/backup/`. Git keeps whatever those refs reach, and the graph, the branch lists, Go to and the reflog leave the namespace out. When the backups cannot be written, the action does not run. The actions recorded are:

- reset (soft, mixed and hard); a hard reset also keeps the uncommitted changes it discards, as `git stash create` does, and a mixed reset keeps what was staged
- rebase and interactive rebase, including squash, **Edit Message…** and **Add Staged Changes to This Commit…**
- **Absorb Staged Changes…**, whose Undo removes the fixup commits and leaves the changes staged again
- **Split Commit…**
- merge, cherry-pick and revert, of one commit or a selection
- **Fast-forward Branches**
- deleting and force-deleting a branch, and **Clean Up Merged Branches**; the branch's settings, such as its upstream, are kept too
- renaming a branch, and deleting a tag
- dropping a stash
- a force push with lease and deleting a remote branch, which are only recorded: the remote branch's previous commit is kept, but Undo cannot push it back

Once an action is done, a notification offers **Undo**, and **Settings & Tools** starts with **Undo** and the action's name, such as **Undo Hard Reset of main**, while there is something to undo. Undo puts every ref back with a compare-and-swap (`git update-ref <ref> <old> <new>`), so it refuses, and changes nothing, when any of them has moved since, such as after a new commit. The checked-out branch moves with `git reset --keep`, which refuses to overwrite uncommitted changes, or with `--soft` after a message edit, an amend or an absorb, which leaves the folded-in changes staged again. A deleted branch or tag is created again, a renamed branch is renamed back, a dropped stash goes back on the stash list, and a hard reset's discarded changes are applied again. Undo also refuses while a merge, rebase, cherry-pick or revert is stopped, and for a branch checked out in another worktree. What Undo replaces is kept as well. After one Undo, the menu offers the action before it.

An action that stops on a conflict is completed in the record when **Continue** or **Abort** in the status strip ends it; one finished outside Branchwise stays listed, but cannot be undone in one step.

**Settings & Tools → Safety Net…** lists the recorded actions, newest first, with the refs each one changed, from which commit to which, and the commits no branch, tag, remote branch or HEAD reaches any more because of it. **Restore** puts an action's refs back the same way as Undo, and **Create Recovery Branch…** keeps a lost commit under a new branch. The record is kept in the repository's Git directory, in `branchwise/safety-net.json`, so every worktree and VS Code window shares it; the 50 most recent records of the last 30 days are kept, and older ones and their backups are removed.

## Statistics

The **Statistics** tab counts the commits on every branch the graph shows, or on one local branch, over the last 30 days, 90 days, year, or all time. It shows the number of commits, contributors and days with commits, a grid of commits per day over the last year (point at a day for its date and count), and every contributor with their commits, share and first and last commit. People are named as `.mailmap` names them, so someone who committed under several addresses counts once. **Count lines changed** adds the lines each contributor added and deleted outside merges; it reads every commit's changes, so it is slower on large repositories. Click a contributor to search the graph for their commits. Avatars are initials; Branchwise fetches nothing over the network.

Ctrl/Cmd-click selects individual commits; Shift-click selects a range. Select up to 100 commits for **Cherry-pick Selected** or **Revert Selected**. Review and adjust the execution order before confirming. Cherry-picks default to oldest first; reverts default to newest first. Merge commits require a common mainline parent choice. The native Git sequencer retains remaining commits if a conflict interrupts the batch; use the status strip's Continue, Abort, or Skip controls. Consecutive commits of the current branch can also be combined with **Squash N Commits…** (see [rebasing](#rebasing)).

## Keyboard navigation and activity

Arrow keys move between commit rows; Home/End move to the first/last loaded row. Enter opens details, Space selects, and Shift+F10 opens actions. Ctrl/Cmd+F or `/` opens and focuses history search when no dialog is active, and Ctrl+Alt+G (Cmd+Alt+G on macOS) opens **Go to Branch, Tag or Commit…**. Repository switches preserve filters and scroll position.

Single keys act on the commit row that has focus, without opening its menu. Each one opens the same dialog or confirmation as the matching menu entry, so nothing changes until you confirm:

| Key | Action                                                        |
| --- | ------------------------------------------------------------- |
| C   | **Check Out…** the commit                                     |
| B   | **Create Branch…**                                            |
| T   | **Create Tag…**                                               |
| P   | **Cherry-pick…**; with several commits selected, all of them  |
| V   | **Revert…**                                                   |
| R   | Rebase the current branch onto the branch on the row          |
| I   | **Edit commits after this (interactive rebase)…**             |
| M   | **Merge into Current Branch…**: the branch on the row, if any |
| X   | **Reset Current Branch to This Commit…**                      |
| E   | **Edit Message…**, for commits of the checked-out branch      |
| Y   | Copy the short commit ID; Shift+Y copies the full ID          |
| O   | Open the commit on GitHub or GitLab                           |
| D   | Open or close the details, like Enter                         |
| ?   | Show every keyboard shortcut                                  |

R and M use the first branch label on the row whose own menu offers the action. A key whose action the row does not offer, such as E on a commit of another branch, does nothing; a screen reader announces that it is not available here. Menus show each entry's key at the right. The keys are ignored while typing in the search box or a dialog, while a dialog or menu is open, and with modifiers such as Ctrl, so VS Code's own shortcuts keep working. **Settings & Tools → Keyboard Shortcuts** opens the same list as `?`. To turn the single keys off, for example for a screen reader or an extension that sends single keys, set `branchwise.singleKeyShortcuts` to `false`.

Running operations show their repository, action, and elapsed time. **Hide** closes the progress dialog while Git continues. Push, pull, fetch, remote branch and tag deletion, and checkouts that fetch first also offer **Stop Git**, which ends the Git process, for example when a server stops responding, and frees the repository for other actions. Git never waits for a password typed in a terminal; use a credential helper or SSH agent. **Git Activity** retains the last 100 operations from this view, including results that arrive after switching repositories or opening another dialog. Errors have selectable output and **Copy Error Details**. This activity list lasts for the current graph view; it is separate from Git's reflog.

Closing a menu or dialog restores focus to the original control or commit row. On narrow windows the workspace sidebar moves above the graph and dialog fields stack vertically. Superseded history queries cancel their Git processes; hiding a mutation's progress dialog leaves that operation running.

Colour is never the only sign of what something is. In the graph, an ordinary commit is a filled dot, the checked-out commit a ring, a merge a wider ring around a small dot, and the uncommitted changes a dashed ring. Each changed file in a commit's details ends with its status letter, such as **A** for added, **M** modified, **D** deleted or **R** renamed, which its tooltip and screen readers name in full. A screen reader reads each commit row as one summary: its subject, author and age, then whether it is checked out, a merge, unpushed or unpulled, whether a branch on it would conflict with yours, whether your branch already has its change, and its branches and tags, as in "Fix the parser, Ann Lee, 3 days ago, merge of 2 parents, unpushed, branch main, tag v1.0". High contrast themes outline the selected or hovered row, and forced colours, such as a Windows contrast theme, keep system colours for focus, selection, the unpushed dot, the conflict mark and branch and tag labels.
