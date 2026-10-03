# Provenance and licensing

This document records where Branchwise came from, which license applied at each stage, how the
code it inherited was replaced, and which outside projects it draws on. Statements link to the
records they rest on, so that they can be checked. It describes facts and the project's own
practice; it is not legal advice.

## Summary

| Stage                                                   | Repository                                                                | License                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Git Graph, up to commit `4af8583`                       | [mhutchie/vscode-git-graph](https://github.com/mhutchie/vscode-git-graph) | MIT                                                                       |
| Git Graph 1.5.0 and later                               | mhutchie/vscode-git-graph                                                 | A different, non-MIT license; **no code from these releases is included** |
| (neo) Git Graph 0.1.0 to 0.6.0, `asispts.neo-git-graph` | [asispts/neo-git-graph](https://github.com/asispts/neo-git-graph)         | MIT                                                                       |
| (neo) Git Graph up to 0.9.6, `jcfurey.neo-git-graph`    | [jcfurey/neo-git-graph](https://github.com/jcfurey/neo-git-graph)         | MIT, with both projects' notices                                          |
| Branchwise 0.9.7, after all inherited code was replaced | jcfurey/neo-git-graph, then imported here                                 | Apache License 2.0                                                        |
| Branchwise 0.9.8 onwards, `jcfurey.branchwise`          | [jcfurey/Branchwise](https://github.com/jcfurey/Branchwise) (this one)    | Apache License 2.0                                                        |

## Lineage

### 1. Git Graph (mhutchie)

[Git Graph](https://github.com/mhutchie/vscode-git-graph) is a VS Code extension by mhutchie.
At commit
[`4af8583a42082b2c230d2c0187d4eaff4b69c665`](https://github.com/mhutchie/vscode-git-graph/commit/4af8583a42082b2c230d2c0187d4eaff4b69c665),
whose `package.json` names version 1.4.6:

- [`LICENSE`](https://github.com/mhutchie/vscode-git-graph/blob/4af8583a42082b2c230d2c0187d4eaff4b69c665/LICENSE)
  is the MIT License, with the notice `Copyright (c) 2019-present, mhutchie`;
- `package.json` declares `"license": "MIT"`.

The 1.4.6 release (tag [`v1.4.6`](https://github.com/mhutchie/vscode-git-graph/blob/v1.4.6/LICENSE),
2019-04-30) has the same MIT `LICENSE`. From the 1.5.0 release (tag
[`v1.5.0`](https://github.com/mhutchie/vscode-git-graph/blob/v1.5.0/LICENSE), 2019-05-15),
`package.json` declares `"license": "SEE LICENSE IN 'LICENSE'"`, and `LICENSE` is a different
text. It grants permission to use, copy, modify and merge the software, and states that
permission is not granted to publish, distribute, sublicense or sell derivative works. The
[current `LICENSE`](https://github.com/mhutchie/vscode-git-graph/blob/HEAD/LICENSE) keeps those
terms. Branchwise includes no code, text or assets from Git Graph 1.5.0 or any later release.

### 2. (neo) Git Graph (asispts)

[asispts/neo-git-graph](https://github.com/asispts/neo-git-graph) continued Git Graph from
`4af8583`, which
[its README](https://github.com/asispts/neo-git-graph/blob/main/README.md#why-this-fork) describes
as the last MIT-licensed commit. It is released under the MIT License, with the notice
`Copyright (c) 2019 mhutchie. Fork (c) 2026-present asispts`
([`LICENSE`](https://github.com/asispts/neo-git-graph/blob/v0.6.0/LICENSE)), and published as
`asispts.neo-git-graph`, versions 0.1.0 to 0.6.0. The last of its commits that Branchwise built on
is `f8ed5df0f4fb1340f6a30d72a088f38a6b3e64fd`, recorded as the fork point in jcfurey/neo-git-graph's
[provenance baseline](https://github.com/jcfurey/neo-git-graph/blob/main/scripts/provenance-baseline.json).

### 3. jcfurey/neo-git-graph

[jcfurey/neo-git-graph](https://github.com/jcfurey/neo-git-graph), a fork of
asispts/neo-git-graph, continued it as (neo) Git Graph, `jcfurey.neo-git-graph`, through its 0.9.6
builds, then renamed it Branchwise. While it still contained inherited code, it was distributed
under the MIT License with both projects' notices.

In that repository every inherited line was replaced, module by module (see
[How inherited code was replaced](#how-inherited-code-was-replaced)). Once none was left, release
0.9.7 replaced the MIT notices in `LICENSE` with the standard text of the Apache License 2.0
([changelog, 0.9.7](https://github.com/jcfurey/neo-git-graph/blob/main/CHANGELOG.md#097---2026-09-26);
[decision D7](https://github.com/jcfurey/neo-git-graph/blob/main/docs/clean-room/readme-and-templates.md)).
The repository is kept as the record of where the code came from and how it was replaced.

### 4. jcfurey/Branchwise

This repository starts from a fresh history, so it contains no upstream commits:

- `a14b1e9`, the first commit, adds only `LICENSE`, the Apache License 2.0.
- `b94840d` imports Branchwise 0.9.7 as it stood at commit
  [`c504cb6`](https://github.com/jcfurey/neo-git-graph/commit/c504cb6) of jcfurey/neo-git-graph,
  without that repository's history. The provenance check, its records and the clean-room
  specifications were left in jcfurey/neo-git-graph, because they describe the upstream code and
  depend on that repository's history.

Branchwise is published on [Open VSX](https://open-vsx.org/extension/jcfurey/branchwise) as
`jcfurey.branchwise`.

## How inherited code was replaced

[Replacing inherited code](https://github.com/jcfurey/neo-git-graph/blob/main/docs/provenance.md)
in jcfurey/neo-git-graph describes the process in full and records how it was applied. In short:

- **Measurement.** A script ran `git blame` over every tracked file and counted the lines whose
  origin was `f8ed5df` or an earlier commit, following lines moved or copied between files. CI
  failed if any file had more inherited lines than
  [a recorded baseline](https://github.com/jcfurey/neo-git-graph/blob/main/scripts/provenance-baseline.json),
  which was lowered with each rewrite and now records a total of 0.
- **Code.** For each module, one person read the old code and wrote a specification of its
  behaviour without code or the old wording; the specification was reviewed for leaks; someone
  who had not read the old module then wrote the replacement from the specification and the tests,
  with the old file already deleted. The reviewer compared the result with the old module.
- **User-interface text.** Inherited strings were replaced by placeholders before the writer
  started, then written again in new words, with new translations, from a specification that did
  not quote them.
- **Configuration.** Values that an outside interface requires exactly, such as setting names,
  defaults and command IDs that users' settings depend on, were kept and recorded as such. Free
  choices were made afresh, and obsolete entries were dropped.
- **Coincidences.** Short lines that a rewrite matched word for word, such as an exported
  signature or a standard term, were reviewed and listed in
  [`provenance-reviewed.json`](https://github.com/jcfurey/neo-git-graph/blob/main/scripts/provenance-reviewed.json).
- **Assets.** The icons inherited from Git Graph were replaced with Branchwise's own in 0.9.7.

That document also states the limits of the measurement: blame counts are a floor, not proof, and
the written process is what makes each replacement independent. Its
[Rewritten modules](https://github.com/jcfurey/neo-git-graph/blob/main/docs/provenance.md#rewritten-modules)
table links each module to its specification and its rewrite commit.

## Licenses today

- **This repository and releases from 0.9.7:** the [Apache License 2.0](../LICENSE), declared as
  `"license": "Apache-2.0"` in `package.json`. `LICENSE` ships in every VSIX. There is no
  `NOTICE` file. Under section 5 of the license, contributions submitted to this repository are
  under the same terms unless their author states otherwise.
- **Earlier versions:** asispts/neo-git-graph and the jcfurey/neo-git-graph versions up to
  0.9.6, which contain code from Git Graph `4af8583`, were released under the MIT License and
  remain available under it. That license asks for its copyright and permission notice to be
  included in copies; the notices are quoted above.

## Ideas from other projects

Branchwise follows ideas from other extensions without copying their code, text or images:

- **[Git Graph Plus](https://github.com/the0807/git-graph-plus)** (`the0807.git-graph-plus`,
  Apache License 2.0). The features added in 0.9.9 follow ideas from it: search by tag, branch,
  author and committer; the Reflog and Statistics tabs; listing repositories cloned inside other
  repositories, not only submodules; push-status markers; the Jump to HEAD button; formatted
  commit messages with linked issue references; and copying a short or full commit ID. Only the
  ideas were taken; no code, text or images were copied, and Branchwise's implementations were
  written for this repository.
- **Git Graph.** The overall idea of a commit graph inside VS Code, and the setting names and
  defaults that users' settings depend on, carry over from the projects Branchwise began from, as
  described above.

## Third-party components

The extension is bundled with esbuild. The packaged `out/` files contain these packages, all
declared under the MIT License in their own `package.json` and `LICENSE` files:

| Bundle             | Packages                                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `out/extension.js` | `simple-git` and its dependencies `@simple-git/args-pathspec`, `@simple-git/argv-parser`, `@kwsites/file-exists`, `@kwsites/promise-deferred`, `debug`, `ms`, `supports-color`, `has-flag`; `@vscode/l10n` |
| `out/web.min.js`   | `preact`, `@preact/signals`, `@preact/signals-core`                                                                                                                                                        |
| `out/web.min.css`  | Generated by Tailwind CSS, which keeps its own license banner in the file                                                                                                                                  |

`package.json` lists the direct dependencies and `pnpm-lock.yaml` the exact versions. The license
texts of the bundled packages are in their own packages; the VSIX does not yet include them.
Development tools, such as TypeScript, esbuild, Vitest and oxlint, are not packaged.

## Names and trademarks

Branchwise is an independent project. It is not affiliated with or endorsed by mhutchie (Git
Graph), asispts ((neo) Git Graph), the0807 (Git Graph Plus) or Microsoft. Visual Studio Code is a
trademark of Microsoft Corporation, used here only to name the editor Branchwise runs in. Other
projects are named only to identify them.

## Keeping this record accurate

- Do not add code, text or images from Git Graph 1.5.0 or later, or from any project whose
  license does not allow it. Credit ideas taken from other projects in
  [Ideas from other projects](#ideas-from-other-projects).
- When a bundled dependency is added or removed, update
  [Third-party components](#third-party-components).
