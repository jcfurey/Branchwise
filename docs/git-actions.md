# Working from the graph

All controls act on the repository selected in the graph, including initialized submodules. Clicking a repository's graph button in Source Control switches the graph to that repository. An action already running keeps its original repository; closing its dialog does not cancel Git.

## Getting started

After installing, VS Code offers the **Get started with Branchwise** walkthrough on the Welcome page, and the command **Branchwise: Open Getting Started Walkthrough** reopens it. Its five steps open the graph, explain how to read it, show where a commit's actions live, open the Branches pane, and cover recovery.

Inside the graph, a hint above the commit list says how to reach a commit's actions until the first menu opens. Every commit row shows a **⋯** button at its end on hover, and the settings cog holds **Getting Started** and **Learn more**, which opens this guide.

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

## Stashes

Open **Settings & Tools → Stashes** to save changes, optionally including untracked files. Each stash can be inspected as a diff in VS Code, applied, popped or dropped. Apply and pop can restore staged changes as staged. A conflicting pop keeps the stash and displays the conflicts. Drop requires confirmation. Stash selections include the commit ID so a newer stash does not silently redirect a pending action.

## Rebasing

Right-click a branch and choose **Move the current branch onto this (rebase)**. Commit or stash changes first. This uses Git's merge-preserving rebase and offers the same recovery controls if it stops.

For interactive editing, right-click an ancestor commit and choose **Edit commits after this (interactive rebase)**. The plan contains the current branch's commits after that ancestor, from oldest to newest. Move commits earlier or later, choose Pick/Reword/Squash/Fixup/Drop, and edit messages for Reword. Squash combines with the preceding retained commit and keeps the combined messages; Fixup discards the fixup's message. At least one commit must remain, and the first retained commit cannot be Squash or Fixup.

To combine several commits into one, select them in the graph (see [multiple commits](#reflog-and-multiple-commits)) and choose **Squash N Commits…** in the selection bar. This opens the same rebase editor, from the parent of the oldest selected commit: the oldest is Pick, the others are Squash, and the commits after them up to `HEAD` stay Pick. Nothing changes until **Start Rebase**, and the same checks apply, so uncommitted changes must be committed or stashed first. The combined commit keeps every selected commit's message. The button is disabled, with the reason in its tooltip, unless the selected commits run without a gap along the current branch's first parents from `HEAD`, and neither they nor the commits after them include a merge. The repository's first commit cannot be squashed: it has no parent to rebase onto.

Stage changes in Source Control, then choose **Fold staged changes into this commit (fixup)** on the commit being corrected. Review the staged file list before submitting. **Arrange Fixup / Squash Commits** in the rebase editor places matching `fixup!` and `squash!` commits after their targets while preserving manual edits. Review the resulting order and actions before starting; ambiguous or unmatched targets remain Pick.

Interactive plans support linear ranges. A range containing merge commits is rejected instead of silently flattening its history. The plan is also rejected if the branch changes before submission. Plans and editor helpers live in that worktree's Git directory while a rebase is in progress and are removed after completion or abort; continuation works after reloading VS Code.

## Worktrees

Open **Settings & Tools → Worktrees** to inspect locations and checked-out branches, create a worktree, open one in a new VS Code window, or remove one. Creation accepts an absolute folder path and either a new branch with a start point or an existing branch. A branch already checked out elsewhere cannot be reused.

Removal preserves the branch. The main/current worktree cannot be removed from this control, and Git refuses removal of dirty or locked worktrees. No forced deletion is performed.

## Workspace and submodules

**Workspace** (the stacked boxes icon in the header) toggles a repository sidebar. It lists the same repositories as the picker: those found in the workspace folders within `maxDepthOfRepoSearch`, with their initialized submodules, plus any repository opened this session from Source Control or File History. Repositories cloned inside another repository, rather than added as its submodules, are found too, up to `nestedRepoSearchDepth` folders deep (3 by default, 0 to turn this off); that search skips hidden folders, `node_modules` and `bower_components`, and does not follow symlinks. A workspace folder inside a repository, or a symlink to one, lists that repository once under its real path, and the list follows added or removed folders and repositories. Each row shows the checked-out branch (or detached HEAD), changed file count, and ahead/behind counts from the last fetch. Click an initialized repository to switch its graph. The list is a tree: submodules and nested repositories sit under the repository that holds them, labelled by their path inside it and tagged **submodule** or **nested**, and the arrow beside a repository hides or shows the ones under it. Filter by name/path or show only repositories with changes; parent rows remain visible for context, and every match shows while a filter is on.

Submodule rows distinguish the actual HEAD, the revision recorded in the parent index, and the revision recorded in the parent commit. Their action menu offers **Initialize Submodule**, **Sync Submodule URLs**, and **Update to Recorded Revision**. Sync copies URLs from `.gitmodules`. Initialize/update use recursive Git checkout of the parent's recorded index revision, including nested submodules. Git checks for conflicting local changes; the extension rejects updates while an initialized child has an interrupted operation. No force checkout or `--remote` advancement is used.

Click either revision-change badge, or choose **Compare Submodule Revisions**, to inspect added and removed child commits. Toggle **Compare staged pointer** to compare the parent commit with its index; the other mode compares the index with the child checkout. **Stage Submodule Pointer** and **Unstage Submodule Pointer** change only that gitlink in the parent index, preserving other staged files, child files, and `.gitmodules`. Unstaging a newly added pointer removes it from the index. The dialog links to both graphs. Staged-only pointer changes count in the changed-repositories filter.

**Workspace Fetch & Update**, in the sidebar or Settings & Tools, fetches selected or all initialized repositories. Two workers run independently; a failed repository does not stop the others. Results remain available after hiding the dialog or switching graphs. Each successful fetch offers an upstream review for its current branch. Apply updates individually after inspecting the incoming commits; detached HEADs, missing upstreams, divergent branches, dirty worktrees, and active operations cannot be fast-forwarded through this control. Workspace results last for the current graph view.

## Synchronization review and branch cleanup

**Push Branch** opens **Preview Push** before sending commits. Review incoming/outgoing commits and the exact local and last-fetched remote tips. **Fetch & Refresh Preview** updates that information. New remote branches show the reachable outgoing history. Force-with-lease uses the reviewed remote tip as the expected server value; ordinary pushes retain Git's non-fast-forward protection. The pushed source is the reviewed commit ID, even if another client subsequently moves the local branch.

**Pull Branch** first fetches the selected remote, then displays the incoming and outgoing commits. **Apply Reviewed Fast-forward** requires a clean checkout of the selected branch and applies the exact reviewed commit without fetching again. A local or remote-tracking tip that changes before submission invalidates the plan. Refresh the preview to include later commits.

**Settings & Tools → Clean Up Merged Branches** lists local branches whose tips are ancestors of the current HEAD. Select branches and confirm the names and tips before deleting them. Branches used by any worktree, `main`, `master`, and known remote default branches are excluded. The backend repeats these checks and compare-and-deletes each selected ref using its reviewed tip. A failure stops the remaining deletions and reports how many completed. Remote branches are unaffected.

## Finding regressions with bisect

Open **Settings & Tools → Find a Regression (Bisect)**, or use **Use as Good/Bad Bisect Commit** on graph commits. Choose known good and bad endpoints, commit or stash changes, then **Start Bisect**. Git checks out candidate commits. Build or test each candidate, reopen the bisect controls from the status strip, and choose **Mark Good**, **Mark Bad**, or **Skip Untestable Commit**.

The result displays the first bad commit, or explains when skipped commits prevent a unique result. **Reset Bisect** ends the session and restores Git's original checkout. Native Git bisect state survives reloading VS Code, and stale classifications are rejected if the session or checkout changed. Changes made while testing must be committed or stashed before advancing/resetting. Other history-changing workflows that require an idle repository also require resetting bisect first.

## Commit details

Click a commit to open its details: the commit ID with **Copy Short ID** and **Copy Full ID** buttons, its parents, author, date and committer, the whole message, and the changed files. The commit menu also offers **Copy Commit ID** and **Copy Short Commit ID**. The message keeps its line breaks; inline code, fenced code blocks, `**bold**` and `*italic*` are styled, and web addresses become links. When the checked-out branch's remote, `origin` or the only remote is on github.com or a GitLab server, references such as `#12`, `GH-12`, `owner/repo#12` and, on GitLab, `!12` link to that issue or merge request.

## Search, file history, and comparison

The header's search button opens the search row, and `/` or Ctrl/Cmd+F opens and focuses it. The row stays open while a filter is active. It queries repository history beyond the graph's loaded commits, with 100 results per page. Enter words from a commit message, or a resolvable commit ID of at least seven characters. Down Arrow moves from the search box into the results.

**Filters** holds author and committer (name or e-mail), branch and tag names, a file or folder path, inclusive dates, rename following for a single file, and named filters saved per repository. A branch or tag name limits the results to the commits that the branches or tags whose names contain it point to; with both, either may match. Fields match literal text, ignoring case, unless **Regular expressions** is ticked. You can also type a field into the search box as `author:`, `committer:`, `branch:`, `tag:`, `path:`, `since:` or `until:`, with quotes around a value that has spaces, as in `fix tag:v1.2 author:"Ann Lee"`; searching moves each one into its field.

When the search text appears in the names of branches or tags, they are listed above the results; click one to open the history at the commit it points to. In **Filter to branch** view, a selected branch limits the history to that branch. Filtered results may omit commits between matches. **Return to Graph** clears the filters.

The **Jump to HEAD** button next to search scrolls to the checked-out commit and puts the keyboard on it. It is highlighted while that commit is out of sight. From a search it returns to the graph first, and when the graph has not loaded that commit, it opens the history at HEAD.

Right-click a file in Explorer, an editor title, or a commit's changed-file list and choose **File History**. Rename following retains the historical path at each commit. From a history row, open that file at its revision or choose **Restore File Contents**. The restore preview lets you choose the destination and compare its working contents with the historical version before confirming. Restore replaces the working file, including binary contents and Git file modes, and preserves the real index. A changed working file or index invalidates the preview. When the restore replaces different contents, they are first saved as a Git object, and the notification offers **Undo Restore**, which puts them back byte for byte unless the file changed again; Git keeps that object until its next garbage collection. Save or revert unsaved editor changes to the file first: the restore refuses to run while they exist, since saving them afterwards would overwrite it, and the preview warns that it shows them. Historical previews use VS Code text documents; binary restoration does not require a text preview.

**Compare** accepts branch names, tags, or commits. Ref/commit menus also provide **Compare with…**, and selecting two rows offers **Compare Selected**. The result lists changed files and commits unique to each endpoint, with native VS Code diffs that leave the comparison dialog open. **Show changes introduced since the common ancestor** compares that ancestor with the right revision; the unique-commit lists still compare the two endpoints. Clicking a listed commit opens graph context beginning at that commit and its ancestors.

## Reflog and multiple commits

The **Reflog** tab at the left of the header, also opened by **Settings & Tools → Recover lost commits (reflog)**, lists every move of HEAD and the local branches, newest first: when it happened, which ref moved, the operation (commit, checkout, reset, rebase, merge and so on, coloured by what it does to history), what Git recorded, and the commit the ref moved to. Choose one ref or one operation, or filter by text in the message, the commit subject or the commit ID.

A commit marked **Not on any branch** is one that no branch, tag, remote branch or HEAD still reaches, such as the commit before an amend or a reset, or the work on a deleted branch. **Only commits no branch reaches** lists just those. Each row's **Show in Graph** opens the commit's history in the graph, and its **⋯** menu offers **Create Recovery Branch…**, which keeps the commit under a new branch without checking it out, **Check Out…** and **Reset…**, each with the same confirmation as in the graph. Git deletes unreachable commits once their reflog entries expire, after 30 days by default.

The tab you were on is remembered when the panel reopens. Searching, **Jump to HEAD** and **Show in Graph** return to the **Graph** tab.

## Statistics

The **Statistics** tab counts the commits on every branch the graph shows, or on one local branch, over the last 30 days, 90 days, year, or all time. It shows the number of commits, contributors and days with commits, a grid of commits per day over the last year (point at a day for its date and count), and every contributor with their commits, share and first and last commit. People are named as `.mailmap` names them, so someone who committed under several addresses counts once. **Count lines changed** adds the lines each contributor added and deleted outside merges; it reads every commit's changes, so it is slower on large repositories. Click a contributor to search the graph for their commits. Avatars are initials; Branchwise fetches nothing over the network.

Ctrl/Cmd-click selects individual commits; Shift-click selects a range. Select up to 100 commits for **Cherry-pick Selected** or **Revert Selected**. Review and adjust the execution order before confirming. Cherry-picks default to oldest first; reverts default to newest first. Merge commits require a common mainline parent choice. The native Git sequencer retains remaining commits if a conflict interrupts the batch; use the status strip's Continue, Abort, or Skip controls. Consecutive commits of the current branch can also be combined with **Squash N Commits…** (see [rebasing](#rebasing)).

## Keyboard navigation and activity

Arrow keys move between commit rows; Home/End move to the first/last loaded row. Enter opens details, Space selects, and Shift+F10 opens actions. Ctrl/Cmd+F or `/` opens and focuses history search when no dialog is active. Repository switches preserve filters and scroll position.

Running operations show their repository, action, and elapsed time. **Hide** closes the progress dialog while Git continues. Push, pull, fetch, remote branch and tag deletion, and checkouts that fetch first also offer **Stop Git**, which ends the Git process, for example when a server stops responding, and frees the repository for other actions. Git never waits for a password typed in a terminal; use a credential helper or SSH agent. **Git Activity** retains the last 100 operations from this view, including results that arrive after switching repositories or opening another dialog. Errors have selectable output and **Copy Error Details**. This activity list lasts for the current graph view; it is separate from Git's reflog.

Closing a menu or dialog restores focus to the original control or commit row. On narrow windows the workspace sidebar moves above the graph and dialog fields stack vertically. Superseded history queries cancel their Git processes; hiding a mutation's progress dialog leaves that operation running.
