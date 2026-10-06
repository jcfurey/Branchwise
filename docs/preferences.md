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
| Active search, named search filters, vertical position     | Restored for each repository within the open panel | Reset                                    |
| Horizontal graph position                                  | Reset to the left edge                             | Reset to the left edge                   |
| Selected commits and expanded details                      | Cleared                                            | Cleared                                  |

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
