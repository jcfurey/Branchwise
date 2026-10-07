# View preferences

Graph preferences belong to a repository path in the current VS Code workspace. Each repository
keeps its own choices; another workspace or clone starts with defaults. Changing these preferences
does not check out a branch or change Git refs.

| Choice                                                     | Repository switch                                  | Close and reopen graph / restart VS Code |
| ---------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| View mode, focus target, pause state, dimming              | Restored for each repository                       | Restored                                 |
| Show Remote Branches in Graph and each remote's eye toggle | Restored for each repository                       | Restored                                 |
| Hidden-branch patterns                                     | Restored for each repository                       | Restored                                 |
| Column widths                                              | Restored for each repository                       | Restored                                 |
| Hidden columns (Date, Author, ID)                          | Restored for each repository                       | Restored                                 |
| Active search, named search filters, vertical position     | Restored for each repository within the open panel | Reset                                    |
| Horizontal graph position                                  | Reset to the left edge                             | Reset to the left edge                   |
| Selected commits and expanded details                      | Cleared                                            | Cleared                                  |
| Size of docked commit details                              | Kept: one size for every repository                | Reset                                    |

Reloading an existing webview retains its search filters and vertical position as well as durable
preferences. Horizontal panning resets on reload; refreshing loaded history or resizing the graph
preserves it within the available scroll range. Selecting a commit can reveal its lane.

New repositories start in **Filter to branch**, with remotes visible and subtle dimming. In that
mode, the branch chosen on opening or switching follows **Show Current Branch by Default**; the
last filtered branch is temporary. Focus modes remember their target instead. **Clear focus**
stays cleared when returning to the repository, even though the selected focus mode is retained.

If a saved focus target was deleted or renamed, focus falls back to the current branch and keeps
the selected mode, dimming, and pause state. With detached HEAD or no current branch, it falls back
to **All branches** and clears pause. The fallback is saved, so recreating the old branch does not
silently restore the old target. Renames are not inferred from matching commit hashes.

Hiding the focused remote clears its target. Selecting a hidden remote branch reveals its remote
and enables **Show Remote Branches in Graph**; those updated choices are saved. Turning all remotes
off and back on preserves each remote's individual eye setting.

Hidden columns keep their widths, so a column shown again is as wide as before. Graph and Message
cannot be hidden. See [row height and columns](git-actions.md#row-height-and-columns).

Hidden-branch patterns never hide the checked-out branch or the selected one. Selecting or focusing
a branch that a pattern matches shows it without changing the patterns, so it is hidden again once
another branch is selected. See [hiding branches by name](git-actions.md#hiding-branches-by-name).

Deleting a repository's folder removes its saved preferences the next time the Workspace pane loads.
Existing focus choices in an open panel migrate to workspace storage the next time that repository
loads; previously saved column widths and remote visibility are retained.

## Settings

VS Code settings, unlike the choices above, apply to every repository; the
[README](../README.md#settings) lists them all. A change takes effect in the open graph at once.

`branchwise.conflictForecast` chooses which branches the
[conflict forecast](git-actions.md#conflict-forecast) tries against the checked-out branch:

| Value                      | Branches tried                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `localAndRemote` (default) | Local branches, and remote branches the graph shows with a commit in the last 30 days |
| `local`                    | Local branches only                                                                   |
| `off`                      | None: no mark, and no Git process is started for it                                   |

The remote branches tried follow the graph's choices for this repository: a hidden remote, a
hidden-branch pattern or **Show Remote Branches in Graph** turned off leaves branches out.

`branchwise.showUncommittedChanges` adds the row of uncommitted changes, which scans the working
tree. `branchwise.showSignatures` (on by default) marks signed commits with a small key, which
reads the loaded commits once more; turning it off saves about 10 ms for 300 rows and 40 ms for
3,000 (see [performance](performance.md)). The commit details still check signatures. See [commit signatures](git-actions.md#commit-signatures).

`branchwise.markAppliedCommits` (default `true`) marks the commits of a focused or filtered branch
whose change the checked-out branch already has, as after a cherry-pick or a rebase, with a muted
**applied**. Git compares patch IDs for that branch alone, and skips one with more than 2,000
commits the checked-out branch lacks. Turn it off to leave the marks out and start no comparison;
**Find Equivalent Commit** stays in the commit menu. See
[commits the checked-out branch already has](git-actions.md#commits-the-checked-out-branch-already-has).

`branchwise.showWorktrees` (default `true`) marks the commits your other worktrees have checked
out, with a dot for those with uncommitted changes. The dots come from a quick `git status` in up
to 20 worktrees, at most 3 seconds each; turning the setting off skips them. See
[worktrees in the graph](git-actions.md#worktrees-in-the-graph).

`branchwise.dragAndDrop` (default `true`) lets commit rows and local branches be dragged onto
branch labels in the graph and the Branches pane to cherry-pick, merge or rebase, each after a
confirmation. Turn it off if you drag by accident; every action stays in the menus. See
[drag and drop](git-actions.md#drag-and-drop).

`branchwise.dateSeparators` (default `true`) draws a faint line above the first commit of each
day and, once you scroll down, names the day of the topmost commit in a small label under the
column headings. Days follow `branchwise.dateType` and your local time zone. Turn it off for a
plainer graph; the date column is unchanged either way. See
[days in the graph](git-actions.md#days-in-the-graph).

`branchwise.commitHoverCards` (default `true`) shows a card with a commit's whole message, author,
date, IDs and change counts when the pointer rests on its message, or when the keyboard rests on
its row. Turn it off if the card gets in the way; the commit details hold the same information.
With it on, the message has no tooltip of its own.

`branchwise.showChangesColumn` (default `false`) adds a **Changes** column, such as **+12 −3**,
with the number of files in its tooltip. The counts are read only for the rows in sight, as you
scroll, so a long history costs no more than a short one. See
[commit cards and change counts](git-actions.md#commit-cards-and-change-counts).

`branchwise.overviewMarkers` (default `true`) shows the strip beside the commit table that marks
HEAD, branch tips and tags, the selection, the open commit and unpushed commits across
the whole loaded history, with a band for the rows on screen; click or drag on it to scroll.
Turn it off to give the table those 10 pixels back. See
[overview strip](git-actions.md#overview-strip).

### Branch previews and nearest branches

`branchwise.branchHoverPreview` (default `true`) highlights a branch's or tag's commits, more
lightly than branch focus, while the pointer rests on its label in the graph or its row in the
Branches pane. Turn it off if the highlight distracts you; **Focus this branch** still works.

`branchwise.showNearestBranch` (default `true`) names, in faint text after the message of a commit
without a branch label of its own, the nearest branch that contains it, such as "on main". It is
worked out from the loaded rows and costs no Git calls. See
[the Branches pane and branch focus](git-actions.md#branches-pane).

### Row density

`branchwise.rowDensity` sets how tall the graph's rows are, the same in every repository:

| Value               | Row height |
| ------------------- | ---------- |
| `compact`           | 20 pixels  |
| `default` (default) | 24 pixels  |
| `comfortable`       | 30 pixels  |

The open graph is redrawn at the new height at once. Compact rows stop at 20 pixels, the height of
the **⋯** button at the end of a row, so no control in a row gets smaller than it is by default;
branch and tag labels shrink by 2 pixels to fit. See
[row height and columns](git-actions.md#row-height-and-columns).

### Commit details position

`branchwise.commitDetailsPosition` chooses where a commit's details open:

| Value              | Where                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| `inline` (default) | Under the commit's row, moving the rows below it down                                   |
| `bottom`           | In a pane docked below the graph, across the whole width of the panel                   |
| `right`            | In a pane docked to the right of the graph, from the toolbar to the bottom of the panel |

With `bottom` or `right`, the graph scrolls on its own beside the pane, and the pane stays open
while you choose other commits. Drag the bar between them, or use its arrow keys, to resize the
pane; the size is a share of the window, kept separately for the two positions and for every
repository while the panel stays open. Changing the setting moves open details at once.
`branchwise.autoCenterCommitDetailsView` applies only to `inline`. See
[where the details open](git-actions.md#where-the-details-open).

### Single-key shortcuts

`branchwise.singleKeyShortcuts` (default `true`) lets single keys act on the focused commit row,
such as B for **Create Branch…** or Y to copy the short commit ID, and lets `?` open the list of
keyboard shortcuts. Turn it off if you use a screen reader that reads the graph with single-letter
commands, or an extension that sends single keys of its own. With it off, the menus stop showing
the keys and the shortcut sheet says they are off; arrow keys, Enter, Space, Escape, Shift+F10,
Ctrl/Cmd+F, `/` and Ctrl+Alt+G keep working. See
[keyboard navigation](git-actions.md#keyboard-navigation-and-activity).

### Custom issue links

`branchwise.issueLinks` links references to other trackers, such as Jira or Linear issue keys, in
the commit messages that the [commit details](git-actions.md#commit-details) show. It adds to the
GitHub and GitLab links, which keep working. Each entry is a JavaScript regular expression,
`pattern`, and the address it links to, `url`, in which `$0` stands for the whole match and `$1` to
`$9` for its groups. In `settings.json` a backslash is written twice.

For Jira keys such as `PROJ-123`:

```json
"branchwise.issueLinks": [
  { "pattern": "\\b[A-Z][A-Z0-9]+-\\d+\\b", "url": "https://jira.example.com/browse/$0" }
]
```

For Linear issues of a team whose key is `ENG`, linking `ENG-42` to the issue's page:

```json
"branchwise.issueLinks": [
  { "pattern": "\\bENG-(\\d+)\\b", "url": "https://linear.app/your-workspace/issue/ENG-$1" }
]
```

When several forms start at the same place in a message, the built-in ones come first, then the
entries in their order; where links would overlap, the one that starts first wins, so links never
nest, and nothing inside inline or fenced code is linked. Matched text is escaped before it goes
into the address.

Entries are checked when the setting is read, and an entry is skipped, with one warning in the
**Branchwise** output channel, when its pattern is empty, longer than 200 characters, not a valid
regular expression or able to match empty text, or when its `url` is not an `http:` or `https:`
address. A pattern that backtracks badly cannot freeze the graph: patterns run in a separate worker,
which is stopped when a message takes longer than a quarter of a second, and that message then
shows only the built-in links. Only the first 10,000 characters of a message are searched, for 100
custom links at most.

## Theme colours

Branchwise contributes these colours, which a colour theme or `workbench.colorCustomizations` in
your settings can change:

| Colour                                             | Used for                                                      | Default in every theme kind                   |
| -------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `branchwise.graphLane1` … `branchwise.graphLane12` | The graph's lanes, in order, while `graphColours` is not set  | The 12 colours of `graphColours`              |
| `branchwise.unpushed`                              | The dot before a commit that no remote branch has yet         | `gitDecoration.modifiedResourceForeground`    |
| `branchwise.conflict`                              | The mark on a branch that would conflict if merged into yours | `gitDecoration.conflictingResourceForeground` |

The defaults are the colours the graph has always used, in dark, light and both high contrast
themes, so nothing changes until a theme or you set one. Setting `branchwise.graphColours` in the
user, workspace or folder settings replaces the lane colours with that list, whatever the theme
says. For example, to make the first lane orange in the Default Dark Modern theme only:

```json
"workbench.colorCustomizations": {
  "[Default Dark Modern]": { "branchwise.graphLane1": "#ff8800" }
}
```

High contrast themes outline a selected or hovered commit row, and draw lines and borders in the
theme's contrast border colour. With forced colours, such as a Windows contrast theme, focus and
selection are outlined in the system highlight colour, and the unpushed dot, the conflict mark and
branch and tag labels keep system colours.
