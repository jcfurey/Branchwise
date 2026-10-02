<div align="center">
  <img src="resources/icon.png" alt="Branchwise logo" height="128" />
  <h1>Branchwise</h1>
  <p><strong>A visual Git graph for VS Code.</strong><br />
  Read your history, focus on one branch, and run everyday Git without leaving the graph.</p>
  <p>
    <a href="https://open-vsx.org/extension/jcfurey/branchwise"><img src="https://img.shields.io/open-vsx/v/jcfurey/branchwise?label=Open%20VSX" alt="Open VSX version" /></a>
    <a href="https://open-vsx.org/extension/jcfurey/branchwise"><img src="https://img.shields.io/open-vsx/dt/jcfurey/branchwise" alt="Open VSX downloads" /></a>
    <a href="https://github.com/jcfurey/Branchwise/actions/workflows/ci.yaml"><img src="https://img.shields.io/github/actions/workflow/status/jcfurey/Branchwise/ci.yaml?branch=main&label=CI" alt="CI status" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/jcfurey/Branchwise" alt="License" /></a>
  </p>
</div>

## Install

- **VSCodium and other editors that use Open VSX:** search for **Branchwise** in the Extensions
  view, or run `codium --install-extension jcfurey.branchwise`.
- **Visual Studio Code:** download the `.vsix` file from
  [Branchwise on Open VSX](https://open-vsx.org/extension/jcfurey/branchwise), then choose
  **Extensions → ⋯ → Install from VSIX…** and select it.

Branchwise needs VS Code 1.125 or newer, or an editor based on it, and Git.

## Getting started

Open the graph with the Branchwise button in the Source Control view, the Branchwise item in the
status bar, or **Branchwise: View Graph (git log)** in the Command Palette.

The **Get started with Branchwise** walkthrough on the Welcome page shows how to read the graph,
act on commits and branches, and recover from mistakes. Reopen it from **Getting Started** in the
graph's settings cog, next to **Learn more**, which opens the [user guide](docs/git-actions.md).

## Features

### Read your history

- **One graph for everything:** branches, tags, remotes, stashes and uncommitted changes, drawn
  with rounded or angular lanes in colours you choose.
- **Commit details:** the full message, the changed files as a tree, and a diff for each file.
  Select the uncommitted changes row to browse staged, unstaged, untracked and conflicted files.
- **Search all of history** by message, commit ID, author, committer, branch or tag name, date
  or path, typed straight into the search box as `author:`, `tag:` and so on. Follow a file
  through renames, save filters for each repository, and jump back to HEAD in one click.
- **Large and wide graphs:** tens of thousands of commits lay out in milliseconds. Resize and
  scroll the graph column; selecting a commit brings its lane into view.

### Focus on what matters

- **Branch focus:** keep one branch's direct history, or all of its ancestors, in full colour
  and dim everything else, without checking anything out. Pause, resume or clear it at any time.
- **Hide remotes one at a time** with the eye button beside each remote. Only the view changes,
  never your refs.
- **Branches pane:** local branches, remotes, tags and stashes beside the graph, with checkout,
  fetch, apply and pop a click away.

Focus, hidden remotes, column widths and searches are remembered for each repository; see
[View preferences](docs/preferences.md).

### Work from the graph

- **Branches and tags:** create, check out, rename, merge and delete branches; create, delete and
  push tags; check out a remote branch into a new or existing tracking branch.
- **Commits:** check out, cherry-pick, revert or reset to a commit. Select several commits to
  cherry-pick or revert them in the order you choose, or create a fixup commit.
- **Rebase** onto another branch while keeping merges, or reorder, reword, squash and drop
  commits in an interactive rebase.
- **Review before you sync:** see incoming and outgoing commits before a push or pull, apply only
  the fast-forward you reviewed, and force-push only with an explicit lease.
- **Stashes and conflicts:** save, apply, pop and drop stashes; continue, skip or abort an
  interrupted merge, rebase or cherry-pick; open conflicted files in the merge editor.

Every change asks for confirmation first. Running Git commands show their progress, and push,
pull and fetch can be stopped.

### Recover and investigate

- **Reflog tab:** every move of HEAD and your branches, filtered by ref, operation or text, with
  commits that are no longer on any branch marked so you can keep them on a new branch.
- **Compare** two branches, tags or commits, or only the changes since their common ancestor, and
  restore a file's earlier contents.
- **Bisect:** find the commit that introduced a regression with a guided `git bisect`.
- **Clean up** local branches that are already merged.

### See who works on what

- **Statistics tab:** commits, contributors and active days for every branch or one, over a
  chosen period, with a year of daily activity and each contributor's share, optionally with
  lines added and deleted. Contributors are merged through `.mailmap`.

### Repositories and remotes

- **Multi-repository workspaces**, including initialized submodules and their nested submodules,
  with ahead and behind counts, submodule pointer review, and fetch and update across repositories.
- **Remotes, upstreams and worktrees:** add, rename and remove remotes, set upstream tracking, and
  manage worktrees.
- **Remote development** over Remote - SSH, WSL, Dev Containers and Codespaces.
- **Keyboard navigation** throughout, in English, Simplified Chinese or Traditional Chinese.

The [user guide](docs/git-actions.md) describes every action in detail.

## Settings

All settings start with `branchwise.`.

| Setting                       | Default         | Description                                                  |
| ----------------------------- | --------------- | ------------------------------------------------------------ |
| `autoCenterCommitDetailsView` | `true`          | Centre an opened commit's details vertically                 |
| `dateFormat`                  | `"Date & Time"` | Show dates as `"Date & Time"`, `"Date Only"` or `"Relative"` |
| `dateType`                    | `"Author Date"` | Show each commit's `"Author Date"` or `"Commit Date"`        |
| `graphColours`                | 12 colours      | Colours of the graph's lanes, in order                       |
| `graphStyle`                  | `"rounded"`     | Lines that change lanes: `"rounded"` or `"angular"`          |
| `initialLoadCommits`          | `300`           | Commits first loaded for a repository or branch              |
| `loadMoreCommits`             | `100`           | Commits added by **Load Older Commits**                      |
| `maxDepthOfRepoSearch`        | `0`             | Folder depth searched for repositories                       |
| `showCurrentBranchByDefault`  | `false`         | Open showing only the checked-out branch                     |
| `showUncommittedChanges`      | `true`          | Show the uncommitted changes row                             |
| `tabIconColourTheme`          | `"colour"`      | Graph tab icon in `"colour"` or `"grey"`                     |

## Upgrading from (neo) Git Graph

Branchwise used to be called (neo) Git Graph and installed as `jcfurey.neo-git-graph`. If you
have that extension, or `asispts.neo-git-graph`, uninstall it so that Source Control shows one
graph button. The first time Branchwise starts, it copies your settings from their
`neo-git-graph.` names to `branchwise.`, keeping any you have already set under the new name.

## Contributing

Bug reports and feature requests are welcome in
[Issues](https://github.com/jcfurey/Branchwise/issues). To build Branchwise from source, run its
tests or send a change, see [Contributing](CONTRIBUTING.md). The [changelog](CHANGELOG.md) lists
what each release changed.

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
