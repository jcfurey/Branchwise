# Packaging and releases

The checked-in manifest is the source of truth: `jcfurey.branchwise@0.9.9`.
Keep `publisher` and `name` stable so that installed copies upgrade in place. When changing
metadata, keep the README's [Origins and license](../README.md#origins-and-license) section, which
credits the projects Branchwise began from; the manifest does not name them.

Branchwise is published to [Open VSX](https://open-vsx.org/extension/jcfurey/branchwise). The
release workflow can also publish to the VS Marketplace once a token for it is configured.

## Build and install a package

Use Node.js 24 and the pnpm version pinned in `package.json`, which Corepack provides:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run package:vsix
code --install-extension ./branchwise-0.9.9.vsix --force
```

`package:vsix` checks the extension identity, then runs vsce. Its prepublish hook cleans the
output, runs the type and lint checks, checks that `THIRD-PARTY-NOTICES.txt` lists the licenses
of exactly the packages the bundles contain, and builds the production extension and webview. vsce puts
the manifest version in the default file name; for a fixed name, use
`pnpm run package:vsix --out branchwise.vsix`.

The extension is bundled, so the VSIX holds the runtime assets, translations, the user guide, the
walkthroughs, `LICENSE` and `THIRD-PARTY-NOTICES.txt`, without development dependencies or
TypeScript source. `.vscodeignore` lists
exactly what is packaged. Reload an active VS Code window after installing.

## Verify a package

```sh
pnpm run test:release
pnpm run test:package branchwise.vsix
```

The package test uses temporary extension, user-data and repository directories. It installs a
minimal older build of the same extension, installs the new VSIX, and checks that only the new
version remains. It then activates the package, checks the shipped assets, opens the graph, and
opens the guide and walkthrough. It downloads stable VS Code unless `NGG_VSCODE_PATH` points to a
VS Code executable. On Linux without a display, run it under `xvfb-run -a`, or set
`NGG_HEADLESS=1`. It never publishes anything.

## Release a version

1. Choose the version and set it in `package.json`. Move the changelog's **Unreleased** entries
   under a dated `## [x.y.z] - YYYY-MM-DD` heading, and update the version in the identity line
   and VSIX file name at the top of this file.
2. Check that they agree: `pnpm run check:release vx.y.z`.
3. Merge to `main` and wait for CI to pass.
4. Tag the merged commit and push the tag:

   ```sh
   git tag vx.y.z
   git push origin vx.y.z
   ```

5. Approve the run in **Actions → publish** when it waits for the `release` environment.

The [publish workflow](../.github/workflows/publish.yml) first rejects an unexpected publisher or
name, or a tag that does not match the manifest version, the changelog and this file. It then
runs the whole [CI workflow](../.github/workflows/ci.yaml) from the tagged commit: formatting,
lint, type and translation checks, the unit and component tests, the VS Code UI tests on Linux,
macOS and Windows, the minimum-version check, and the package test. The publish job runs only
after CI passes. It downloads the VSIX that CI tested, checks its identity against the tag, checks
any registry tokens, and publishes that same file without rebuilding it.

Publishing to two registries is not atomic, so a failure can leave a version on one of them. Fix
the cause and run the workflow again for the same tag: both publish commands skip a version that
is already there.

To rehearse a release, run **Actions → publish → Run workflow**. A manual run checks and tests the
manifest's version as if it were tagged, packages it and checks any tokens, but never publishes.

## One-time setup

### The `release` environment

Create it under **Settings → Environments → New environment**, named `release`:

- Add yourself as a required reviewer. Every run waits for approval, dry runs included. With a
  single maintainer, leave **Prevent self-review** off so that you can approve your own runs.
- Under **Deployment branches and tags**, allow the `main` branch and tags matching `v*`.

### Open VSX

The workflow publishes to Open VSX through
[trusted publishing](https://github.com/eclipse-openvsx/openvsx/tree/main/cli#trusted-publishing):
the job exchanges its GitHub OIDC token for a publishing token that lasts a few minutes, so no
long-lived token is stored in GitHub. Sign in to Open VSX as an owner of the `jcfurey` namespace,
open [Trusted publishers](https://open-vsx.org/user-settings/trusted-publishers), and register a
GitHub Actions publisher for `jcfurey.branchwise` with the repository `jcfurey/Branchwise`, the
workflow file `publish.yml`, and the environment `release`. Pinning the environment means only a
run you approved can publish.

Instead, you can create an [access token](https://open-vsx.org/user-settings/tokens) and store it
as the `release` environment secret `OPEN_VSX_TOKEN`. When that secret is set, the workflow checks
it before publishing and uses it in place of trusted publishing.

### VS Marketplace (optional)

Without a token, the workflow skips the VS Marketplace and says so in the run's notices. To
publish there too, create the `jcfurey` publisher as the
[publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
describes, and store its token as the `release` environment secret `VS_MARKETPLACE_TOKEN`:

```sh
gh secret set VS_MARKETPLACE_TOKEN --env release
```

The workflow then checks the token before publishing anything and publishes the same VSIX to both
registries.

### Repository settings

- Add a ruleset on `main` that requires the checks `lint (24)`, `test (ubuntu-latest)`,
  `test (macos-latest)` and `test (windows-latest)`.
- Enable Issues, which the manifest, the README and the issue forms link to.
- Enable Dependabot alerts and security updates, so that `.github/dependabot.yml` takes effect.

Third-party actions are pinned to commit SHAs, and `actionlint` passes on both workflows. CI keeps
UI diagnostics for 14 days, and benchmarks and the VSIX for 30.
