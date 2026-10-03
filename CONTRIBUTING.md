# Contributing to Branchwise

Bug reports and feature requests go in [Issues](https://github.com/jcfurey/Branchwise/issues);
the forms ask for your Git and VS Code versions and any remote connection. For a change, open a
pull request against `main`; CI tests it on Linux, macOS and Windows.

## Set up

You need Node.js 24, Git, and the pnpm version pinned in `package.json`, which Corepack provides:

```sh
git clone https://github.com/jcfurey/Branchwise.git
cd Branchwise
corepack enable pnpm
pnpm install --frozen-lockfile
```

Open the folder in VS Code and press F5. The **Run Extension** configuration builds the extension
and opens an Extension Development Host with your working copy loaded. **Terminal → Run Task →
Watch** rebuilds the bundles and type-checks as you edit.

To try a packaged build in your everyday editor:

```sh
pnpm run package:vsix --out branchwise.vsix
code --install-extension branchwise.vsix --force
```

## Where things are

| Path                         | What it holds                                                                |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `src/backend/`               | Git queries and actions, run through simple-git                              |
| `src/extension/`             | The extension host: commands, the webview panel, watchers and the RPC bridge |
| `src/webview/`               | The graph page, written in Preact and styled with Tailwind                   |
| `tests/`                     | Vitest tests for the backend, the extension host and the webview             |
| `tests-ext/`                 | Tests that drive the graph inside a real VS Code                             |
| `l10n/`, `package.nls*.json` | Translations of the page and of the manifest                                 |
| `walkthroughs/`              | The Getting Started walkthrough                                              |
| `docs/`                      | The user guide and the project's notes                                       |

## Check a change

CI runs these; run the ones your change touches before you push:

```sh
pnpm run format         # oxfmt; pnpm run format:fix rewrites files
pnpm run lint           # oxlint; pnpm run lint:fix applies safe fixes
pnpm run typecheck
pnpm test               # unit and component tests
pnpm run test:ext       # VS Code UI tests; on Linux without a display, prefix xvfb-run -a
pnpm run l10n:check     # after changing text the page shows
pnpm run check:notices  # after adding, removing or updating a runtime dependency
```

Text the graph shows comes from the translation bundles, and a lint rule rejects hard-coded
strings in the webview. After adding or changing a string, run `pnpm run l10n:export` and add the
Simplified and Traditional Chinese translations in `l10n/`.

`THIRD-PARTY-NOTICES.txt` reproduces the license of every package bundled into the extension.
It is generated from what esbuild bundles: after a dependency change, run `pnpm run notices` and
commit the result. A package with a license other than MIT, ISC, BSD or Apache 2.0, or without a
license text, stops the script until someone reviews it.

Add a line under **Unreleased** in the [changelog](CHANGELOG.md) for anything a user would notice.

## More

- [VS Code UI tests](docs/testing.md): running one scenario, failure artifacts, and the
  minimum-version check.
- [Graph performance](docs/performance.md): the benchmarks and what they measured.
- [Packaging and releases](docs/packaging.md): building a VSIX and publishing a release.
