/* eslint-disable no-await-in-loop -- Sequential samples avoid contention and depend on prior UI state. */
/* eslint-disable import/no-relative-parent-imports -- Reuse the backend benchmark fixture. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const vscode = require("vscode");

const {
  createBenchmarkRepository,
  git,
  summarize
} = require("../../scripts/benchmark-fixture.cjs");

module.exports = async function benchmark({
  directory,
  openRepo,
  graph,
  button,
  headerChoice,
  until,
  artifacts
}) {
  const count = Number(process.env.NGG_BENCH_COMMITS || 50000);
  const rows = (process.env.NGG_BENCH_ROWS || "300,1000,3000").split(",").map(Number);
  const samples = Number(process.env.NGG_BENCH_SAMPLES || 5);
  assert.ok(
    rows.every(
      (value) =>
        Number.isSafeInteger(value) &&
        value >= 300 &&
        value <= 10000 &&
        value + samples * 100 < count
    )
  );
  assert.ok(Number.isSafeInteger(samples) && samples >= 3 && samples <= 20);
  const dir = directory();
  const fixture = createBenchmarkRepository(dir, count);
  const config = vscode.workspace.getConfiguration("branchwise");
  const original = config.inspect("initialLoadCommits").globalValue;
  const originalMore = config.inspect("loadMoreCommits").globalValue;
  const report = {
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    vscode: vscode.version,
    git: git(["--version"], dir),
    fixture,
    samples,
    renderer: null,
    cases: []
  };
  // Time inside Chromium from the action to its settled DOM and two animation frames.
  // Polling transports only the finished result and does not contribute to the duration.
  async function measure(action, ready) {
    await graph().evaluate(`(() => {
      window.__nggMeasurement = null;
      const longTasks = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ entryTypes: ['longtask'] });
      const started = performance.now();
      ${action};
      function check() {
        if (${ready}) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            longTasks.push(...observer.takeRecords().map(entry => entry.duration)); observer.disconnect();
            window.__nggMeasurement = { elapsedMs: performance.now() - started, longTasksMs: longTasks };
          }));
        } else requestAnimationFrame(check);
      }
      requestAnimationFrame(check);
    })()`);
    return until(
      () => graph().evaluate("window.__nggMeasurement"),
      "benchmark action settled",
      60000
    );
  }
  const settled = `!document.querySelector('tbody tr[data-commit-hash][data-branch-relation="normal"]')`;
  const remoteRows = `[...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('origin lane'))`;
  async function repeat(run) {
    const results = [];
    for (let index = 0; index < samples; index++) {
      results.push(await run(index));
    }
    return {
      ...summarize(results.map((result) => result.elapsedMs)),
      longTasksMs: results.flatMap((result) => result.longTasksMs)
    };
  }
  try {
    await config.update("loadMoreCommits", 100, vscode.ConfigurationTarget.Global);
    for (const size of rows) {
      await config.update("initialLoadCommits", size, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openRepo(dir);
      if (!(await graph().evaluate('!!document.querySelector("nav[aria-label=Branches]")'))) {
        await button("Branches", 'document.querySelector("header")');
      }
      await headerChoice("View", "Focus direct history");
      await headerChoice("Branch", "main");
      await until(
        () =>
          graph().evaluate(
            `document.querySelectorAll('tbody tr[data-commit-hash]').length === ${size} && ${settled}`
          ),
        "benchmark rows and focus",
        60000
      );
      const entry = { rows: size, timings: {} };
      report.cases.push(entry);
      report.renderer = await graph().evaluate(
        "({ userAgent: navigator.userAgent, width: innerWidth, height: innerHeight, devicePixelRatio })"
      );
      entry.domNodes = await graph().evaluate("document.querySelectorAll('*').length");
      entry.svgPaths = await graph().evaluate("document.querySelectorAll('svg path').length");
      entry.timings.focus = await repeat(async (index) => {
        const target = index % 2 === 0 ? "bench/topic" : "main";
        await graph().evaluate(
          "document.querySelector('header button[title=\"' + document.querySelector('[data-focus-branch]').dataset.focusBranch + '\"]').click()"
        );
        return measure(
          `[...document.querySelectorAll('[role="option"]')].find(option => option.textContent.trim() === "${target}").click()`,
          `!!document.querySelector('[data-focus-branch="${target}"]') && ${settled}`
        );
      });
      entry.timings.hideRemote = await repeat(async () => {
        const result = await measure(
          `document.querySelector('button[aria-label="Show remote origin in the graph"]').click()`,
          `!${remoteRows} && ${settled}`
        );
        await measure(
          `document.querySelector('button[aria-label="Show remote origin in the graph"]').click()`,
          `${remoteRows} && ${settled}`
        );
        return result;
      });
      const connection = graph().connection;
      await connection.call("Profiler.enable");
      await connection.call("Profiler.start");
      entry.timings.hover = await repeat((index) =>
        measure(
          `document.querySelectorAll('tbody tr[data-commit-hash]')[${index + 5}].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`,
          "true"
        )
      );
      const { profile } = await connection.call("Profiler.stop");
      await connection.call("Profiler.disable");
      fs.writeFileSync(
        path.join(artifacts, `benchmark-hover-${size}.cpuprofile`),
        JSON.stringify(profile)
      );
      entry.timings.scroll = await graph().evaluate(`new Promise(resolve => {
        const frames = []; let previous = performance.now(); let step = 0;
        function scroll(now) {
          frames.push(now - previous); previous = now;
          window.scrollTo(0, (++step % 2 ? 1 : 0) * (document.documentElement.scrollHeight - innerHeight));
          if (step < 60) requestAnimationFrame(scroll); else resolve(frames.slice(1));
        }
        requestAnimationFrame(scroll);
      })`);
      entry.timings.scroll = summarize(entry.timings.scroll);
      entry.timings.horizontalPan = await repeat((index) =>
        measure(
          `const scroll = document.querySelector('[data-graph-scroll]'); scroll.scrollLeft = ${index % 2 ? 0 : 10000}; scroll.dispatchEvent(new Event('scroll'))`,
          `document.querySelector('[data-graph-viewport]').scrollLeft === document.querySelector('[data-graph-scroll]').scrollLeft`
        )
      );
      entry.timings.loadMore = await repeat((index) =>
        measure(
          `[...document.querySelectorAll('main button')].find(button => button.textContent.trim() === 'Load Older Commits').click()`,
          `document.querySelectorAll('tbody tr[data-commit-hash]').length === ${size + (index + 1) * 100} && ${settled}`
        )
      );
      process.stdout.write(`BENCHMARK ${JSON.stringify(entry)}\n`);
    }
  } finally {
    fs.writeFileSync(
      path.join(artifacts, "benchmark-ui.json"),
      JSON.stringify(report, null, 2) + "\n"
    );
    await config.update("initialLoadCommits", original, vscode.ConfigurationTarget.Global);
    await config.update("loadMoreCommits", originalMore, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  }
};
