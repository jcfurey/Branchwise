# VS Code UI tests

Use Node.js 24 and the pnpm version pinned in `package.json`. Corepack, which ships with Node.js,
provides it:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run test:ext
```

Scripts and CI-like shells have no terminal to answer prompts. Set
`COREPACK_ENABLE_DOWNLOAD_PROMPT=0` so Corepack downloads the pinned pnpm without asking. If pnpm
stops because `node_modules` was installed from another store, reinstall with
`pnpm install --frozen-lockfile --config.confirm-modules-purge=false`. After that,
`pnpm run format`, `pnpm test`, and `pnpm run typecheck` run without a terminal.
`pnpm run clean:all` removes build output, downloaded VS Code test builds, test results, and
packaged VSIX files.

The runner downloads stable VS Code and creates a disposable repository, user profile, and
extensions directory. It does not use your normal VS Code profile. Set `NGG_VSCODE_PATH` to an
existing VS Code executable to avoid that download. On Linux without a display, prefix the command
with `xvfb-run -a`, or set `NGG_HEADLESS=1`.

## Run one scenario

Compile once, then select a test by its title with Mocha's `--grep`:

```sh
pnpm run compile
pnpm run compile-tests
pnpm exec vscode-test --grep 'hides individual remotes' --bail
pnpm exec vscode-test --grep 'checks VS Code compatibility and graph controls' --bail
```

Each invocation gets a fresh profile and disposable Git fixtures. The smoke scenario checks
activation, graph loading, branch focus, and hiding/restoring a remote. It does not depend on
another scenario having run first.

## Diagnose a failure

Artifacts go to `test-results/`, or the absolute/relative directory in `NGG_ARTIFACTS`:

- `run.json` records the actual VS Code version, requested version, platform, and log directory.
- `failure-*/failure.json` contains the original error, scenario, capture stage, and any capture errors.
- `failure-*/workbench.png` shows the whole VS Code window.
- `failure-*/webview.txt` and `webview.html` preserve the graph's visible text and DOM.
- `failure-*/browser.jsonl` retains the latest 500 console, uncaught exception, and browser log events
  across workbench/webview targets and reloads, with timestamps and scenario names.
- `vscode-logs/` retains VS Code's own logs, including `exthost.log` and extension output channels.

Polling failures capture before scenario cleanup restores a theme, viewport, or repository.
Assertion failures capture in teardown; setup failures are also reported. If a renderer has died,
the report records unavailable screenshot/DOM captures and still saves the error and browser logs.
VS Code writes its logs directly to the artifact directory, so they survive even an early startup
failure. Runner output is also retained by the verification command below.

## Verify diagnostics and minimum compatibility

```sh
pnpm run test:ui-harness
```

This first tests diagnostics with a disconnected renderer, then runs the smoke scenario with an
intentional timeout, visible marker, browser console/uncaught errors, and an extension log marker.
It requires a valid screenshot, DOM, the original failure, both browser errors, and extension logs.
An arbitrary nonzero exit is insufficient. It reruns that scenario alone with the fault removed,
then runs it on the minimum VS Code version when stable differs. CI runs this check on Linux and
uploads the artifacts even on failure; the full stable suite also runs on Windows and macOS.

The minimum comes from `engines.vscode` in `package.json`. Exact-version runs assert the version
inside the running extension host. `NGG_VSCODE_VERSION=minimum` also selects it for a normal
`vscode-test` invocation. The verification script uses `NGG_VSCODE_PATH` only for the stable leg;
`NGG_MINIMUM_VSCODE_PATH` optionally supplies a separate minimum installation for offline runs.
A mismatched installation fails instead of silently substituting a newer version.

Each verification produces a new `test-results/ui-harness-*/` directory with the expected failure,
successful recovery, and minimum run. `compatibility.json` records both actual versions and whether
the minimum needed a separate run. Local installation overrides are identified in the report;
without overrides, the test tooling resolves and downloads stable/minimum VS Code.

## Regenerate the README screenshots

```sh
pnpm run screenshots
```

This builds the extension and runs one opt-in scenario, `captures the README screenshots` in
`tests-ext/ui/screenshots.cjs`, which `pnpm test:ext` and CI skip unless `NGG_SCREENSHOTS=1` is
set. It creates a demo repository with three authors, merged branches, tags and a remote that is
ahead and behind, opens it in a 1280×800 window, and writes the editor area to the PNGs in
`docs/images/`, overwriting them. Commit dates count back from the day of the run, so the images
always differ slightly; check each one before committing it. To show a new feature, add a step to
that file. As with the other scenarios, prefix the command with `xvfb-run -a` on Linux without a
display, and set `NGG_VSCODE_PATH` to use an installed VS Code.

## Suite overview and performance

`pnpm test:ext` includes the committed end-to-end UI checks and launches an isolated VS Code instance with a disposable workspace. Failed tests save diagnostic text under `test-results/`; successful UI checks capture screenshots there. CI is configured for Linux, Windows, and macOS and produces an installable VSIX artifact. `NGG_VSCODE_PATH` can select a local VS Code executable, and `NGG_HEADLESS=1` enables Linux headless runs.

`pnpm benchmark` measures backend history, focus, remote visibility, workspace scans, graph layout, and cancellation on a disposable large repository. `pnpm benchmark:ui` measures real VS Code graph interactions at several loaded-row counts and saves CPU profiles. See [Graph performance measurements](performance.md) for commands, fixture sizes, reports, and interpretation. CI records these diagnostic timings without enforcing machine-dependent speed thresholds.
