# Packaging and releases

The checked-in manifest is the source of truth: `jcfurey.branchwise@0.9.7`.
Keep `publisher` and `name` stable so local VSIX installations upgrade the existing installation.
When changing metadata, keep the README's [Origins and license](../README.md#origins-and-license)
section, which credits the projects Branchwise began from; the manifest does not name them.

## Build and install

Use Node.js 24 and the pnpm version pinned in `package.json`, which Corepack provides:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run package:vsix
code --install-extension ./branchwise-0.9.7.vsix --force
```

`package:vsix` validates the extension identity, then invokes VSCE. Its prepublish hook cleans the output,
runs type and lint checks, and builds the production extension and webview. VSCE uses the manifest
version in the default filename. For a fixed output name, use:

```sh
pnpm run package:vsix --out branchwise.vsix
```

The extension is bundled, so the VSIX contains runtime assets, translations, documentation, and
walkthroughs without development dependencies or TypeScript source. Reload an active VS Code window
after installation. Building and testing do not install into your normal VS Code profile.

## Verify a package

```sh
pnpm run test:release
pnpm run test:package
# Or, for a custom filename:
pnpm run test:package branchwise.vsix
```

The package test uses temporary extension, user-data, and repository directories. It installs a
minimal older build of the same extension, installs the new VSIX, and checks that only the new
version remains listed. It then activates the installed package, checks shipped assets, opens the graph, and opens
the guide and walkthrough. Temporary directories are removed afterward.

It downloads stable VS Code unless `NGG_VSCODE_PATH` points to an existing VS Code executable.
On Linux without a display, run `xvfb-run -a pnpm run test:package`, or set `NGG_HEADLESS=1` to use
Electron's headless platform. The test never publishes an extension.

## Release validation

Update the manifest version and documentation together, then validate locally with:

```sh
pnpm run check:release v0.9.7
```

Pushing a matching `v<version>` tag triggers publishing. The workflow first rejects an unexpected
publisher/name or mismatched tag. It then calls the CI workflow from that same commit, including
format, lint, type and localization checks, release-check tests, backend/extension/webview tests,
three-platform VS Code UI tests, Linux failure-diagnostic/minimum-version smoke checks, and the
Linux package upgrade/activation test. See [VS Code UI tests](testing.md) for local commands and
artifacts.

The publish job runs only after validation succeeds, in the `release` environment, whose required
reviewer approves each run and which holds the `VS_MARKETPLACE_TOKEN` and `OPEN_VSX_TOKEN`
secrets for the `jcfurey` publisher. It downloads the tested VSIX artifact, checks its embedded
identity/version against the tag, and checks both tokens with `vsce verify-pat` and
`ovsx verify-pat` before publishing anything, so an expired token cannot leave a release on one
registry only. It then passes that file to both registries without rebuilding. Setting up
publisher accounts and credentials is separate from local packaging.

Run the workflow manually (**Actions → publish → Run workflow**) for a dry run: it validates and
tests the manifest's version as if it were tagged, packages it, and verifies both tokens, but
never publishes; only a pushed tag does. Third-party actions are pinned to commit SHAs, CI keeps
UI diagnostics for 14 days and benchmarks and the VSIX for 30, and `actionlint` passes on both
workflows.

This uses GitHub's [reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
and [workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data).
