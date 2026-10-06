// The README's screenshots, which `pnpm run screenshots` regenerates (see docs/testing.md). The
// scenario builds a demo repository, opens it in Branchwise and writes PNGs to docs/images/.
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const vscode = require("vscode");

const output = path.join(__dirname, "..", "..", "docs", "images");
const DAY = 24 * 60 * 60;
const people = {
  ann: ["Ann Lee", "ann@example.com"],
  ravi: ["Ravi Patel", "ravi@example.com"],
  mei: ["Mei Chen", "mei@example.com"]
};
// Older history on main, which fills the graph's lower rows and a year of the Statistics tab.
const chores = [
  "Add a scale bar to the map",
  "Refactor the route store into smaller modules",
  "Update dependencies",
  "Fix a typo in the onboarding screen",
  "Show the trail difficulty on route cards",
  "Lazy-load the elevation chart",
  "Add keyboard shortcuts for zooming the map",
  "Simplify the GPX parser",
  "Improve the contrast of trail markers",
  "Add unit tests for the distance helpers",
  "Cache geocoding results for an hour",
  "Remove the unused analytics module",
  "Document the tile server settings",
  "Round elevations to whole metres",
  "Fix the route list scrolling on small screens",
  "Group waypoints by day on multi-day routes"
];

/**
 * A trail-planning app's repository: a year of history by three people, four releases, merged
 * fixes, an open feature branch, and a main branch that is both ahead of and behind origin.
 * Dates count back from now, so that the Statistics tab shows a full year.
 */
function createDemoRepository(dir) {
  const now = Math.floor(Date.now() / 1000);
  const git = (args, who = "ann", daysAgo = 0) => {
    const [name, email] = people[who];
    const date = `${now - Math.round(daysAgo * DAY)} +0000`;
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_DATE: date
    };
    return cp.execFileSync("git", args, { cwd: dir, stdio: "pipe", env }).toString().trim();
  };
  const commit = (who, daysAgo, message, ...files) => {
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.appendFileSync(path.join(dir, file), `// ${message.split("\n")[0]}\n`);
    }
    git(["add", "--", ...files]);
    git(["commit", "-m", message], who, daysAgo);
    return git(["rev-parse", "HEAD"]);
  };
  const merge = (daysAgo, branch, pull) => {
    git(["merge", "--no-ff", branch, "-m", `Merge pull request #${pull} from example/${branch}`]);
    // Merge has no date option of its own; amend the commit to give it one.
    git(["commit", "--amend", "--no-edit", "--reset-author"], "ann", daysAgo);
    git(["branch", "-d", branch]);
  };
  const tag = (name, daysAgo) => git(["tag", "-a", name, "-m", `Trailmap ${name}`], "ann", daysAgo);

  fs.mkdirSync(dir);
  git(["init", "-b", "main"]);
  git(["remote", "add", "origin", "https://github.com/example/trailmap.git"]);
  commit("ann", 364.3, "Initial commit", "README.md");
  // A fixed pseudo-random sequence, so that every run draws the same history.
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const files = ["src/map/tiles.ts", "src/routes/store.ts", "src/gpx/parse.ts", "src/ui/card.tsx"];
  const authors = ["ann", "ravi", "ann", "mei", "ravi", "ann"];
  for (let day = 363, n = 0; day > 21; day--) {
    const weekend = new Date((now - day * DAY) * 1000).getDay() % 6 === 0;
    const count = Math.floor(random() * (weekend ? 1.4 : 3.2));
    for (let i = 0; i < count; i++, n++) {
      const who = authors[Math.floor(random() * authors.length)];
      const when = day - 0.1 - i * 0.12 - random() * 0.2;
      commit(who, when, chores[n % chores.length], files[n % files.length]);
    }
    if (day === 250 || day === 120) {
      tag(day === 250 ? "v1.0.0" : "v1.1.0", day - 0.5);
    }
  }

  commit("ann", 19.2, "Add links for sharing a route", "src/routes/share.ts");
  git(["checkout", "-b", "fix/gpx-import"]);
  commit("mei", 17.3, "Handle GPX files without elevation data (#118)", "src/gpx/parse.ts");
  commit("mei", 17.1, "Add tests for empty track segments", "tests/gpx.test.ts");
  git(["checkout", "main"]);
  commit("ravi", 16.4, "Update the map tile attribution", "src/map/tiles.ts");
  merge(15.3, "fix/gpx-import", 121);
  commit("ann", 14.2, "Release 1.2.0", "CHANGELOG.md", "package.json");
  tag("v1.2.0", 14.2);

  git(["checkout", "-b", "feature/offline-maps"]);
  commit("ravi", 12.4, "Cache map tiles for offline use", "src/map/offline.ts", "src/map/tiles.ts");
  commit("ravi", 9.3, "Show download progress in the tiles panel", "src/ui/tiles-panel.tsx");
  const pushed = git(["rev-parse", "HEAD"]);
  commit("ravi", 5.2, "Limit the offline cache to 500 MB", "src/map/offline.ts");
  git(["update-ref", "refs/remotes/origin/feature/offline-maps", pushed]);
  git(["branch", "--set-upstream-to=origin/feature/offline-maps"]);

  git(["checkout", "main"]);
  git(["checkout", "-b", "fix/imperial-units"]);
  const units = "Show distances in miles where the locale uses imperial units (#127)";
  commit("ann", 10.3, units, "src/ui/units.ts");
  commit("ann", 10.1, "Convert elevation gain to feet as well", "src/ui/units.ts");
  git(["checkout", "main"]);
  commit("mei", 9.4, "Add the route editor's German translation", "l10n/de.json");
  merge(8.3, "fix/imperial-units", 128);
  commit("ann", 7.2, "Release 1.3.0", "CHANGELOG.md", "package.json");
  tag("v1.3.0", 7.2);
  const released = git(["rev-parse", "HEAD"]);

  // origin/main has a commit that main has not pulled, and main two that it has not pushed.
  git(["checkout", "--detach"]);
  const unpulled = commit("mei", 3.3, "Translate the route editor into Japanese", "l10n/ja.json");
  git(["update-ref", "refs/remotes/origin/main", unpulled]);
  git(["checkout", "main"]);
  git(["reset", "--hard", released]);
  git(["branch", "--set-upstream-to=origin/main"]);
  commit("ann", 2.2, "Speed up route rendering with a spatial index", "src/map/render.ts");
  const antimeridian = commit(
    "mei",
    1.1,
    [
      "Fix the elevation profile of routes across the antimeridian (#123)",
      "",
      "Longitudes jump from `180` to `-180` there, so `segmentLength()` measured the long way round the globe.",
      "",
      "Unwrap them before measuring each segment."
    ].join("\n"),
    "src/routes/elevation.ts",
    "src/routes/geometry.ts",
    "tests/elevation.test.ts"
  );
  // An edit in progress, for the uncommitted changes row.
  fs.appendFileSync(path.join(dir, "src/ui/card.tsx"), "// TODO: colour the card by difficulty\n");
  return { antimeridian };
}

module.exports = async function screenshots({
  directory,
  openRepo,
  graph,
  connections,
  button,
  contextRef,
  menu,
  until
}) {
  fs.mkdirSync(output, { recursive: true });
  const page = connections.find((connection) => connection.type === "page");
  const workbench = vscode.workspace.getConfiguration("workbench");
  // No prompt about the Git repositories in the parent folders of the disposable workspace.
  await vscode.workspace
    .getConfiguration("git")
    .update("openRepositoryInParentFolders", "never", vscode.ConfigurationTarget.Global);

  async function show(theme, kind, width = 1280, height = 800) {
    await page.call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await workbench.update("colorTheme", theme, vscode.ConfigurationTarget.Global);
    await until(
      () =>
        graph().evaluate(
          `document.body.classList.contains(${JSON.stringify(kind)}) && innerWidth < ${width}`
        ),
      `applied ${theme}`
    );
  }
  async function branches(open) {
    const shown = await graph().evaluate(`!!document.querySelector('nav[aria-label="Branches"]')`);
    if (shown !== open) {
      await button("Branches", 'document.querySelector("header")');
    }
  }
  // The editor area only: no title bar, activity bar, status bar or notifications.
  async function capture(name) {
    await vscode.commands.executeCommand("notifications.clearAll");
    // Let the graph finish its layout and transitions after the last change.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const clip = await page.evaluate(`(() => {
      const { x, y, width, height } = document.querySelector('.part.editor').getBoundingClientRect();
      return { x, y, width, height, scale: 1 };
    })()`);
    const { data } = await page.call("Page.captureScreenshot", { format: "png", clip });
    fs.writeFileSync(path.join(output, name), Buffer.from(data, "base64"));
  }

  const dir = path.join(directory(), "trailmap");
  const { antimeridian } = createDemoRepository(dir);
  await openRepo(dir);

  // The graph, with a commit's details open.
  await show("Dark Modern", "vscode-dark");
  await branches(false);
  // The hint about commit menus goes for good once dismissed.
  await graph().evaluate(`document.querySelector('[role="note"] button')?.click()`);
  const row = `document.querySelector('tr[data-commit-hash="${antimeridian}"]')`;
  await graph().evaluate(`${row}.click()`);
  await until(
    () => graph().evaluate(`!!document.querySelector('[data-details-row] a[href$="/issues/123"]')`),
    "commit details with an issue link"
  );
  await capture("graph-dark.png");
  await graph().evaluate(`${row}.click()`);
  await until(() => graph().evaluate(`!document.querySelector('[data-details-row]')`), "closed");

  // The Statistics tab.
  await show("Dark Modern", "vscode-dark", 1024, 720);
  await graph().evaluate(`document.querySelector('[data-view-tab="statistics"]').click()`);
  await until(
    () =>
      graph().evaluate(
        `document.querySelectorAll('[data-statistics-view] [data-contributor]').length === 3`
      ),
    "contributors"
  );
  await capture("statistics-dark.png");
  await graph().evaluate(`document.querySelector('[data-view-tab="graph"]').click()`);

  // Branch focus, in a light theme, with the Branches pane open.
  await show("Light Modern", "vscode-light");
  await branches(true);
  await contextRef("feature/offline-maps");
  await menu("Focus this branch");
  await until(
    () => graph().evaluate(`!!document.querySelector('tr[data-branch-relation="unrelated"]')`),
    "branch focus"
  );
  await graph().evaluate(`(() => {
    const select = document.querySelector('select[aria-label="Dimming"]');
    select.value = 'strong';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.activeElement.blur();
  })()`);
  await capture("branch-focus-light.png");
};
