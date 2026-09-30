<div align="center">
  <img src="resources/icon.png" alt="Branchwise icon" height="128" />
  <h1>Branchwise for Visual Studio Code</h1>
  <p>Visual Git history, branch focus, repository workflows, and devcontainer support.</p>
  <p>
    <a href="#features">Features</a> ·
    <a href="#installation">Installation</a> ·
    <a href="#status-and-roadmap">Status and roadmap</a> ·
    <a href="#settings">Settings</a> ·
    <a href="#contributing">Contributing</a> ·
    <a href="#origins-and-license">Origins and license</a>
  </p>
  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/jcfurey/Branchwise" alt="License" /></a>
  </p>
</div>

<br />

## Features

- **Branch focus**: Choose **View → Focus direct history** or **Focus all ancestors** to keep related history bright and dim unrelated branches. Choose subtle or strong dimming, pause/resume the target, or clear focus without changing checkout. These choices are saved per repository across reopening and VS Code restarts.
- **Individual remote visibility**: Hide each remote with its eye button in the Branches pane. Choices survive reopening and repository switches; hiding changes the view, not Git refs. Selecting a hidden branch reveals it, and an explicit revision search can still open hidden history.
- **Wide and deep graphs**: Resize the Graph column or scroll its lanes with the scrollbar, trackpad, or Shift+wheel. Sticky headings keep the scrollbar accessible; selecting a commit reveals its lane, and **Reveal selected lane** returns to it after panning. Refresh preserves manual positioning and commit text stays fixed.
- Review push/pull commits, fetch across workspace repositories, and apply reviewed fast-forward updates.
- Compare and stage submodule pointers, clean up merged local branches, and find regressions with guided Git bisect.

- **Workspace overview**: Inspect branches, local changes, ahead/behind counts, and submodule revisions; initialize, sync, or update nested submodules
- **History search**: Search all repository history by message, SHA, author, date, or path, follow file renames, and save filters per repository
- **Compare and restore**: Compare revisions or changes since their common ancestor, inspect unique commits and file diffs, and restore historical file contents while preserving staged changes
- **Reflog recovery**: Find older branch/HEAD positions, jump to their graph context, and create recovery branches
- **Ordered commit actions**: Select multiple commits for cherry-pick or revert, create staged fixups, and arrange fixup/squash commits in the interactive rebase editor
- **Navigation and activity**: Keyboard navigation, per-repository scroll and filters, compact repository tools, and operation progress with copyable errors
- **Repository tools**: Configure remotes and upstreams, inspect ahead/behind status, and manage worktrees
- **Recovery and stashes**: Continue, abort or skip interrupted operations; inspect and resolve conflicts; save, inspect, apply, pop and drop stashes
- **Rebase**: Preserve merges when rebasing onto another branch, or reorder, reword, squash and drop commits in a linear interactive plan
- **Remote ref management**: Choose a remote for tag pushes, delete remote branches/tags with confirmation, and push rewritten history with an explicit force-with-lease check
- **Remote actions**: Push local branches to a chosen remote, set upstream tracking, pull the current branch with fast-forward only, and fetch updates with optional pruning
- **Remote branch checkout**: Reuse and fast-forward an existing local branch, or create a new tracking branch
- **Branches pane**: Browse local branches, remotes, tags and stashes beside the graph; select or focus a branch, check out, fetch or apply inline, and hide individual remotes or all remote branches
- **Graph view**: See branches, tags, and uncommitted changes in one graph. Click the uncommitted changes row at the top (or press Enter) to browse unstaged, staged, untracked, and conflicted files, then select a file to open its diff or merge editor.
- **Commit details**: Select a commit to open a panel with its full message, the files it changed and a diff for each file
- **Branch actions**: Create, check out, rename, delete and merge branches from the graph
- **Tag actions**: Create and delete tags, and push them to a remote
- **Commit actions**: Check out, cherry-pick or revert a commit, or reset the current branch to it
- **Multi-repo**: Work with multiple repositories in one workspace, including initialized submodules and their nested submodules
- **Repository selection**: Click a repository's Branchwise button in Source Control to open its graph or switch the existing graph to that repository
- **Remote development**: Use Branchwise while VS Code is connected to a remote machine or container through Remote - SSH, WSL, Dev Containers or Codespaces
- **Languages**: English, Simplified Chinese, and Traditional Chinese

See [Working from the graph](docs/git-actions.md) for the available actions and their behavior.
See [View preferences](docs/preferences.md) for what is saved per repository and when navigation resets.

## Installation

Build Branchwise from this checkout using **Node.js 24**, **pnpm 11.15.1** (pinned in `package.json`), and Git:

```sh
git clone https://github.com/jcfurey/Branchwise.git
cd Branchwise
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run package:vsix
code --install-extension ./branchwise-0.9.7.vsix --force
```

Alternatively, use **Extensions → … → Install from VSIX…** and select the generated file.
VS Code **1.125.0 or newer** is required. Reload the VS Code window after upgrading an active extension.

Branchwise installs as `jcfurey.branchwise`. Builds before the rename installed as
`jcfurey.neo-git-graph`; uninstall that extension, and `asispts.neo-git-graph` if you have it, so
Source Control shows one graph button. The first time Branchwise starts, it copies your user and
workspace settings from their `neo-git-graph.` names to `branchwise.`, keeping any you have already
set under the new name. It leaves the old entries in place.

See [Packaging and releases](docs/packaging.md) for package verification and release validation.
See [VS Code UI tests](docs/testing.md) for individual scenarios, failure artifacts, and
minimum-version compatibility checks.

After installing, the **Get started with Branchwise** walkthrough appears on the Welcome page. Reopen it any time with the **Getting Started** entry in the graph's settings cog.

## Status and roadmap

Branchwise already includes the Preact webview, request/response repository workflows, branch
focus, individual remote visibility, horizontal graph navigation, and browsing of uncommitted
changes, all described above. Per-repository view preferences, graph geometry and theme regression
coverage, large-repository performance measurements, and UI failure diagnostics have also shipped.
See the [changelog](CHANGELOG.md) for implemented changes.

The backlog reviewed 2026-09-25 is complete; [todo.md](todo.md) records each item's acceptance
criteria and how it was verified. Row virtualization and ancestry caching remain deferred; see the
[performance report](docs/performance.md).

## Settings

All settings use the `branchwise` prefix.

| Setting                       | Default         | Description                                                  |
| ----------------------------- | --------------- | ------------------------------------------------------------ |
| `autoCenterCommitDetailsView` | `true`          | Centre an opened commit's details vertically                 |
| `dateFormat`                  | `"Date & Time"` | Show dates as `"Date & Time"`, `"Date Only"` or `"Relative"` |
| `dateType`                    | `"Author Date"` | Show each commit's `"Author Date"` or `"Commit Date"`        |
| `fetchAvatars`                | `false`         | No effect; avatars were removed                              |
| `graphColours`                | 12 defaults     | Colours of the graph's lanes, in order                       |
| `graphStyle`                  | `"rounded"`     | Lines that change lanes: `"rounded"` or `"angular"`          |
| `initialLoadCommits`          | `300`           | Commits first loaded for a repository or branch              |
| `loadMoreCommits`             | `100`           | Commits added by Load Older Commits                          |
| `maxDepthOfRepoSearch`        | `0`             | Folder depth searched for repositories                       |
| `showCurrentBranchByDefault`  | `false`         | Open showing only the checked-out branch                     |
| `showUncommittedChanges`      | `true`          | Show the uncommitted changes row                             |
| `tabIconColourTheme`          | `"colour"`      | Graph tab icon in `"colour"` or `"grey"`                     |

## Contributing

Please use [Issues](https://github.com/jcfurey/Branchwise/issues) for bug reports, feature requests, and discussion.

See [Status and roadmap](#status-and-roadmap) for what has shipped and where the project is heading.

## Origins and license

Branchwise began as a fork of [asispts/neo-git-graph](https://github.com/asispts/neo-git-graph),
which continued mhutchie's [Git Graph](https://github.com/mhutchie/vscode-git-graph) from
[`4af8583`](https://github.com/mhutchie/vscode-git-graph/commit/4af8583a42082b2c230d2c0187d4eaff4b69c665),
its last commit under the MIT License. Later Git Graph releases use a different license, and no code
from them is included.

Branchwise has since replaced everything it inherited from both projects, module by module, in
[jcfurey/neo-git-graph](https://github.com/jcfurey/neo-git-graph), whose
[Replacing inherited code](https://github.com/jcfurey/neo-git-graph/blob/main/docs/provenance.md)
describes how. This repository starts from the result. Branchwise is released under the
[Apache License 2.0](LICENSE). Earlier versions, which still contained inherited code, were
released under the MIT License with both projects' copyright notices. Branchwise is not affiliated
with or endorsed by either project.
