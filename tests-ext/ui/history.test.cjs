/* eslint-disable no-await-in-loop -- UI interactions and polling depend on the previous step. */
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const vscode = require("vscode");

const createDiagnostics = require("./diagnostics.cjs");

const port = Number(process.env.NGG_CDP_PORT);
const artifacts = process.env.NGG_ARTIFACTS || path.join(os.tmpdir(), "ngg-ui-artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const repoKey = (value) =>
  value.replaceAll("\\", "/").replace(/^[A-Z]:/, (drive) => drive.toLowerCase());
const connections = [];
const dirs = [];
let graph;
let repo;
const diagnostics = createDiagnostics({
  artifacts,
  connections,
  graph: () => graph,
  runtime: {
    time: new Date().toISOString(),
    vscode: vscode.version,
    minimum: process.env.NGG_MINIMUM_VSCODE_VERSION,
    requested: process.env.NGG_EXPECTED_VSCODE_VERSION,
    installation: process.env.NGG_VSCODE_PATH || "downloaded",
    extension: process.env.NGG_EXTENSION_ID,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    logs: process.env.NGG_VSCODE_LOGS
  }
});
const visible = (hash) => `!!document.querySelector('tr[data-commit-hash="${hash}"]')`;
function git(args, cwd = repo) {
  return cp.execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
}
function directory() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-ui-")));
  dirs.push(dir);
  return dir;
}
function init(dir) {
  git(["init", "-b", "main"], dir);
  git(["config", "user.name", "UI Test"], dir);
  git(["config", "user.email", "ui@test"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
  git(["config", "rerere.enabled", "false"], dir);
}
function commit(file, value, cwd = repo) {
  fs.writeFileSync(path.join(cwd, file), value);
  git(["add", "--", file], cwd);
  git(["commit", "-m", value], cwd);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function keypress(key, modifiers = 0) {
  const letter = /^[a-z]$/i.test(key);
  const codes = {
    Tab: 9,
    Enter: 13,
    " ": 32,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Home: 36,
    End: 35
  };
  for (const type of ["keyDown", "keyUp"]) {
    await connections[0].call("Input.dispatchKeyEvent", {
      type,
      key,
      code: key === " " ? "Space" : letter ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: codes[key] ?? (letter ? key.toUpperCase().charCodeAt(0) : undefined),
      modifiers,
      ...(type === "keyDown" && (key === "Enter" || letter)
        ? { text: key === "Enter" ? "\r" : key }
        : {})
    });
  }
}

async function keyboardSelect(selector, label, value) {
  await graph.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  // Re-enter by keyboard to reset native type-ahead and verify the select is a tab stop.
  await keypress("Tab");
  await keypress("Tab", 8);
  await visibleKeyboardFocus(selector);
  // Home/End do not change a closed native select on macOS; type-ahead works on every OS.
  for (const character of label.toLowerCase()) {
    await keypress(character);
  }
  await until(
    () =>
      graph.evaluate(
        `document.querySelector(${JSON.stringify(selector)}).value === ${JSON.stringify(value)}`
      ),
    `keyboard selects ${value}`
  );
}

// Resolve CSS colours in Chromium, including color-mix, alpha, and ancestor opacity.
// Text/focus thresholds follow https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
// and https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html (not a full accessibility audit).
async function contrast(selector, property = "color") {
  return graph.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing contrast target');
    const context = document.createElement('canvas').getContext('2d');
    const pixel = () => [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const ancestors = []; let opacity = 1;
    for (let node = element; node; node = node.parentElement) { ancestors.unshift(node); opacity *= Number(getComputedStyle(node).opacity); }
    context.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background');
    context.fillRect(0, 0, 1, 1);
    const backgrounds = ${JSON.stringify(property)} === 'outlineColor' && parseFloat(getComputedStyle(element).outlineOffset) >= 0 ? ancestors.slice(0, -1) : ancestors;
    for (const node of backgrounds) { context.fillStyle = getComputedStyle(node).backgroundColor; context.fillRect(0, 0, 1, 1); }
    const background = pixel();
    context.globalAlpha = opacity;
    context.fillStyle = getComputedStyle(element)[${JSON.stringify(property)}];
    context.fillRect(0, 0, 1, 1);
    const foreground = pixel();
    const luminance = rgb => rgb.map(channel => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
      .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const light = luminance(foreground), dark = luminance(background);
    return { ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05), foreground, background, opacity,
      outlineOffset: getComputedStyle(element).outlineOffset };
  })()`);
}

async function visibleKeyboardFocus(selector) {
  await until(async () => {
    const state = await graph.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return { focused: element === document.activeElement, visible: element.matches(':focus-visible'),
      outline: style.outlineStyle, width: parseFloat(style.outlineWidth),
      top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
      height: innerHeight, viewportWidth: innerWidth, scale: devicePixelRatio,
      active: document.activeElement?.outerHTML.slice(0, 300) };
    })()`);
    assert.ok(
      state.focused &&
        state.visible &&
        state.outline !== "none" &&
        state.width * state.scale >= 0.99 &&
        state.top >= -1 &&
        state.bottom <= state.height + 1 &&
        state.left >= -1 &&
        state.right <= state.viewportWidth + 1,
      JSON.stringify(state)
    );
    return true;
  }, `visible keyboard focus: ${selector}`);
  const measured = await contrast(selector, "outlineColor");
  assert.ok(measured.ratio >= 3, `focus contrast for ${selector}: ${JSON.stringify(measured)}`);
}

async function until(fn, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  const error = new Error("Timed out: " + label + (last ? "\n" + last : ""));
  // Capture before a scenario's finally block restores its repository, theme, or viewport.
  await diagnostics.capture(error, "poll timeout");
  throw error;
}
async function connect(url, type) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const pending = new Map();
  const contexts = new Set();
  let sequence = 0;
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    diagnostics.record({ type, url }, message);
    if (message.method === "Runtime.executionContextCreated") {
      contexts.add(message.params.context.id);
    }
    if (message.method === "Runtime.executionContextDestroyed") {
      contexts.delete(message.params.executionContextId);
    }
    if (message.method === "Runtime.executionContextsCleared") {
      contexts.clear();
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    }
  });
  ws.addEventListener("close", () => {
    contexts.clear();
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error("CDP connection closed"));
    }
    pending.clear();
  });
  const connection = {
    ws,
    type,
    url,
    contexts,
    call(method, params = {}) {
      if (ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("CDP connection is not open"));
      }
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("CDP timeout: " + method));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression, contextId) {
      const response = await this.call("Runtime.evaluate", {
        expression,
        contextId,
        returnByValue: true,
        awaitPromise: true
      });
      if (response.exceptionDetails) {
        throw new Error(JSON.stringify(response.exceptionDetails));
      }
      return response.result.value;
    }
  };
  connections.push(connection);
  await connection.call("Runtime.enable");
  await connection.call("Log.enable").catch(() => {});
  if (type === "page") {
    await connection.call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false
    });
  }
  return connection;
}
async function findGraph() {
  return until(
    async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      for (const target of targets.filter(
        (t) => t.webSocketDebuggerUrl && ["page", "iframe"].includes(t.type)
      )) {
        if (
          !connections.some(
            (connection) =>
              connection.url === target.webSocketDebuggerUrl &&
              connection.ws.readyState === WebSocket.OPEN
          )
        ) {
          await connect(target.webSocketDebuggerUrl, target.type);
        }
      }
      for (const connection of connections) {
        if (connection.ws.readyState !== WebSocket.OPEN) {
          continue;
        }
        for (const context of connection.contexts) {
          try {
            if (
              await connection.evaluate(
                '!!document.querySelector("header") && !!document.querySelector("[data-branchwise]")',
                context
              )
            ) {
              return {
                evaluate: (expression) => connection.evaluate(expression, context),
                connection
              };
            }
          } catch {}
        }
      }
    },
    "graph context",
    25000
  );
}
async function button(text, scope = '(document.querySelector("[role=dialog]") || document)') {
  if (["Remotes", "Stashes", "Worktrees"].includes(text)) {
    await toolsMenu(text);
    return;
  }

  await until(
    () =>
      graph.evaluate(
        `(() => { const root = ${scope}; const button = [...root.querySelectorAll('button')].find(b => (b.textContent.trim() === ${JSON.stringify(text)} || b.getAttribute('aria-label') === ${JSON.stringify(text)}) && !b.disabled); if (!button) return false; button.click(); return true; })()`
      ),
    "button " + text
  );
}
/**
 * Choose `text` from the Settings & Tools menu. Any scroll closes a menu, and a refresh that
 * lands just after it opens can scroll the graph, so the menu is opened again until the entry
 * is chosen.
 */
async function toolsMenu(text) {
  await until(
    () =>
      graph.evaluate(
        `(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (item) { item.click(); return true; } if (!document.querySelector('[role="menu"]')) { document.querySelector('header button[aria-label="Settings & Tools"]')?.click(); } return false; })()`
      ),
    "tools menu " + text
  );
}
/**
 * Choose `text` from the Settings & Tools menu once its entries include it. The entries are built
 * when the menu opens, so a menu opened before the repository state arrived is opened again.
 */
async function freshToolsMenu(text) {
  await until(
    () =>
      graph.evaluate(
        `(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (item) { item.click(); return true; } document.querySelector('header button[aria-label="Settings & Tools"]')?.click(); return false; })()`
      ),
    "fresh tools menu " + text
  );
}
/** Click `label` on the VS Code notification whose message contains `message`. */
async function notificationAction(message, label) {
  await vscode.commands.executeCommand("notifications.showList");
  try {
    await until(async () => {
      for (const connection of connections.filter(
        (item) => item.ws.readyState === WebSocket.OPEN
      )) {
        for (const context of connection.contexts) {
          try {
            if (
              await connection.evaluate(
                `(() => { const item = [...document.querySelectorAll('.notifications-center .notification-list-item')].find(e => e.textContent.includes(${JSON.stringify(message)})); const action = item && [...item.querySelectorAll('.monaco-button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!action) return false; action.click(); return true; })()`,
                context
              )
            ) {
              return true;
            }
          } catch {}
        }
      }
      return false;
    }, `notification ${message}: ${label}`);
  } finally {
    await vscode.commands.executeCommand("notifications.hideList");
  }
}
async function menu(text) {
  await until(
    () =>
      graph.evaluate(
        `(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!item) return false; item.click(); return true; })()`
      ),
    "menu " + text
  );
}
async function fill(values) {
  await graph.evaluate(
    `(() => { const inputs = [...document.querySelectorAll('[role="dialog"] input[type="text"]')]; ${JSON.stringify(values)}.forEach((value, i) => { inputs[i].value = value; inputs[i].dispatchEvent(new Event('input', {bubbles: true})); }); })()`
  );
}
async function select(value) {
  await until(
    () => graph.evaluate('!!document.querySelector("[role=dialog] select")'),
    "select field"
  );
  await graph.evaluate(
    `(() => { const input = document.querySelector('[role="dialog"] select'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', {bubbles: true})); })()`
  );
}
async function finished() {
  await until(
    async () => {
      const text = await graph.evaluate('document.querySelector("[role=dialog]")?.innerText || ""');
      if (text.startsWith("Unable")) {
        throw new Error(text);
      }
      return text === "";
    },
    "Git action completion",
    20000
  );
}
async function contextRef(name) {
  await until(
    () =>
      graph.evaluate(
        `(() => { const element = [...document.querySelectorAll('span[title]')].find(e => e.title.split(String.fromCharCode(10))[0] === ${JSON.stringify(name)} && e.querySelector('svg')); if (!element) return false; element.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: 150, clientY: 220})); return true; })()`
      ),
    "ref " + name
  );
}
async function openRepo(dir) {
  await vscode.commands.executeCommand("branchwise.view", { rootUri: vscode.Uri.file(dir) });
  graph = await findGraph();
  // The extension selects the repository once Git names its top level.
  await until(
    () =>
      graph.evaluate(
        `[...document.querySelectorAll('header button[aria-haspopup="listbox"]')].some(b => b.title === ${JSON.stringify(repoKey(dir))})`
      ),
    "selected repository " + dir
  );
  await button("Refresh");
  await until(
    () => graph.evaluate('document.querySelectorAll("tbody tr").length > 0'),
    "loaded commits"
  );
}
/**
 * Click, once, the label of the Branches pane row whose tooltip is `title`, after waiting for the
 * row: the pane fills in from the repository state, which can arrive after the graph's rows.
 */
async function clickPaneRow(title) {
  await until(
    () =>
      graph.evaluate(`(() => {
        const nav = document.querySelector('nav[aria-label="Branches"]');
        const label = [...(nav?.querySelectorAll('button[title]') ?? [])].find(b => b.title === ${JSON.stringify(title)});
        if (!label) return false;
        label.click();
        return true;
      })()`),
    "Branches pane row " + title
  );
}
/** Opens the search row, unless it is open already. */
async function openSearch() {
  if (!(await graph.evaluate('!!document.querySelector("[data-history-search]")'))) {
    await button("Search history", 'document.querySelector("header")');
  }
}
/** Types `text` into the open search box and searches. */
async function searchHistory(text) {
  await graph.evaluate(
    `(() => { const input = document.querySelector('[data-history-search]'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', {bubbles:true})); })()`
  );
  await button("Search", 'document.querySelector("form[role=search]")');
}
/** The text of each commit row on the page, graph or search results. */
function commitRows() {
  return graph.evaluate(
    '[...document.querySelectorAll("tr[data-commit-hash]")].map(row => row.innerText)'
  );
}
/** The value of the search form's input labelled `label`. */
function searchField(label) {
  return graph.evaluate(
    `[...document.querySelectorAll("form[role=search] label")].find(label => label.innerText.includes(${JSON.stringify(label)})).querySelector("input").value`
  );
}
async function headerChoice(label, option) {
  await until(
    () =>
      graph.evaluate(`(() => {
      const trigger = [...document.querySelectorAll('header button[aria-haspopup="listbox"]')]
        .find(button => document.getElementById(button.getAttribute('aria-labelledby').split(' ')[0])?.textContent === ${JSON.stringify(label + ":")});
      if (!trigger || trigger.disabled) return false;
      trigger.click(); return true;
    })()`),
    "header choice " + label
  );
  await until(
    () =>
      graph.evaluate(`(() => {
      const option = [...document.querySelectorAll('[role="option"]')].find(item => item.textContent.trim() === ${JSON.stringify(option)});
      if (!option) return false;
      option.click(); return true;
    })()`),
    "option " + option
  );
}
suite("Branchwise workflow UI", function () {
  this.timeout(120000);
  suiteSetup(async () => {
    try {
      const minimum = process.env.NGG_MINIMUM_VSCODE_VERSION;
      assert.ok(
        vscode.version.localeCompare(minimum, "en", { numeric: true }) >= 0,
        `VS Code ${vscode.version} is older than the declared minimum ${minimum}`
      );
      const expected = process.env.NGG_EXPECTED_VSCODE_VERSION;
      if (/^\d+\.\d+\.\d+$/.test(expected)) {
        assert.equal(vscode.version, expected, "The requested VS Code version must actually run");
      }
      repo = directory();
      init(repo);
      commit("f", "ui-base");
      commit("a", "ui-first");
      commit("b", "ui-second");
      git(["tag", "v-ui"]);
      const extension = vscode.extensions.getExtension(process.env.NGG_EXTENSION_ID);
      assert.ok(extension);
      await extension.activate();
      await vscode.commands.executeCommand("workbench.action.closeSidebar");
      await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
      await openRepo(repo);
    } catch (error) {
      await diagnostics.capture(error, "suite setup");
      throw error;
    }
  });
  setup(function () {
    diagnostics.start(this.currentTest.fullTitle());
  });
  teardown(async function () {
    if (this.currentTest?.state === "failed") {
      await diagnostics.capture(this.currentTest.err, "test failure");
    }
  });
  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    for (const connection of connections) {
      connection.ws.close();
    }
    for (const dir of dirs) {
      await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  test("checks VS Code compatibility and graph controls", async () => {
    const dir = directory();
    init(dir);
    commit("base", "compatibility-base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    const tree = git(["rev-parse", "HEAD^{tree}"], dir);
    const remote = git(["commit-tree", tree, "-p", base, "-m", "compatibility-remote"], dir);
    git(["remote", "add", "origin", dir], dir);
    git(["update-ref", "refs/remotes/origin/topic", remote], dir);
    commit("main", "compatibility-main", dir);
    await openRepo(dir);
    await until(() => graph.evaluate(visible(remote)), "compatibility remote history");
    await contextRef("main");
    await menu("Focus this branch");
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('tr[data-commit-hash="${remote}"]')?.dataset.branchRelation === 'unrelated'`
        ),
      "compatibility branch focus"
    );
    const nav = `document.querySelector('nav[aria-label="Branches"]')`;
    if (!(await graph.evaluate("!!" + nav))) {
      await button("Branches", 'document.querySelector("header")');
    }
    await button("Show remote origin in the graph", nav);
    await until(
      () => graph.evaluate(`!${visible(remote)} && ${visible(base)}`),
      "compatibility remote visibility"
    );
    await button("Show remote origin in the graph", nav);
    await until(() => graph.evaluate(visible(remote)), "compatibility remote restored");

    if (process.env.NGG_DIAGNOSTIC_FAULT === "1") {
      const channel = vscode.window.createOutputChannel("NGG diagnostic probe", { log: true });
      channel.error("NGG extension diagnostic marker");
      await graph.evaluate(`(() => {
        const marker = document.createElement('p');
        marker.textContent = 'NGG visible diagnostic marker';
        document.body.prepend(marker);
        console.error('NGG console diagnostic marker');
        setTimeout(() => { throw new Error('NGG uncaught diagnostic marker'); }, 0);
      })()`);
      try {
        await until(() => false, "NGG intentional diagnostic failure", 300);
      } finally {
        // Verify capture happened before cleanup, even when teardown sees a recovered view.
        await graph.evaluate("document.body.firstElementChild.remove()");
        channel.dispose();
      }
    }
    await openRepo(repo);
    fs.writeFileSync(
      path.join(artifacts, "compatibility-smoke.json"),
      JSON.stringify({ vscode: vscode.version, passed: true }) + "\n"
    );
  });

  if (process.env.NGG_BENCH_UI === "1") {
    test("benchmarks large graph interactions", async function () {
      this.timeout(300000);
      await require("./benchmark.cjs")({
        directory,
        openRepo,
        graph: () => graph,
        button,
        headerChoice,
        until,
        artifacts
      });
    });
  }

  if (process.env.NGG_SCREENSHOTS === "1") {
    test("captures the README screenshots", async function () {
      this.timeout(300000);
      await require("./screenshots.cjs")({
        directory,
        openRepo,
        graph: () => graph,
        connections,
        button,
        contextRef,
        menu,
        until
      });
    });
  }

  test("focuses direct or merged branch history without hiding rows or changing checkout", async () => {
    const dir = directory();
    init(dir);
    commit("base", "focus-base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    git(["checkout", "-b", "topic"], dir);
    commit("topic", "focus-merged", dir);
    const topic = git(["rev-parse", "HEAD"], dir);
    git(["checkout", "main"], dir);
    commit("main", "focus-main", dir);
    git(["merge", "--no-ff", "topic", "-m", "focus-merge"], dir);
    const tip = git(["rev-parse", "HEAD"], dir);
    git(["checkout", "-b", "side", base], dir);
    commit("side", "focus-unrelated", dir);
    const side = git(["rev-parse", "HEAD"], dir);
    git(["checkout", "main"], dir);
    await openRepo(dir);
    await until(
      () => graph.evaluate(`!!document.querySelector('tr[data-commit-hash="${side}"]')`),
      "all focus fixture rows"
    );
    const geometry = () =>
      graph.evaluate(`({
      rows: [...document.querySelectorAll('tr[data-commit-hash]')].map(row => row.dataset.commitHash),
      vertices: [...document.querySelectorAll('svg[aria-hidden] circle[data-branch-relation]')].map(dot => [dot.getAttribute('cx'), dot.getAttribute('cy')])
    })`);
    const before = await geometry();
    const graphColours = () =>
      graph.evaluate(`({
      dots: [...document.querySelectorAll('circle[data-branch-relation]')].map(dot => ({
        relation: dot.dataset.branchRelation,
        fill: getComputedStyle(dot).fill,
        stroke: getComputedStyle(dot).stroke
      })),
      paths: [...document.querySelectorAll('path[data-branch-relation]')].map(line => ({
        relation: line.dataset.branchRelation,
        stroke: getComputedStyle(line).stroke
      })),
      text: getComputedStyle(document.querySelector('tr[data-commit-hash="${side}"]')).color
    })`);
    const fullColour = await graphColours();
    await contextRef("main");
    await menu("Focus this branch");
    await until(
      () =>
        graph.evaluate(`
      document.querySelector('tr[data-commit-hash="${topic}"]')?.dataset.branchRelation === 'merged' &&
      document.querySelector('tr[data-commit-hash="${side}"]')?.dataset.branchRelation === 'unrelated' &&
      document.querySelector('tr[data-commit-hash="${tip}"]')?.dataset.branchRelation === 'direct'
    `),
      "three focus levels"
    );
    assert.deepEqual(await geometry(), before);
    assert.equal(
      await graph.evaluate(
        `document.querySelectorAll('[data-focus-branch="main"][data-focus-paused="false"]').length`
      ),
      2
    );
    assert.ok(
      await graph.evaluate(
        `!!document.querySelector('path[data-branch-relation="merged"][stroke^="color-mix"]')`
      )
    );
    await graph.evaluate(`document.querySelector('tr[data-commit-hash="${side}"]').focus()`);
    assert.equal(
      await graph.evaluate(`(() => {
      const row = document.querySelector('tr[data-commit-hash="${side}"]');
      return getComputedStyle(row).color === getComputedStyle(document.querySelector('tr[data-commit-hash="${tip}"]')).color;
    })()`),
      true
    );
    await graph.evaluate(`document.querySelector('tr[data-commit-hash="${tip}"]').focus()`);
    const subtle = await graphColours();
    await graph.evaluate(`(() => {
      const select = document.querySelector('select[aria-label="Dimming"]');
      select.value = 'strong';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await until(
      async () =>
        (await graphColours()).paths.some(
          (line, index) =>
            line.relation === "unrelated" && line.stroke !== subtle.paths[index].stroke
        ),
      "strong graph dimming"
    );
    const strong = await graphColours();
    assert.equal(strong.text, subtle.text, "strong dimming preserves text readability");
    for (let i = 0; i < strong.dots.length; i++) {
      if (strong.dots[i].relation === "direct") {
        assert.deepEqual(strong.dots[i], subtle.dots[i]);
      } else {
        assert.notEqual(strong.dots[i].fill, subtle.dots[i].fill);
      }
    }
    await button("Pause focus");
    await until(
      () =>
        graph.evaluate(
          `document.querySelectorAll('[data-focus-branch="main"][data-focus-paused="true"]').length === 2`
        ),
      "paused target markers"
    );
    const paused = await graphColours();
    assert.deepEqual(paused.dots, fullColour.dots);
    assert.deepEqual(paused.paths, fullColour.paths);
    assert.deepEqual(await geometry(), before);
    await button("Resume focus");
    await until(
      async () => (await graphColours()).paths.some((line) => line.relation === "unrelated"),
      "resumed graph focus"
    );
    assert.deepEqual(await graphColours(), strong);
    const screenshot = await connections[0].call("Page.captureScreenshot");
    fs.writeFileSync(
      path.join(artifacts, "branch-focus.png"),
      Buffer.from(screenshot.data, "base64")
    );
    await headerChoice("View", "Focus all ancestors");
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('tr[data-commit-hash="${topic}"]')?.dataset.branchRelation === 'direct'`
        ),
      "merged history stays bright"
    );
    assert.deepEqual(await geometry(), before);
    await contextRef("side");
    await menu("Focus this branch");
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('tr[data-commit-hash="${side}"]')?.dataset.branchRelation === 'direct'`
        ),
      "focus another branch"
    );
    assert.deepEqual(await geometry(), before);
    assert.equal(
      await graph.evaluate(`document.querySelectorAll('[data-focus-branch="side"]').length`),
      2
    );
    assert.equal(
      await graph.evaluate(`document.querySelectorAll('[data-focus-branch="main"]').length`),
      0
    );
    assert.equal(git(["branch", "--show-current"], dir), "main");
    assert.equal(git(["rev-parse", "HEAD"], dir), tip);
    await button("Clear focus");
    await until(
      () =>
        graph.evaluate(
          `![...document.querySelectorAll('tr[data-commit-hash]')].some(row => row.dataset.branchRelation !== 'normal')`
        ),
      "clear focus"
    );
    assert.deepEqual(await geometry(), before);
    assert.equal(
      await graph.evaluate(`document.querySelectorAll('[data-focus-branch]').length`),
      0
    );
    await headerChoice("Branch", "side");
    await headerChoice("View", "Filter to branch");
    await until(
      () => graph.evaluate(`document.querySelectorAll('tr[data-commit-hash]').length === 2`),
      "filter branch history"
    );
    await openRepo(repo);
  });

  test("opens uncommitted files from the graph with separate staged and working diffs", async () => {
    const dir = directory();
    init(dir);
    commit("file # spaces.txt", "committed\n", dir);
    const file = "file # spaces.txt";
    fs.writeFileSync(path.join(dir, file), "staged\n");
    git(["add", "--", file], dir);
    fs.writeFileSync(path.join(dir, file), "working\n");
    fs.mkdirSync(path.join(dir, "new"));
    fs.writeFileSync(path.join(dir, "new/a.txt"), "untracked\n");
    fs.writeFileSync(path.join(dir, "new/b.txt"), "another\n");
    await openRepo(dir);
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('tr[data-commit-hash="*"]')?.textContent.includes('Uncommitted changes in 3 files')`
        ),
      "changed file count"
    );
    await graph.evaluate(`document.querySelector('tr[data-commit-hash="*"]').click()`);
    const loaded = () =>
      graph.evaluate(
        `document.querySelectorAll('[data-working-tree-details] section').length === 3 && !document.querySelector('[aria-busy="true"]')`
      );
    await until(loaded, "grouped changes");
    const screenshot = await connections[0].call("Page.captureScreenshot");
    fs.writeFileSync(
      path.join(artifacts, "uncommitted-changes.png"),
      Buffer.from(screenshot.data, "base64")
    );

    async function openFile(group, name, before, after, working) {
      await graph.evaluate(`(() => {
        const section = document.querySelector('section[aria-label=${JSON.stringify(group)}]');
        [...section.querySelectorAll('button')].find(button => button.title === ${JSON.stringify(name)}).click();
      })()`);
      const input = await until(() => {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        return tab?.input instanceof vscode.TabInputTextDiff ? tab.input : null;
      }, "native file diff");
      const left = await vscode.workspace.openTextDocument(input.original);
      const right = await vscode.workspace.openTextDocument(input.modified);
      assert.equal(left.getText(), before);
      assert.equal(right.getText(), after);
      assert.equal(input.modified.scheme, working ? "file" : "branchwise");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openRepo(dir);
      await until(loaded, "refreshed changes");
    }

    await openFile("Staged Changes", file, "committed\n", "staged\n", false);
    await openFile("Unstaged Changes", file, "staged\n", "working\n", true);
    await openFile("Untracked Files", "new/a.txt", "", "untracked\n", true);
    // Reopening must resolve the new index blob even while old documents are cached.
    git(["add", "--", file], dir);
    fs.writeFileSync(path.join(dir, file), "working again\n");
    await button("Refresh");
    await until(loaded, "changed staged content");
    await openFile("Staged Changes", file, "committed\n", "working\n", false);
    await button("Close", 'document.querySelector("[data-details-row]")');
    assert.equal(await graph.evaluate(`document.activeElement?.dataset.commitHash`), "*");
    await graph.evaluate(
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))`
    );
    await until(loaded, "keyboard-opened changes");
    assert.equal(git(["show", ":" + file], dir), "working");
    assert.equal(fs.readFileSync(path.join(dir, file), "utf8"), "working again\n");
    await openRepo(repo);
  });

  test("configures remotes and upstreams, pushes/deletes tags, pops stashes, and manages worktrees", async () => {
    const bare = directory();
    git(["clone", "--bare", repo, bare]);
    await button("Remotes");
    await button("Add Remote");
    await fill(["upstream", bare]);
    await button("Add Remote");
    await finished();
    assert.equal(git(["remote", "get-url", "upstream"]), bare);
    await button("Configure Upstream");
    await select("refs/remotes/upstream/main");
    await button("Save");
    await finished();
    assert.equal(git(["config", "branch.main.remote"]), "upstream");
    await contextRef("v-ui");
    await menu("Push Tag to Remote…");
    await button("Push Tag to Remote");
    await finished();
    assert.equal(git(["tag", "--list"], bare), "v-ui");
    await contextRef("v-ui");
    await menu("Delete Remote Tag…");
    await button("Delete Remote Tag");
    await button("Delete Remote Tag");
    await finished();
    assert.equal(git(["tag", "--list"], bare), "");
    assert.equal(git(["tag", "--list"]), "v-ui");
    fs.writeFileSync(path.join(repo, "f"), "ui-stash");
    await button("Stashes");
    await button("Save Stash");
    await fill(["UI saved work"]);
    await button("Save Stash");
    await finished();
    assert.match(git(["stash", "list"]), /UI saved work/);
    await button("Stashes");
    await button("Pop Stash");
    await button("Pop Stash");
    await finished();
    assert.equal(git(["stash", "list"]), "");
    assert.equal(fs.readFileSync(path.join(repo, "f"), "utf8"), "ui-stash");
    git(["restore", "f"]);
    const worktree = path.join(directory(), "worktree");
    await button("Worktrees");
    await button("Create Worktree");
    await fill([worktree, "ui-worktree", "HEAD"]);
    await button("Create Worktree");
    await finished();
    assert.equal(git(["branch", "--show-current"], worktree), "ui-worktree");
    await button("Worktrees");
    await button("Remove Worktree");
    await button("Remove Worktree");
    await finished();
    assert.equal(fs.existsSync(worktree), false);
  });

  test("never confirms a destructive dialog while Enter is held", async () => {
    const dir = directory();
    init(dir);
    commit("base", "held-base", dir);
    commit("top", "held-top", dir);
    git(["tag", "held-tag"], dir);
    git(["branch", "held-branch", "HEAD^"], dir);
    git(["remote", "add", "origin", dir], dir);
    git(["update-ref", "refs/remotes/origin/held-remote", "HEAD^"], dir);
    const head = git(["rev-parse", "HEAD"], dir);
    const refs = () => git(["for-each-ref", "--format=%(refname) %(objectname)"], dir);
    const before = refs();
    const dialogText = () => graph.evaluate('document.querySelector("[role=dialog]")?.innerText');
    const focused = () => graph.evaluate("document.activeElement?.textContent.trim()");
    const enter = (autoRepeat) =>
      connections[0].call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        text: "\r",
        autoRepeat
      });
    /** Choose a menu item with the keyboard and keep Enter down, as the OS repeats it. */
    async function holdEnter(item) {
      const steps = await until(
        () =>
          graph.evaluate(
            `(() => { const index = [...document.querySelectorAll('[role="menuitem"]')].findIndex(e => e.textContent.trim() === ${JSON.stringify(item)}); return index >= 0 && index + 1; })()`
          ),
        "menu item " + item
      );
      for (let step = 0; step < steps; step++) {
        await keypress("ArrowDown");
      }
      await enter(false);
      for (let repeat = 0; repeat < 15; repeat++) {
        await delay(40);
        await enter(true);
      }
      await connections[0].call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13
      });
      await until(dialogText, "dialog after holding Enter on " + item);
      // Give any activation that slipped through time to reach Git.
      await delay(500);
      assert.equal(refs(), before, item);
      assert.equal(git(["rev-parse", "HEAD"], dir), head, item);
    }

    await openRepo(dir);
    for (const [open, item] of [
      [() => contextRef("held-tag"), "Delete Local Tag…"],
      [() => contextRef("held-branch"), "Delete Local Branch…"],
      [() => contextCommit("held-base"), "Reset Current Branch to This Commit…"]
    ]) {
      await open();
      await holdEnter(item);
      assert.equal(await focused(), "Cancel", item);
      await keypress("Enter");
      await until(async () => !(await dialogText()), "cancel " + item);
    }

    // The remote picker comes first; a held Enter must not pass through it either.
    await contextRef("origin/held-remote");
    await holdEnter("Delete Remote Branch…");
    await until(
      () => graph.evaluate('!!document.querySelector("[role=dialog] select")'),
      "remote picker stays open"
    );
    await keypress("Enter");
    await until(
      async () => (await dialogText())?.includes("origin"),
      "remote deletion confirmation"
    );
    await until(async () => (await focused()) === "Cancel", "remote deletion focuses Cancel");
    assert.equal(refs(), before);
    await keypress("Enter");
    await until(async () => !(await dialogText()), "cancel remote deletion");

    // A fresh Enter on the confirm button still confirms.
    await contextRef("held-tag");
    await menu("Delete Local Tag…");
    await until(async () => (await focused()) === "Cancel", "tag deletion focuses Cancel");
    await keypress("Tab", 8);
    assert.equal(await focused(), "Delete Local Tag");
    await keypress("Enter");
    await finished();
    assert.equal(git(["tag", "--list"], dir), "");
    await openRepo(repo);
  });

  test("recovers from a merge conflict through the status controls", async () => {
    git(["checkout", "-b", "ui-conflict"]);
    commit("f", "other side");
    git(["checkout", "main"]);
    commit("f", "main side");
    await button("Refresh");
    await contextRef("ui-conflict");
    await menu("Merge into Current Branch…");
    await button("Merge");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]")?.innerText.includes("Unable to merge the branch")'
        ),
      "merge rejection"
    );
    await button("Dismiss");
    await until(
      () => graph.evaluate('document.body.innerText.includes("Merge in progress")'),
      "operation status"
    );
    fs.writeFileSync(path.join(repo, "f"), "resolved by UI");
    await button("Stage Resolution");
    await button("Stage Resolution");
    await finished();
    await button("Continue");
    await button("Continue");
    await finished();
    assert.equal(git(["show", "-s", "--format=%P", "HEAD"]).split(" ").length, 2);
    assert.equal(fs.existsSync(path.join(repo, ".git", "MERGE_HEAD")), false);
  });

  test("undoes a hard reset from the menu and a branch deletion from its notification", async () => {
    const dir = directory();
    init(dir);
    commit("f", "undo-base", dir);
    commit("a", "undo-first", dir);
    commit("b", "undo-second", dir);
    const [second, first, base] = git(["rev-list", "HEAD"], dir).split("\n");
    await openRepo(dir);
    try {
      await contextCommit("undo-base");
      await menu("Reset Current Branch to This Commit…");
      await select("hard");
      await button("Reset");
      await finished();
      await until(
        () => graph.evaluate(`!${visible(first)} && !${visible(second)} && ${visible(base)}`),
        "commits after the reset leave the graph"
      );
      assert.equal(git(["rev-parse", "HEAD"], dir), base);
      // Backups stay out of the graph and the branch picker.
      assert.match(
        git(["for-each-ref", "refs/branchwise/"], dir),
        /^\S+ commit\trefs\/branchwise\//
      );

      await freshToolsMenu("Undo Hard Reset of main");
      await finished();
      await until(
        () => graph.evaluate(`${visible(first)} && ${visible(second)}`),
        "the commits return to the graph"
      );
      assert.equal(git(["rev-parse", "HEAD"], dir), second);
      assert.equal(git(["status", "--porcelain"], dir), "");

      git(["branch", "undo-topic", first], dir);
      await button("Refresh");
      await contextRef("undo-topic");
      await menu("Delete Local Branch…");
      await button("Delete Local Branch");
      await finished();
      assert.equal(git(["branch", "--list", "undo-topic"], dir), "");
      await notificationAction("Deletion of Branch undo-topic", "Undo");
      await until(
        () => git(["branch", "--list", "undo-topic"], dir) !== "",
        "the deleted branch returns"
      );
      assert.equal(git(["rev-parse", "undo-topic"], dir), first);
      await until(
        () =>
          graph.evaluate(
            `[...document.querySelectorAll('span[title]')].some(e => e.title.split(String.fromCharCode(10))[0] === "undo-topic")`
          ),
        "the branch label returns"
      );

      // Both actions are listed in the Safety Net as undone.
      await freshToolsMenu("Safety Net…");
      await until(
        () =>
          graph.evaluate(
            `[...document.querySelectorAll('[data-safety-entry]')].map(e => e.querySelector('b').textContent).join("|") === "Deletion of Branch undo-topic|Hard Reset of main"`
          ),
        "the Safety Net lists both actions"
      );
      await button("Close");
    } finally {
      await vscode.commands.executeCommand("notifications.clearAll");
      await openRepo(repo);
    }
  });

  test("switches repositories through SCM and runs an interactive rebase from a commit menu", async () => {
    const second = directory();
    init(second);
    commit("f", "ui-rebase-base", second);
    const base = git(["rev-parse", "HEAD"], second);
    commit("a", "first rebase item", second);
    commit("b", "second rebase item", second);
    commit("c", "third rebase item", second);
    await openRepo(second);
    await until(
      () =>
        graph.evaluate(
          `(() => { const row = [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('ui-rebase-base')); if (!row) return false; row.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: 160, clientY: 220})); return true; })()`
        ),
      "rebase base row"
    );
    await menu("Edit commits after this (interactive rebase)…");
    await until(
      () => graph.evaluate('document.querySelectorAll("[role=dialog] select").length === 3'),
      "interactive plan"
    );
    await graph.evaluate(
      `(() => { const selects = [...document.querySelectorAll('[role=dialog] select')]; ['reword', 'squash', 'drop'].forEach((value, i) => { selects[i].value = value; selects[i].dispatchEvent(new Event('change', {bubbles: true})); }); })()`
    );
    await until(
      () => graph.evaluate('!!document.querySelector("[role=dialog] textarea")'),
      "reword input"
    );
    await graph.evaluate(
      `(() => { const input = document.querySelector('[role=dialog] textarea'); input.value = 'UI rewritten commit'; input.dispatchEvent(new Event('input', {bubbles: true})); })()`
    );
    await button("Start Rebase");
    await finished();
    assert.equal(git(["rev-list", "--count", base + "..HEAD"], second), "1");
    assert.match(git(["log", "-1", "--format=%B"], second), /UI rewritten commit/);
    assert.equal(fs.existsSync(path.join(second, "c")), false);
    const page = connections[0];
    try {
      const screenshot = await page.call("Page.captureScreenshot");
      fs.writeFileSync(
        path.join(artifacts, "workflow.png"),
        Buffer.from(screenshot.data, "base64")
      );
    } catch {}
  });
  test("squashes three selected commits through the interactive rebase editor", async () => {
    const dir = directory();
    init(dir);
    commit("f", "squash base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    commit("a", "squash first", dir);
    commit("b", "squash second", dir);
    commit("c", "squash third", dir);
    commit("later", "squash later", dir);
    const head = git(["rev-parse", "HEAD"], dir);
    const tree = git(["rev-parse", "HEAD^{tree}"], dir);
    await openRepo(dir);
    await selectCommits(["squash first", "squash second", "squash third"]);
    await button("Squash 3 Commits…");
    await until(
      () => graph.evaluate('document.querySelectorAll("[role=dialog] select").length === 4'),
      "squash plan"
    );
    assert.equal(
      await graph.evaluate(
        '[...document.querySelectorAll("[role=dialog] select")].map(s=>s.value).join(",")'
      ),
      "pick,squash,squash,pick"
    );
    // The combined commit's message is offered as Git would combine it, after the group.
    const combined = "[role=dialog] [data-combined] textarea";
    assert.equal(
      await graph.evaluate(`document.querySelector(${JSON.stringify(combined)}).value`),
      "squash first\n\nsquash second\n\nsquash third"
    );
    assert.equal(
      await graph.evaluate(
        `[...document.querySelectorAll("[role=dialog] [data-entry], [role=dialog] [data-combined]")].map(e => e.dataset.combined ? "message" : "commit").join(",")`
      ),
      "commit,commit,commit,message,commit"
    );
    const edited = "Squashed in the UI ✓\n\n# kept heading\n'quoted' $(not run)";
    await graph.evaluate(
      `(() => { const input = document.querySelector(${JSON.stringify(combined)}); input.focus(); input.value = ${JSON.stringify(edited)}; input.dispatchEvent(new Event('input', {bubbles: true})); })()`
    );
    // Opening the editor rewrites nothing; the user starts the rebase.
    assert.equal(git(["rev-parse", "HEAD"], dir), head);
    await button("Start Rebase");
    await finished();
    assert.equal(
      git(["log", "--reverse", "--format=%s", base + "..HEAD"], dir),
      "Squashed in the UI ✓\nsquash later"
    );
    assert.equal(git(["log", "-1", "--format=%B", "HEAD^"], dir), edited);
    assert.equal(
      git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD^"], dir),
      "a\nb\nc"
    );
    assert.equal(git(["rev-parse", "HEAD^{tree}"], dir), tree);
    await button("Clear Selection");
  });

  test("searches past the loaded graph and keeps saved filters per repository", async () => {
    const history = directory();
    init(history);
    commit("old.txt", "original content", history);
    git(["commit", "--allow-empty", "-m", "historical needle"], history);
    git(["mv", "old.txt", "current.txt"], history);
    git(["commit", "-m", "rename historical file"], history);
    for (let i = 0; i < 305; i++) {
      git(["commit", "--allow-empty", "-m", "recent commit " + i], history);
    }
    await openRepo(history);
    assert.equal(
      await graph.evaluate(
        'document.querySelector("tbody").innerText.includes("historical needle")'
      ),
      false
    );
    if (!(await graph.evaluate('!!document.querySelector("[data-history-search]")'))) {
      await button("Search history", 'document.querySelector("header")');
    }
    await graph.evaluate(
      `(() => { const input = document.querySelector('[data-history-search]'); input.value = 'historical needle'; input.dispatchEvent(new Event('input', {bubbles:true})); })()`
    );
    await button("Search", 'document.querySelector("form[role=search]")');
    await until(
      () =>
        graph.evaluate(
          'document.querySelectorAll("tr[data-commit-hash]").length === 1 && document.querySelector("tbody").innerText.includes("historical needle")'
        ),
      "full history search"
    );
    await button("Filters");
    await button("Save Filter");
    await fill(["Historical needle"]);
    await button("Save");
    await finished();
    await openRepo(repo);
    assert.equal(await graph.evaluate('document.querySelector("[data-history-search]").value'), "");
    await openRepo(history);
    assert.equal(
      await graph.evaluate('document.querySelector("[data-history-search]").value'),
      "historical needle"
    );
    assert.equal(
      await graph.evaluate(
        '[...document.querySelectorAll("select")].some(select => select.textContent.includes("Historical needle"))'
      ),
      true
    );
    await button("Return to Graph");
    await vscode.commands.executeCommand(
      "branchwise.fileHistory",
      vscode.Uri.file(path.join(history, "current.txt"))
    );
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("main").innerText.includes("current.txt") && document.querySelector("tbody").innerText.includes("original content")'
        ),
      "Explorer file history follows rename"
    );
    await contextCommit("original content");
    await menu("Restore File Contents");
    assert.equal(
      await graph.evaluate('document.querySelector("[role=dialog] input").value'),
      "current.txt"
    );
    await button("Preview Restore");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("Historical source: old.txt")'
        ),
      "historical path restore preview"
    );
    await button("Preview Restore");
    await until(
      () => vscode.window.activeTextEditor?.document.uri.scheme === "branchwise",
      "native restore diff"
    );
    await vscode.commands.executeCommand("branchwise.view", {
      rootUri: vscode.Uri.file(history)
    });
    await button("Restore File Contents");
    await finished();
    assert.equal(fs.readFileSync(path.join(history, "current.txt"), "utf8"), "original content");
    assert.equal(git(["diff", "--cached"], history), "");
    await button("Return to Graph");
  });

  test("finds commits by tag, branch and typed fields, and jumps back to HEAD", async () => {
    const named = directory();
    init(named);
    commit("release.txt", "tagged release", named);
    git(["tag", "v1.2.3"], named);
    git(["commit", "--allow-empty", "-m", "hotfix work"], named);
    git(["branch", "hotfix"], named);
    for (let i = 0; i < 120; i++) {
      git(["commit", "--allow-empty", "-m", "later commit " + i], named);
    }
    const head = git(["rev-parse", "HEAD"], named);
    await openRepo(named);
    await openSearch();
    const screenshot = async (name) => {
      const shot = await connections[0].call("Page.captureScreenshot");
      fs.writeFileSync(path.join(artifacts, name), Buffer.from(shot.data, "base64"));
    };

    // A typed field moves into Filters and limits the results to the tag's commit.
    await searchHistory("tag:v1.2");
    await until(
      async () => JSON.stringify(await commitRows()).includes("tagged release"),
      "tag search"
    );
    assert.equal((await commitRows()).length, 1);
    assert.equal(await graph.evaluate('document.querySelector("[data-history-search]").value'), "");
    assert.equal(await searchField("Tag name contains"), "v1.2");
    await screenshot("search-tag.png");

    // Plain text searches messages and offers the branches and tags whose names hold it.
    await button("Clear Filters", 'document.querySelector("form[role=search]")');
    // The row takes the cleared filter a frame later; type after the graph is back.
    await until(() => graph.evaluate(visible(head)), "graph after clearing");
    await delay(200);
    await searchHistory("hotfix");
    await until(
      () => graph.evaluate("!!document.querySelector(\"main button[title='refs/heads/hotfix']\")"),
      "matching branch chip"
    );
    const found = await commitRows();
    assert.equal(found.length, 1);
    assert.ok(found[0].includes("hotfix work"));
    await screenshot("search-matching-refs.png");
    await graph.evaluate(
      "document.querySelector(\"main button[title='refs/heads/hotfix']\").click()"
    );
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("main").innerText.includes("History at refs/heads/hotfix")'
        ),
      "history at the branch"
    );
    await button("Return to Graph");

    // Jump to HEAD stands out once the checked-out commit scrolls away, and brings it back.
    await until(() => graph.evaluate(visible(head)), "graph rows");
    await graph.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("header button[aria-label=\'Jump to HEAD\']").title === "Jump to HEAD, which is out of sight"'
        ),
      "Jump to HEAD highlighted"
    );
    await screenshot("jump-to-head-highlighted.png");
    await button("Jump to HEAD", 'document.querySelector("header")');
    await until(
      () =>
        graph.evaluate(
          `document.activeElement?.dataset.commitHash === ${JSON.stringify(head)} && document.querySelector("header button[aria-label='Jump to HEAD']").title === "Jump to HEAD"`
        ),
      "HEAD in view and focused"
    );
  });

  test("finds the commits whose changes add or remove text", async () => {
    const changed = directory();
    init(changed);
    // The messages never name the text, so only the changes can find these commits.
    const save = (file, value, message) => {
      fs.writeFileSync(path.join(changed, file), value);
      git(["add", "--", file], changed);
      git(["commit", "-m", message], changed);
    };
    save("config.js", "function loadSettings() {}\n", "add the loader");
    save("other.js", "const unrelated = 1;\n", "unrelated work");
    save("config.js", "function loadSettings(file) {}\n", "take a file");
    save("config.js", "// gone\n", "drop the loader");
    await openRepo(changed);
    await openSearch();

    // The literal text: the commits that change how often it appears.
    await searchHistory("changes:loadSettings");
    await until(async () => (await commitRows()).length === 2, "commits that add or remove it");
    const literal = await commitRows();
    assert.ok(literal[0].includes("drop the loader"), literal[0]);
    assert.ok(literal[1].includes("add the loader"), literal[1]);
    assert.equal(await graph.evaluate('document.querySelector("[data-history-search]").value'), "");
    assert.equal(await searchField("Text added or removed"), "loadSettings");

    // As a regular expression: every commit that adds or removes a matching line.
    await graph.evaluate(
      '[...document.querySelectorAll("form[role=search] label")].find(label => label.innerText.includes("Regular expressions")).querySelector("input").click()'
    );
    await button("Search", 'document.querySelector("form[role=search]")');
    await until(async () => (await commitRows()).length === 3, "commits with matching lines");
    const lines = await commitRows();
    assert.deepEqual(
      ["drop the loader", "take a file", "add the loader"].map((subject, index) =>
        lines[index].includes(subject)
      ),
      [true, true, true],
      JSON.stringify(lines)
    );
  });

  test("widens a search that found nothing with the buttons it offers", async () => {
    const dir = directory();
    init(dir);
    const save = (file, value, message) => {
      fs.writeFileSync(path.join(dir, file), value);
      git(["add", "--", file], dir);
      git(["commit", "-m", message], dir);
    };
    save("config.js", "function readOptions() {}\n", "add the reader");
    save("other.js", "const unrelated = 1;\n", "unrelated work");
    await openRepo(dir);
    await openSearch();

    const offered = () =>
      graph.evaluate(
        '[...document.querySelectorAll("[data-no-matches] button")].map(button => button.textContent)'
      );
    // No message names the text, and nobody by that name committed.
    await searchHistory("readOptions author:nobody");
    await until(async () => (await offered()).includes("Clear filters (1)"), "no-match buttons");
    assert.ok(
      (await offered()).includes("Search changes instead"),
      JSON.stringify(await offered())
    );
    assert.equal(await searchField("Author name or email"), "nobody");

    await button("Clear filters (1)", 'document.querySelector("[data-no-matches]")');
    // The search runs again: the buttons go while it loads, and come back for what it found.
    await until(
      async () =>
        JSON.stringify(await offered()) === JSON.stringify(["Search changes instead"]) &&
        (await searchField("Author name or email")) === "",
      "filters cleared, still nothing"
    );
    assert.equal(
      await graph.evaluate('document.querySelector("[data-history-search]").value'),
      "readOptions"
    );

    await button("Search changes instead", 'document.querySelector("[data-no-matches]")');
    await until(async () => (await commitRows()).length === 1, "the commit that adds the text");
    assert.ok((await commitRows())[0].includes("add the reader"));
    assert.equal(await searchField("Text added or removed"), "readOptions");
    await button("Return to Graph", 'document.querySelector("form[role=search]")');
  });

  test("explains every symbol of the graph in the legend", async () => {
    await openRepo(repo);
    await toolsMenu("Legend");
    const entries = () =>
      graph.evaluate(
        '[...document.querySelectorAll("[role=dialog] [data-legend-entry]")].map(entry => [entry.dataset.legendEntry, entry.querySelector("p").textContent, !!entry.firstElementChild.inert])'
      );
    await until(async () => (await entries()).length >= 13, "legend entries");
    const shown = await entries();
    assert.deepEqual(
      shown.filter(([key]) => ["head", "uncommitted", "conflict", "more"].includes(key)),
      [
        ["head", "Checked-out commit (HEAD)", true],
        ["uncommitted", "Uncommitted changes", true],
        ["conflict", "Conflict forecast", true],
        ["more", "More labels", true]
      ]
    );
    assert.ok(
      shown.every(([, , inert]) => inert),
      JSON.stringify(shown)
    );
    // The dots are the graph's own, drawn at the graph's size.
    assert.equal(
      await graph.evaluate(
        'document.querySelector("[role=dialog] [data-legend-entry=commit] svg circle").getAttribute("r")'
      ),
      "4"
    );
    await button("Close");
    await until(() => graph.evaluate('!document.querySelector("[role=dialog]")'), "legend closed");
  });

  test("goes to a branch, tag or typed commit ID from the quick switcher", async () => {
    const named = directory();
    init(named);
    commit("goto.txt", "goto branch target", named);
    git(["branch", "goto-target"], named);
    const target = git(["rev-parse", "HEAD"], named);
    git(["checkout", "-q", "-b", "goto-side"], named);
    commit("side.txt", "goto side work", named);
    const side = git(["rev-parse", "HEAD"], named);
    git(["checkout", "-q", "main"], named);
    for (let i = 0; i < 80; i++) {
      git(["commit", "--allow-empty", "-m", "goto filler " + i], named);
      if (i === 20) {
        git(["tag", "goto-release"], named);
      }
    }
    const tagged = git(["rev-parse", "goto-release"], named);
    const typed = git(["rev-parse", "HEAD~5"], named);
    await openRepo(named);
    const workbench = connections[0];
    // The quick input belongs to the workbench, outside the graph's frame.
    const pickerText = () =>
      workbench.evaluate(`(() => {
        const widget = document.querySelector('.quick-input-widget');
        return widget && widget.style.display !== 'none' && widget.offsetParent !== null
          ? widget.innerText : null;
      })()`);
    /** Run Go to, type `text`, wait for `expected` to be the active entry, and choose it. */
    const goTo = async (open, text, expected) => {
      await open();
      await until(
        async () => (await pickerText())?.includes("goto-target"),
        "Go to lists the refs"
      );
      await workbench.call("Input.insertText", { text });
      await until(
        () =>
          workbench.evaluate(
            `document.querySelector('.quick-input-list .monaco-list-row.focused')?.innerText.includes(${JSON.stringify(expected)})`
          ),
        "Go to entry " + expected
      );
      await keypress("Enter");
      await until(async () => (await pickerText()) === null, "Go to closes");
    };
    /**
     * The commit's row has the keyboard, is selected and is on screen. Until it is, each check
     * throws what it saw, so a timeout reports which of the three was missing.
     */
    const revealed = (hash) =>
      until(
        async () => {
          const state = await graph.evaluate(`(() => {
          const row = document.querySelector('tr[data-commit-hash="${hash}"]');
          const active = document.activeElement;
          const box = row?.getBoundingClientRect();
          return {
            focused: active === row,
            active: active === document.body ? "body" : active?.dataset?.commitHash ?? active?.getAttribute?.("aria-label") ?? active?.tagName ?? null,
            pageHasFocus: document.hasFocus(),
            selected: row?.getAttribute("aria-selected") ?? null,
            top: box ? Math.round(box.top) : null,
            bottom: box ? Math.round(box.bottom) : null,
            height: innerHeight
          };
        })()`);
          if (
            state.focused &&
            state.selected === "true" &&
            state.top >= 0 &&
            state.bottom <= state.height
          ) {
            return true;
          }
          throw new Error("Row state: " + JSON.stringify(state));
        },
        "revealed and selected " + hash.slice(0, 8)
      );

    assert.equal(
      await graph.evaluate(
        `document.querySelector('tr[data-commit-hash="${target}"]').getBoundingClientRect().top > innerHeight`
      ),
      true,
      "the branch's commit starts out of sight"
    );
    const command = () => vscode.commands.executeCommand("branchwise.goTo");
    await goTo(command, "goto-target", "goto-target");
    await revealed(target);
    assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], named), "main");

    await goTo(command, "release", "goto-release");
    await revealed(tagged);

    await goTo(command, typed.slice(0, 10), typed.slice(0, 10));
    await revealed(typed);

    // The shortcut works while the graph has focus. A row can be focused while the workbench
    // still holds the keyboard after the last picker closed, so bring the graph forward first.
    await until(async () => {
      if (!(await graph.evaluate("document.hasFocus()"))) {
        await vscode.commands.executeCommand("branchwise.view");
      }
      await graph.evaluate(`document.querySelector('tr[data-commit-hash="${typed}"]').focus()`);
      return graph.evaluate(
        `document.hasFocus() && document.activeElement?.dataset?.commitHash === "${typed}"`
      );
    }, "the graph has the keyboard");
    const shortcut = () => keypress("g", process.platform === "darwin" ? 1 | 4 : 1 | 2);
    await goTo(shortcut, "goto-target", "goto-target");
    await revealed(target);

    // A commit the graph has not loaded opens as the history at it, with its row selected.
    await headerChoice("Branch", "main");
    await until(() => graph.evaluate(`!(${visible(side)})`), "graph filtered to main");
    await goTo(command, "goto-side", "goto-side");
    await until(
      () => graph.evaluate('document.querySelector("main").innerText.includes("History at")'),
      "history at the side branch"
    );
    await revealed(side);
    await button("Return to Graph");
    await headerChoice("Branch", "All branches");
  });

  test("compares branch contributions, opens native diffs and recovers a reflog commit", async () => {
    const history = directory();
    init(history);
    commit("base", "common base", history);
    const base = git(["rev-parse", "HEAD"], history);
    git(["checkout", "-b", "ui-left"], history);
    commit("left.txt", "left change", history);
    git(["checkout", "-b", "ui-right", base], history);
    commit("right.txt", "right change", history);
    await openRepo(history);
    await button("Compare", 'document.querySelector("header")');
    await until(
      () => graph.evaluate('document.querySelectorAll("[role=dialog] input").length >= 3'),
      "comparison fields"
    );
    await fill(["ui-left", "ui-right"]);
    await button("Compare");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("left.txt") && document.querySelector("[role=dialog]").innerText.includes("right.txt")'
        ),
      "endpoint files"
    );
    await graph.evaluate(
      `(() => { const input = document.querySelector('[role=dialog] input[type=checkbox]'); input.click(); })()`
    );
    await button("Compare");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("Changed Files (1)")'
        ),
      "merge-base changes"
    );
    await graph.evaluate(
      `(() => { const button = [...document.querySelectorAll('[role=dialog] li button')].find(b => b.textContent.includes('right.txt')); button.click(); })()`
    );
    await until(
      () => vscode.window.activeTextEditor?.document.uri.scheme === "branchwise",
      "native comparison diff"
    );
    await vscode.commands.executeCommand("branchwise.view", {
      rootUri: vscode.Uri.file(history)
    });
    assert.equal(
      await graph.evaluate(
        'document.querySelector("[role=dialog]").innerText.includes("Compare Revisions")'
      ),
      true
    );
    await button("Close");
    commit("lost", "lost contents", history);
    const lost = git(["rev-parse", "HEAD"], history);
    git(["reset", "--hard", "HEAD^"], history);
    await button("Refresh");
    await until(
      () => graph.evaluate('!document.querySelector("tbody").innerText.includes("lost contents")'),
      "graph without the reset commit"
    );
    await toolsMenu("Recover lost commits (reflog)");
    // The reflog opens as a tab; only commits no branch reaches are the ones worth recovering.
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('[data-view-tab="reflog"]')?.getAttribute('aria-selected') === 'true' && !!document.querySelector('[data-reflog-view] tbody')?.innerText.includes(${JSON.stringify(lost.slice(0, 8))})`
        ),
      "reflog tab with the reset commit"
    );
    await graph.evaluate(
      `[...document.querySelectorAll('[data-reflog-view] label')].find(label => label.textContent.includes('Only commits no branch reaches')).querySelector('input').click()`
    );
    await until(
      () =>
        graph.evaluate(
          `(() => { const rows = [...document.querySelectorAll('[data-reflog-view] tbody tr')]; return rows.length > 0 && rows.every(row => row.innerText.includes('Not on any branch')) && rows.some(row => row.innerText.includes(${JSON.stringify(lost.slice(0, 8))})); })()`
        ),
      "lost commits only"
    );
    const reflogShot = await connections[0].call("Page.captureScreenshot");
    fs.writeFileSync(
      path.join(artifacts, "reflog-tab.png"),
      Buffer.from(reflogShot.data, "base64")
    );
    await graph.evaluate(
      `(() => { const row = [...document.querySelectorAll('[data-reflog-view] tbody tr')].find(row => row.innerText.includes(${JSON.stringify(lost.slice(0, 8))})); row.querySelector('button[aria-haspopup=menu]').click(); })()`
    );
    await menu("Create Recovery Branch…");
    await fill(["ui-recovered"]);
    await button("Create Recovery Branch");
    await finished();
    assert.equal(git(["rev-parse", "ui-recovered"], history), lost);
    assert.notEqual(git(["rev-parse", "HEAD"], history), lost);
    // Recovered, the commit is on a branch again, so the lost-only list lets it go.
    await until(
      () =>
        graph.evaluate(
          `!document.querySelector('[data-reflog-view] tbody')?.innerText.includes(${JSON.stringify(lost.slice(0, 8))})`
        ),
      "recovered commit no longer lost"
    );
    // The tab is remembered; later scenarios expect the graph.
    await graph.evaluate(`document.querySelector('[data-view-tab="graph"]').click()`);
    await until(() => graph.evaluate('!document.querySelector("[data-reflog-view]")'), "graph tab");
  });

  test("opens all of a commit's or a comparison's changes in one multi-file diff editor", async () => {
    const dir = directory();
    init(dir);
    commit("keep.txt", "all changes base", dir);
    fs.writeFileSync(path.join(dir, "gone.txt"), "going\n");
    git(["add", "gone.txt"], dir);
    git(["commit", "-q", "-m", "all changes setup"], dir);
    const base = git(["rev-parse", "HEAD"], dir);
    fs.writeFileSync(path.join(dir, "keep.txt"), "changed\n");
    fs.writeFileSync(path.join(dir, "added.txt"), "new\n");
    fs.rmSync(path.join(dir, "gone.txt"));
    git(["add", "-A"], dir);
    git(["commit", "-q", "-m", "all changes target"], dir);
    const target = git(["rev-parse", "HEAD"], dir);
    await openRepo(dir);
    const workbench = connections[0];
    /** Close the diff editor and bring the graph back. */
    const closeChanges = async () => {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await vscode.commands.executeCommand("branchwise.view", { rootUri: vscode.Uri.file(dir) });
    };
    /** The active tab is a multi-file diff titled `title`, then its file count, listing `files`. */
    const multiDiff = (title, files) =>
      until(async () => {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (
          tab?.label !== `${title} (${files.length} files)` ||
          tab.input instanceof vscode.TabInputText ||
          tab.input instanceof vscode.TabInputTextDiff
        ) {
          return false;
        }
        const text = await workbench.evaluate(
          `[...document.querySelectorAll('.multiDiffEditor')].map(e => e.innerText).join('\\n')`
        );
        return files.every((file) => text.includes(file));
      }, "multi-file diff " + title);

    await graph.evaluate(`document.querySelector('tr[data-commit-hash="${target}"]').click()`);
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('[data-details-row] [data-file-list-header]')?.innerText.includes('Changed Files (3)')`
        ),
      "changed file list header"
    );
    await button("Open All Changes", 'document.querySelector("[data-details-row]")');
    await multiDiff(`Changes in ${target.slice(0, 8)}`, ["added.txt", "gone.txt", "keep.txt"]);
    await closeChanges();

    // The same from the commit menu, and from a comparison's file list.
    // The graph coming back can scroll, which closes a menu, so the menu opens until it is used.
    await until(
      () =>
        graph.evaluate(`(() => {
          const item = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.trim() === "Open All Changes");
          if (item) { item.click(); return true; }
          const row = document.querySelector('tr[data-commit-hash="${target}"]');
          row?.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: 180, clientY: 240}));
          return false;
        })()`),
      "commit menu Open All Changes"
    );
    await multiDiff(`Changes in ${target.slice(0, 8)}`, ["added.txt", "gone.txt", "keep.txt"]);
    await closeChanges();

    await button("Compare", 'document.querySelector("header")');
    await until(
      () => graph.evaluate('document.querySelectorAll("[role=dialog] input").length >= 2'),
      "comparison fields"
    );
    await fill([base, target]);
    await button("Compare");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("Changed Files (3)")'
        ),
      "compared files"
    );
    await button("Open All Changes");
    await multiDiff(`${base.slice(0, 8)} ↔ ${target.slice(0, 8)}`, [
      "added.txt",
      "gone.txt",
      "keep.txt"
    ]);
    // The comparison stays open behind the editor.
    assert.equal(
      await graph.evaluate(
        '!!document.querySelector("[role=dialog]")?.innerText.includes("Compare")'
      ),
      true
    );
    await closeChanges();
    await button("Close");
  });

  test("counts contributors and daily activity in the Statistics tab", async () => {
    const counted = directory();
    init(counted);
    const day = 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);
    const at = (daysAgo, author, message) => {
      const date = `${now - daysAgo * day} +0000`;
      cp.execFileSync("git", ["commit", "--allow-empty", `--author=${author}`, "-m", message], {
        cwd: counted,
        stdio: "pipe",
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
      });
    };
    for (let i = 0; i < 40; i++) {
      at(i * 7 + (i % 3), "Ann Lee <ann@example.test>", "ann " + i);
    }
    for (let i = 0; i < 12; i++) {
      at(i * 3, "Bob Stone <bob@example.test>", "bob " + i);
    }
    await openRepo(counted);
    await graph.evaluate(`document.querySelector('[data-view-tab="statistics"]').click()`);
    await until(
      () =>
        graph.evaluate(
          `[...document.querySelectorAll('[data-statistics-view] [data-contributor]')].map(b => b.dataset.contributor).join() === 'ann@example.test,bob@example.test'`
        ),
      "contributors by commit count"
    );
    assert.equal(
      await graph.evaluate(
        `[...document.querySelectorAll('[data-statistics-view] rect')].filter(r => Number(r.dataset.count) > 0).length > 20`
      ),
      true
    );
    const shot = await connections[0].call("Page.captureScreenshot");
    fs.writeFileSync(path.join(artifacts, "statistics-tab.png"), Buffer.from(shot.data, "base64"));
    // A contributor opens their commits in the graph.
    await graph.evaluate(
      `document.querySelector('[data-statistics-view] [data-contributor="bob@example.test"]').click()`
    );
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('[data-view-tab="graph"]').getAttribute('aria-selected') === 'true' && document.querySelectorAll('tr[data-commit-hash]').length === 12`
        ),
      "Bob's commits in the graph"
    );
    await button("Return to Graph");
  });

  test("marks unpushed and unpulled commits, links issues and copies short and full IDs", async () => {
    const dir = directory();
    init(dir);
    commit("f", "shared base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    commit("f", "fetched only", dir);
    const fetched = git(["rev-parse", "HEAD"], dir);
    git(["remote", "add", "origin", "git@github.com:owner/project.git"], dir);
    git(["update-ref", "refs/remotes/origin/main", fetched], dir);
    git(["reset", "--hard", base], dir);
    git(["branch", "--set-upstream-to=origin/main"], dir);
    commit("f", "Fix the parser (#42)\n\nUse `parse()` here.", dir);
    const local = git(["rev-parse", "HEAD"], dir);
    await openRepo(dir);
    const push = (hash) =>
      graph.evaluate(
        `document.querySelector('tr[data-commit-hash="${hash}"] [data-push]')?.dataset.push ?? null`
      );
    await until(async () => (await push(local)) === "unpushed", "unpushed dot");
    assert.equal(await push(fetched), "unpulled");
    assert.equal(await push(base), null);

    await graph.evaluate(`document.querySelector('tr[data-commit-hash="${local}"]').click()`);
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('[data-details-row] a[href="https://github.com/owner/project/issues/42"]')?.textContent === "#42"`
        ),
      "issue link"
    );
    assert.equal(
      await graph.evaluate(`document.querySelector('[data-details-row] code')?.textContent`),
      "parse()"
    );
    await button("Copy Short ID", 'document.querySelector("[data-details-row]")');
    await until(
      async () => (await vscode.env.clipboard.readText()) === local.slice(0, 8),
      "short ID copied"
    );
    await button("Copy Full ID", 'document.querySelector("[data-details-row]")');
    await until(async () => (await vscode.env.clipboard.readText()) === local, "full ID copied");
  });

  test("names the branches and tags that contain a commit and jumps to them", async () => {
    const dir = directory();
    init(dir);
    commit("f", "contain base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    git(["tag", "-a", "-m", "earlier", "contain-v1"], dir);
    commit("f", "contain target", dir);
    const target = git(["rev-parse", "HEAD"], dir);
    git(["branch", "contain-feature"], dir);
    commit("f", "contain release", dir);
    git(["tag", "-a", "-m", "release", "contain-v2"], dir);
    commit("f", "contain later", dir);
    git(["tag", "contain-v3"], dir);
    await openRepo(dir);
    await graph.evaluate(`document.querySelector('tr[data-commit-hash="${target}"]').click()`);
    const line = (name) =>
      graph.evaluate(`document.querySelector('[data-details-row] [${name}]')?.innerText ?? null`);
    await until(async () => (await line("data-contained-in")) !== null, "containing branches");
    assert.match(await line("data-contained-in"), /^Contained in:\s*main\s*contain-feature$/);
    assert.match(
      await line("data-released-in"),
      /^First released in\s*contain-v2\s*also in 1 later tag\s*Follows\s*contain-v1$/
    );
    await graph.evaluate(
      `[...document.querySelectorAll('[data-details-row] [data-contained-in] button')].find(b => b.textContent === "contain-feature").click()`
    );
    await until(
      () =>
        graph.evaluate(
          `document.querySelectorAll('[data-focus-branch="contain-feature"]').length > 0`
        ),
      "focused branch from its chip"
    );
    await graph.evaluate(
      `[...document.querySelectorAll('[data-details-row] [data-released-in] button')].find(b => b.textContent === "contain-v1").click()`
    );
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('tr[data-commit-hash="${base}"]')?.getAttribute('aria-selected') === 'true'`
        ),
      "tagged commit selected from its chip"
    );
    await button("Clear focus");
  });

  test("acts on the focused commit with single keys and lists them on the shortcut sheet", async () => {
    const dir = directory();
    init(dir);
    commit("f", "keys base", dir);
    commit("f", "keys target", dir);
    const target = git(["rev-parse", "HEAD"], dir);
    commit("f", "keys head", dir);
    await openRepo(dir);
    const row = `document.querySelector('tr[data-commit-hash="${target}"]')`;
    const focusRow = async () => {
      await graph.evaluate(`${row}.focus()`);
      await until(() => graph.evaluate(`document.activeElement === ${row}`), "focused row");
    };

    // B opens Create Branch; the letters of the name go into its field, not to more shortcuts.
    await focusRow();
    await keypress("b");
    const field = 'document.querySelector("[role=dialog] input[type=text]")';
    await until(() => graph.evaluate(`document.activeElement === ${field}`), "branch name field");
    for (const letter of "byctrim") {
      await keypress(letter);
    }
    assert.equal(await graph.evaluate(`${field}.value`), "byctrim");
    assert.equal(await graph.evaluate('document.querySelectorAll("[role=dialog]").length'), 1);
    await button("Create Branch");
    await finished();
    await until(
      () =>
        graph.evaluate(
          `[...${row}.querySelectorAll('span[title]')].some(label => label.title.split(String.fromCharCode(10))[0] === "byctrim")`
        ),
      "branch label on the row"
    );
    assert.equal(
      git(["for-each-ref", "--format=%(objectname)", "refs/heads/byctrim"], dir),
      target
    );

    // ? opens the sheet, and Escape closes it again.
    await focusRow();
    await keypress("?", 8);
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog] h2")?.textContent === "Keyboard Shortcuts"'
        ),
      "shortcut sheet"
    );
    const listed = await graph.evaluate(
      '[...document.querySelectorAll("[role=dialog] [data-shortcut-id]")].map(row => row.innerText.replace(/\\s+/g, " ").trim())'
    );
    assert.ok(listed.includes("B Create Branch…"), listed.join("\n"));
    // Keys are drawn as VS Code draws them: with symbols on macOS.
    const shift = process.platform === "darwin" ? "⇧" : "Shift+";
    assert.ok(listed.includes(`${shift}Y Copy Commit ID`), listed.join("\n"));
    assert.ok(listed.includes(`${shift}F10 Menu Open the commit's menu`), listed.join("\n"));
    await keypress("Escape");
    await until(() => graph.evaluate('!document.querySelector("[role=dialog]")'), "sheet closed");

    // Y copies the short ID, Shift+Y the full one.
    await vscode.env.clipboard.writeText("");
    await focusRow();
    await keypress("y");
    await until(
      async () => (await vscode.env.clipboard.readText()) === target.slice(0, 8),
      "short ID copied"
    );
    await keypress("Y", 8);
    await until(async () => (await vscode.env.clipboard.readText()) === target, "full ID copied");
    assert.equal(git(["rev-parse", "HEAD"], dir), git(["rev-parse", "main"], dir));
  });

  test("marks a signed commit and checks its signature when its details open", async function () {
    const dir = directory();
    init(dir);
    const key = path.join(directory(), "signer");
    const allowed = path.join(dir, ".git", "allowed_signers");
    const forGit = (file) => file.split(path.sep).join("/");
    try {
      // Signing with SSH keys needs ssh-keygen from OpenSSH 8.2 and Git 2.34.
      cp.execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "", "-f", key], {
        stdio: "pipe"
      });
      git(["config", "gpg.format", "ssh"], dir);
      git(["config", "user.signingkey", forGit(key)], dir);
      commit("f", "unsigned change", dir);
      fs.writeFileSync(path.join(dir, "g"), "signed change");
      git(["add", "g"], dir);
      git(["commit", "-S", "-m", "signed change"], dir);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping the signature scenario, as SSH signing is unavailable: ${error}`);
      this.skip();
    }
    const signed = git(["rev-parse", "HEAD"], dir);
    const unsigned = git(["rev-parse", "HEAD~1"], dir);
    // The allowed signers name nobody yet.
    fs.writeFileSync(allowed, "");
    git(["config", "gpg.ssh.allowedSignersFile", forGit(allowed)], dir);
    await openRepo(dir);

    const mark = (hash) =>
      graph.evaluate(
        `document.querySelector('tr[data-commit-hash="${hash}"] [data-signed]')?.title ?? null`
      );
    await until(
      async () => (await mark(signed)) === "Signed — open the details to verify",
      "signed mark"
    );
    assert.equal(await mark(unsigned), null);

    const verdict = () =>
      graph.evaluate(
        `document.querySelector('[data-details-row] [data-signature]')?.textContent ?? null`
      );
    const open = async (hash) => {
      if (await graph.evaluate('!!document.querySelector("[data-details-row]")')) {
        await button("Close", 'document.querySelector("[data-details-row]")');
        await until(
          () => graph.evaluate('!document.querySelector("[data-details-row]")'),
          "details closed"
        );
      }
      await graph.evaluate(`document.querySelector('tr[data-commit-hash="${hash}"]').click()`);
    };
    await open(signed);
    await until(
      async () => (await verdict()) === "Good signature from a key that is not trusted",
      "untrusted verdict"
    );

    // Once the signer is allowed, opening the details again checks the signature again.
    fs.writeFileSync(allowed, `ui@test ${fs.readFileSync(`${key}.pub`, "utf8").trim()}\n`);
    await open(signed);
    await until(async () => (await verdict()) === "Good signature by ui@test", "good verdict");
    assert.match(
      await graph.evaluate(
        `document.querySelector('[data-details-row] [data-signature]').parentElement.innerText`
      ),
      /Key SHA256:/
    );

    await open(unsigned);
    await until(async () => (await verdict()) === "Unsigned", "unsigned verdict");
  });

  test("forecasts which branches would conflict if merged into the checked-out branch", async () => {
    const dir = directory();
    init(dir);
    commit("f", "forecast base", dir);
    git(["checkout", "-b", "clash"], dir);
    commit("f", "clash change", dir);
    git(["checkout", "-b", "clean", "main"], dir);
    commit("g", "clean change", dir);
    git(["checkout", "main"], dir);
    commit("f", "main change", dir);
    await openRepo(dir);
    const badge = (branch) =>
      graph.evaluate(`(() => {
        const label = [...document.querySelectorAll("tr[data-commit-hash] span[title]")].find(
          (span) => span.title.split("\\n")[0] === ${JSON.stringify(branch)}
        );
        const badge = label?.querySelector("[data-conflicts]");
        return badge ? [badge.textContent, badge.title] : null;
      })()`);
    await until(async () => (await badge("clash")) !== null, "conflict badge on clash");
    assert.deepEqual(await badge("clash"), [
      "1",
      "Merging this branch into main would conflict in:\nf"
    ]);
    assert.equal(await badge("clean"), null);
    assert.equal(await badge("main"), null);
    // Once the branch is merged, there is nothing left to forecast.
    git(["merge", "-X", "theirs", "-m", "merge clash", "clash"], dir);
    await until(async () => (await badge("clash")) === null, "badge gone after the merge");
  });

  test("forecasts the commit a rebase would stop at, and the real rebase stops there", async () => {
    const dir = directory();
    init(dir);
    commit("f", "replay base", dir);
    git(["checkout", "-b", "replay-topic"], dir);
    commit("a", "first replayed item", dir);
    commit("f", "second replayed item", dir);
    const second = git(["rev-parse", "HEAD"], dir);
    commit("c", "third replayed item", dir);
    const tip = git(["rev-parse", "HEAD"], dir);
    git(["checkout", "main"], dir);
    commit("f", "main replay change", dir);
    git(["checkout", "replay-topic"], dir);
    await openRepo(dir);

    await contextRef("main");
    await menu("Move the current branch onto this (rebase)…");
    const forecast = () =>
      graph.evaluate(`(() => {
        const line = document.querySelector("[role=dialog] [data-replay-forecast]");
        return line ? [line.dataset.replayForecast, line.textContent] : null;
      })()`);
    await until(async () => (await forecast())?.[0] === "stop", "rebase forecast");
    assert.deepEqual(await forecast(), [
      "stop",
      `Rebase would stop at ${second.slice(0, 8)} second replayed item: conflicts in f`
    ]);
    // Working out the forecast changed nothing.
    assert.equal(git(["rev-parse", "HEAD"], dir), tip);
    assert.equal(git(["status", "--porcelain"], dir), "");

    await button("Start Rebase");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]")?.innerText.startsWith("Unable") === true'
        ),
      "rebase stopped on a conflict"
    );
    await button("Dismiss");
    assert.equal(git(["rev-parse", "REBASE_HEAD"], dir), second);
    assert.equal(git(["diff", "--name-only", "--diff-filter=U"], dir), "f");
    await until(
      () => graph.evaluate('document.body.innerText.includes("Rebase in progress")'),
      "operation status"
    );
    await button("Abort");
    await button("Abort");
    await finished();
    assert.equal(git(["rev-parse", "HEAD"], dir), tip);
    assert.equal(fs.existsSync(path.join(dir, ".git", "rebase-merge")), false);
  });

  test("warns that a teammate's remote branch would conflict with the checked-out one", async () => {
    const seed = directory();
    init(seed);
    commit("api.ts", "export const total = 1;\n", seed);
    const bare = directory();
    git(["clone", "--bare", seed, bare]);
    const clone = (name) => {
      const dir = directory();
      git(["clone", bare, dir]);
      git(["config", "user.name", name], dir);
      git(["config", "user.email", "ui@test"], dir);
      git(["config", "commit.gpgsign", "false"], dir);
      return dir;
    };
    const local = clone("UI Test");
    const teammate = clone("Alice Teammate");
    git(["checkout", "-b", "teammate"], teammate);
    commit("api.ts", "export const total = 2;\n", teammate);
    git(["push", "origin", "teammate"], teammate);
    // The same line, changed on this side too and not pushed.
    commit("api.ts", "export const total = 3;\n", local);
    await openRepo(local);
    git(["fetch", "origin"], local);
    await button("Refresh");

    const badge = (branch) =>
      graph.evaluate(`(() => {
        const label = [...document.querySelectorAll("tr[data-commit-hash] span[title]")].find(
          (span) => span.title.split("\\n")[0] === ${JSON.stringify(branch)}
        );
        const badge = label?.querySelector("[data-conflicts]");
        return badge ? [badge.textContent, badge.title] : null;
      })()`);
    await until(async () => (await badge("origin/teammate")) !== null, "badge on origin/teammate");
    const [count, title] = await badge("origin/teammate");
    assert.equal(count, "1");
    const lines = title.split("\n");
    assert.deepEqual(lines.slice(0, 2), ["Would conflict with your branch main in:", "api.ts"]);
    assert.match(lines[2], /^Last commit by Alice Teammate, .+ ago$/);
    // The upstream of main is only behind, and gets no mark.
    assert.equal(await badge("origin/main"), null);

    const summary = 'document.querySelector("[data-team-overlap]")';
    await until(
      () =>
        graph.evaluate(
          `${summary}?.innerText.trim() === "1 teammate's branch would conflict with yours"`
        ),
      "team overlap summary"
    );
    await button("1 teammate's branch would conflict with yours", summary);
    const dialog = 'document.querySelector("[role=dialog]")';
    await until(
      () =>
        graph.evaluate(
          `${dialog}?.innerText.includes("Remote branches that would conflict with main")`
        ),
      "team overlap dialog"
    );
    const listed = await graph.evaluate(
      `[...${dialog}.querySelectorAll("[data-team-overlap-branch]")].map(b => b.innerText.replace(/\\s+/g, " ").trim())`
    );
    assert.equal(listed.length, 1);
    assert.match(listed[0], /^origin\/teammate ?1 Last commit by Alice Teammate, .+ ago api\.ts$/);
    await graph.evaluate(
      `${dialog}.querySelector('[data-team-overlap-branch="origin/teammate"]').click()`
    );
    await until(() => graph.evaluate(`!${dialog}`), "dialog closed");
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('main > [role=status] span[title]')?.title === "remotes/origin/teammate"`
        ),
      "teammate branch focused in the graph"
    );

    const nav = `document.querySelector('nav[aria-label="Branches"]')`;
    if (!(await graph.evaluate("!!" + nav))) {
      await button("Branches", 'document.querySelector("header")');
    }
    await until(
      () =>
        graph.evaluate(
          `[...${nav}.querySelectorAll('button[title]')].find(b => b.title === "origin/teammate")?.parentElement.querySelector("[data-conflicts]")?.textContent === "1"`
        ),
      "conflict mark on the remote row"
    );
    // The forecast and the focus left the work tree, the checkout and the branches alone.
    assert.equal(git(["status", "--porcelain"], local), "");
    assert.equal(git(["branch", "--show-current"], local), "main");
    assert.equal(
      git(["for-each-ref", "--format=%(refname)", "refs/heads"], local),
      "refs/heads/main"
    );
  });

  test("tells commits and changes apart by shape, letter and spoken summary as well as colour", async () => {
    const dir = directory();
    init(dir);
    commit("kept", "signal base", dir);
    commit("gone", "signal doomed", dir);
    commit("moved", "a file long enough to be found again after a rename\n".repeat(4), dir);
    git(["checkout", "-b", "topic"], dir);
    commit("side", "signal side", dir);
    git(["checkout", "main"], dir);
    fs.writeFileSync(path.join(dir, "kept"), "signal kept, changed");
    fs.writeFileSync(path.join(dir, "new"), "signal new");
    git(["rm", "-q", "gone"], dir);
    git(["mv", "moved", "renamed"], dir);
    git(["add", "--", "kept", "new"], dir);
    git(["commit", "-m", "signal changes"], dir);
    const changes = git(["rev-parse", "HEAD"], dir);
    git(["merge", "--no-ff", "-m", "signal merge", "topic"], dir);
    const merge = git(["rev-parse", "HEAD"], dir);
    fs.writeFileSync(path.join(dir, "kept"), "signal kept, uncommitted");
    await openRepo(dir);

    const dot = (hash) =>
      graph.evaluate(`(() => {
        const rows = [...document.querySelectorAll("tr[data-commit-hash]")];
        const index = rows.findIndex((row) => row.dataset.commitHash === ${JSON.stringify(hash)});
        const circle = document.querySelectorAll("[data-graph-viewport] circle")[index];
        return circle ? [circle.dataset.dot, circle.hasAttribute("stroke-dasharray")] : null;
      })()`);
    await until(async () => (await dot("*"))?.[0] === "uncommitted", "uncommitted dot");
    assert.deepEqual(await dot("*"), ["uncommitted", true]);
    assert.deepEqual(await dot(merge), ["merge", false]);
    assert.deepEqual(await dot(changes), ["commit", false]);

    const summary = await graph.evaluate(
      `document.querySelector('tr[data-commit-hash="${merge}"]').getAttribute("aria-label")`
    );
    assert.match(
      summary,
      /^signal merge, UI Test, .+, checked out, merge of 2 parents, branch main$/
    );

    // Unset, the lanes take the theme colours, whose defaults are the colours used before.
    assert.equal(
      await graph.evaluate(
        `getComputedStyle(document.documentElement).getPropertyValue("--vscode-branchwise-graphLane1").trim().toLowerCase()`
      ),
      "#0085d9"
    );
    assert.equal(
      await graph.evaluate(`(() => {
        const line = [...document.querySelectorAll("path[data-branch-relation]")].find((path) =>
          path.getAttribute("stroke").startsWith("var(--vscode-branchwise-graphLane1,")
        );
        return line && getComputedStyle(line).stroke;
      })()`),
      "rgb(0, 133, 217)"
    );

    await graph.evaluate(`document.querySelector('tr[data-commit-hash="${changes}"]').click()`);
    const letters = () =>
      graph.evaluate(
        `[...document.querySelectorAll("[data-details-row] [data-change]")].map((cell) => [cell.closest("button").querySelector("span").textContent, cell.textContent, cell.getAttribute("aria-label")])`
      );
    await until(async () => (await letters()).length === 4, "status letters");
    assert.deepEqual(
      (await letters()).toSorted((a, b) => a[0].localeCompare(b[0])),
      [
        ["gone", "D", "Deleted"],
        ["kept", "M", "Modified"],
        ["new", "A", "Added"],
        ["renamed", "R", "Renamed"]
      ]
    );
  });

  test("runs ordered selected cherry-picks and reverts, then creates and autosquashes a fixup", async () => {
    const history = directory();
    init(history);
    commit("f", "batch base", history);
    const base = git(["rev-parse", "HEAD"], history);
    git(["checkout", "-b", "topic"], history);
    commit("one", "batch first", history);
    commit("two", "batch second", history);
    git(["checkout", "main"], history);
    await openRepo(history);
    await selectCommits(["batch second", "batch first"]);
    await button("Cherry-pick Selected");
    await until(
      () => graph.evaluate('document.querySelectorAll("[role=dialog] ol li").length === 2'),
      "batch plan"
    );
    const order = await graph.evaluate(
      '[...document.querySelectorAll("[role=dialog] ol li")].map(li => li.textContent)'
    );
    assert.match(order[0], /batch first/);
    assert.match(order[1], /batch second/);
    await button("Cherry-pick Selected");
    await finished();
    assert.equal(
      git(["log", "-2", "--reverse", "--format=%s"], history),
      "batch first\nbatch second".replace("\\n", "\n")
    );
    await button("Clear Selection");
    await selectCommits(["batch second", "batch first"]);
    await button("Revert Selected");
    await button("Revert Selected");
    await finished();
    assert.equal(git(["diff", base, "HEAD"], history), "");
    await button("Clear Selection");
    const fix = directory();
    init(fix);
    commit("f", "fixup base", fix);
    const fixBase = git(["rev-parse", "HEAD"], fix);
    commit("a", "fixup target", fix);
    commit("b", "unrelated commit", fix);
    fs.writeFileSync(path.join(fix, "a"), "corrected");
    git(["add", "a"], fix);
    await openRepo(fix);
    await contextCommit("fixup target");
    await menu("Fold staged changes into this commit (fixup)…");
    await button("Create Fixup Commit");
    await finished();
    assert.equal(git(["log", "-1", "--format=%s"], fix), "fixup! fixup target");
    await contextCommit("fixup base");
    await menu("Edit commits after this (interactive rebase)…");
    await button("Arrange Fixup / Squash Commits");
    assert.equal(
      await graph.evaluate(
        '[...document.querySelectorAll("[role=dialog] select")].map(s=>s.value).join(",")'
      ),
      "pick,fixup,pick"
    );
    await button("Start Rebase");
    await finished();
    assert.equal(git(["rev-list", "--count", fixBase + "..HEAD"], fix), "2");
    assert.equal(fs.readFileSync(path.join(fix, "a"), "utf8"), "corrected");
    const rebasedHead = git(["rev-parse", "HEAD"], fix);
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('tr[data-commit-hash]')?.dataset.commitHash === ${JSON.stringify(rebasedHead)}`
        ),
      "refreshed rebase history"
    );
    await graph.evaluate(
      `(() => { const row=document.querySelector('tr[data-commit-hash]'); row.focus(); row.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); })()`
    );
    await until(
      () =>
        graph.evaluate(
          'document.activeElement === document.querySelectorAll("tr[data-commit-hash]")[1]'
        ),
      "keyboard focus on the next commit"
    );
    await toolsMenu("Git Activity");
    assert.equal(
      await graph.evaluate(
        'document.querySelector("[role=dialog]").innerText.includes("Create Fixup Commit")'
      ),
      true
    );
    await button("Close");
  });

  test("cherry-picks a dragged commit and merges a dragged branch, each after confirming", async () => {
    const dir = directory();
    init(dir);
    commit("f", "drag base", dir);
    git(["checkout", "-b", "topic"], dir);
    commit("picked.txt", "drag picked", dir);
    const picked = git(["rev-parse", "HEAD"], dir);
    git(["checkout", "-b", "side", "main"], dir);
    commit("side.txt", "drag side", dir);
    const side = git(["rev-parse", "HEAD"], dir);
    git(["checkout", "main"], dir);
    commit("main.txt", "drag main", dir);
    const before = git(["rev-parse", "HEAD"], dir);
    await openRepo(dir);
    const label = (ref) => `document.querySelector('tr[data-commit-hash] [data-ref="${ref}"]')`;

    // The drop only asks: nothing changes until the dialog is confirmed.
    const hint = await dragOnto(
      `document.querySelector('tr[data-commit-hash="${picked}"]')`,
      label("head:main")
    );
    assert.equal(hint, `Cherry-pick ${picked.slice(0, 8)} onto main`);
    await until(
      () => graph.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("Cherry")'),
      "cherry-pick confirmation"
    );
    assert.equal(git(["rev-parse", "HEAD"], dir), before);
    await button("Cherry-pick");
    await finished();
    assert.equal(git(["log", "-1", "--format=%s"], dir), "drag picked");
    assert.equal(git(["rev-parse", "HEAD^"], dir), before);
    const cherryPicked = git(["rev-parse", "HEAD"], dir);
    await until(() => graph.evaluate(visible(cherryPicked)), "cherry-picked commit in the graph");

    assert.equal(await dragOnto(label("head:side"), label("head:main")), "Merge side into main");
    await until(
      () => graph.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("side")'),
      "merge confirmation"
    );
    assert.equal(git(["rev-parse", "HEAD"], dir), cherryPicked);
    await button("Merge");
    await finished();
    assert.equal(git(["rev-parse", "HEAD^1"], dir), cherryPicked);
    assert.equal(git(["rev-parse", "HEAD^2"], dir), side);
    const merge = git(["rev-parse", "HEAD"], dir);
    await until(() => graph.evaluate(visible(merge)), "merge commit in the graph");
  });

  test("edits commit messages and adds staged changes to an older commit in place", async () => {
    const edit = directory();
    init(edit);
    commit("f", "edit base", edit);
    const base = git(["rev-parse", "HEAD"], edit);
    commit("a", "edit target", edit);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"], edit);
    commit("b", "edit later", edit);
    const trees = () => git(["log", "--format=%T"], edit);
    const before = trees();
    await openRepo(edit);
    const typeMessage = (value) =>
      graph.evaluate(
        `(() => { const input = document.querySelector('[role=dialog] textarea'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles: true})); })()`
      );

    // An older commit, already on a remote, is reworded by a rebase.
    await contextCommit("edit target");
    await menu("Edit Message…");
    await until(
      () =>
        graph.evaluate('document.querySelector("[role=dialog] textarea")?.value === "edit target"'),
      "prefilled message"
    );
    assert.match(
      await graph.evaluate('document.querySelector("[role=dialog] [role=alert]")?.textContent'),
      /already on a remote/
    );
    await typeMessage("edit target reworded\n\n#7 stays");
    await button("Save Message");
    await finished();
    assert.equal(
      git(["log", "--format=%s", base + "..HEAD"], edit),
      "edit later\nedit target reworded"
    );
    assert.equal(
      git(["log", "-1", "--format=%B", "HEAD^"], edit),
      "edit target reworded\n\n#7 stays"
    );
    assert.equal(trees(), before);

    // HEAD is amended from its details, keeping what is staged.
    fs.writeFileSync(path.join(edit, "a"), "corrected");
    git(["add", "a"], edit);
    const head = git(["rev-parse", "HEAD"], edit);
    await until(() => graph.evaluate(visible(head)), "rewritten history");
    await graph.evaluate(`document.querySelector('tr[data-commit-hash="${head}"]').click()`);
    await button("Edit Message…", 'document.querySelector("[data-details-row]")');
    await until(
      () =>
        graph.evaluate('document.querySelector("[role=dialog] textarea")?.value === "edit later"'),
      "HEAD message"
    );
    await typeMessage("edit head reworded");
    await button("Save Message");
    await finished();
    assert.equal(git(["log", "-1", "--format=%B"], edit), "edit head reworded");
    assert.equal(git(["diff", "--cached", "--name-only"], edit), "a");

    // The staged change goes into the older commit; the later one is kept.
    await until(async () => {
      await contextCommit("edit target reworded");
      return graph.evaluate(
        `[...document.querySelectorAll('[role="menuitem"]')].some(e => e.textContent.trim() === "Add Staged Changes to This Commit…")`
      );
    }, "menu entry for staged changes");
    await menu("Add Staged Changes to This Commit…");
    await until(
      () =>
        graph.evaluate(
          `(() => { const text = document.querySelector("[role=dialog]")?.innerText || ""; return [...document.querySelectorAll("[role=dialog] li")].map(li => li.textContent).join() === "a" && text.includes("The commit after it is rewritten too"); })()`
        ),
      "staged change confirmation"
    );
    await button("Add Staged Changes");
    await finished();
    assert.equal(
      git(["log", "--format=%s", base + "..HEAD"], edit),
      "edit head reworded\nedit target reworded"
    );
    assert.equal(git(["show", "HEAD^:a"], edit), "corrected");
    assert.equal(git(["status", "--porcelain"], edit), "");
    await button("Settings & Tools");
    await menu("Git Activity");
    await until(
      () =>
        graph.evaluate(
          `(() => { const text = document.querySelector("[role=dialog]").innerText; return text.includes("Edit Message") && text.includes("Add Staged Changes to This Commit"); })()`
        ),
      "edits in Git Activity"
    );
    await button("Close");
  });

  test("splits a commit into two from the commit menu", async () => {
    const dir = directory();
    init(dir);
    commit("f", "split base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    for (const file of ["alpha", "beta", "gamma"]) {
      fs.writeFileSync(path.join(dir, file), file + "\n");
    }
    git(["add", "alpha", "beta", "gamma"], dir);
    git(["commit", "-m", "split three files"], dir);
    const tree = git(["rev-parse", "HEAD^{tree}"], dir);
    // An unrelated change in the working tree stays where it is.
    fs.writeFileSync(path.join(dir, "f"), "uncommitted");
    await openRepo(dir);
    const setValue = (label, value, event) =>
      graph.evaluate(
        `(() => { const input = document.querySelector('[role=dialog] [aria-label=${JSON.stringify(label)}]'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles: true})); })()`
      );
    const preview = () =>
      graph.evaluate('document.querySelector("[role=dialog] [data-split-preview]")?.textContent');

    await contextCommit("split three files");
    await menu("Split Commit…");
    await until(
      () =>
        graph.evaluate(
          `document.querySelector('[role=dialog] [aria-label="Message of Part 1"]')?.value === "split three files"`
        ),
      "split dialog with the original message"
    );
    assert.equal(await preview(), "2 commits: Part 1 (3 files), Part 2 (0 files)");
    await setValue("Part for gamma", "1", "change");
    await setValue("Message of Part 1", "split alpha and beta", "input");
    await setValue("Message of Part 2", "split gamma", "input");
    await until(
      async () => (await preview()) === "2 commits: Part 1 (2 files), Part 2 (1 file)",
      "split preview"
    );
    await button("Split Commit");
    await finished();
    assert.equal(
      git(["log", "--format=%s", base + "..HEAD"], dir),
      "split gamma\nsplit alpha and beta"
    );
    assert.equal(git(["rev-parse", "HEAD^{tree}"], dir), tree);
    assert.equal(git(["status", "--porcelain"], dir), "M f");

    // The graph shows both commits, each with its own files.
    const filesOf = async (subject) => {
      await until(
        () =>
          graph.evaluate(
            `(() => { const row = [...document.querySelectorAll('tr[data-commit-hash]')].find(r => r.textContent.includes(${JSON.stringify(subject)})); if (!row) return false; row.click(); return true; })()`
          ),
        "commit row " + subject
      );
      return until(async () => {
        const names = await graph.evaluate(
          `[...document.querySelectorAll('[data-details-row] li button > span.min-w-0')].map(span => span.textContent).join()`
        );
        const message = await graph.evaluate(
          `document.querySelector('[data-details-row]')?.innerText || ""`
        );
        return message.includes(subject) && names !== "" ? names : false;
      }, "details of " + subject);
    };
    assert.equal(await filesOf("split alpha and beta"), "alpha,beta");
    await button("Close", 'document.querySelector("[data-details-row]")');
    assert.equal(await filesOf("split gamma"), "gamma");
    await button("Close", 'document.querySelector("[data-details-row]")');
  });

  test("absorbs staged fixes into the commits they fix and squashes them in", async () => {
    const dir = directory();
    init(dir);
    commit("base.txt", "absorb base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    const write = (file, text) => fs.writeFileSync(path.join(dir, file), text);
    write("one.txt", "one a\none b\none c\n");
    git(["add", "one.txt"], dir);
    git(["commit", "-m", "absorb first"], dir);
    write("two.txt", "two a\ntwo b\n");
    git(["add", "two.txt"], dir);
    git(["commit", "-m", "absorb second"], dir);
    write("one.txt", "one a\none b fixed\none c\n");
    write("two.txt", "two a fixed\ntwo b\n");
    git(["add", "one.txt", "two.txt"], dir);
    const staged = git(["write-tree"], dir);
    await openRepo(dir);

    await until(
      () => graph.evaluate(`!!document.querySelector('tr[data-commit-hash="*"]')`),
      "uncommitted changes row"
    );
    await graph.evaluate(`document.querySelector('tr[data-commit-hash="*"]').click()`);
    await button("Absorb Staged Changes…", 'document.querySelector("[data-working-tree-details]")');
    await until(
      () =>
        graph.evaluate(
          'document.querySelectorAll("[role=dialog] [data-absorb-target]").length === 2'
        ),
      "absorb preview"
    );
    // Oldest commit first, each with the hunk that fixes its lines; nothing stays staged.
    assert.deepEqual(
      await graph.evaluate(
        '[...document.querySelectorAll("[role=dialog] [data-absorb-target]")].map(s => s.querySelector("h3").textContent.replace(/^\\S+ /, "") + ": " + [...s.querySelectorAll("li")].map(li => li.textContent).join())'
      ),
      ["absorb first: one.txt:2 +1 −1", "absorb second: two.txt:1 +1 −1"]
    );
    assert.equal(await graph.evaluate('!!document.querySelector("[data-absorb-left]")'), false);
    assert.equal(git(["write-tree"], dir), staged);

    await button("Create and Squash Now");
    await until(
      () =>
        graph.evaluate(
          '[...document.querySelectorAll("[role=dialog] select")].map(s => s.value).join() === "pick,fixup,pick,fixup"'
        ),
      "rebase plan with the fixups arranged"
    );
    assert.equal(
      git(["log", "--format=%s", base + "..HEAD"], dir),
      "fixup! absorb second\nfixup! absorb first\nabsorb second\nabsorb first"
    );
    await button("Start Rebase");
    await finished();
    assert.equal(git(["log", "--format=%s", base + "..HEAD"], dir), "absorb second\nabsorb first");
    assert.equal(git(["show", "HEAD~1:one.txt"], dir), "one a\none b fixed\none c");
    assert.equal(git(["diff", "--name-only", "HEAD~1", "HEAD"], dir), "two.txt");
    assert.equal(git(["show", "HEAD:two.txt"], dir), "two a fixed\ntwo b");
    assert.equal(git(["rev-parse", "HEAD^{tree}"], dir), staged);
    assert.equal(git(["status", "--porcelain"], dir), "");
  });

  test("shows nested repository status, updates a submodule and switches its graph from the sidebar", async () => {
    const child = directory();
    init(child);
    commit("f", "submodule base", child);
    commit("a", "submodule latest", child);
    const parent = directory();
    init(parent);
    commit("f", "parent repository", parent);
    git(["-c", "protocol.file.allow=always", "submodule", "add", child, "module"], parent);
    git(["commit", "-am", "record module"], parent);
    const module = path.join(parent, "module");
    const pin = git(["rev-parse", "HEAD"], module);
    git(["checkout", "HEAD^"], module);
    await openRepo(parent);
    if (!(await graph.evaluate('!!document.querySelector("aside")'))) {
      await button("Workspace");
    }
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("aside").innerText.includes("Different from parent revision")'
        ),
      "submodule mismatch"
    );
    await graph.evaluate(
      `document.querySelector('button[aria-label="module Repository Tools"]').click()`
    );
    await menu("Update to Recorded Revision");
    await button("Update to Recorded Revision");
    await finished();
    assert.equal(git(["rev-parse", "HEAD"], module), pin);
    await until(
      () =>
        graph.evaluate(
          `(() => { const b=document.querySelector('aside button[title=${JSON.stringify(repoKey(module))}]'); if(!b)return false;b.click();return true; })()`
        ),
      "submodule sidebar switch"
    );
    await until(
      () =>
        graph.evaluate('document.querySelector("tbody").innerText.includes("submodule latest")'),
      "submodule graph"
    );
    await until(
      () =>
        graph.evaluate(
          `!!document.querySelector('aside button[title=${JSON.stringify(repoKey(parent))}]')`
        ),
      "parent remains in workspace after switching"
    );
    const page = connections[0];
    const screenshot = await page.call("Page.captureScreenshot");
    fs.writeFileSync(path.join(artifacts, "workspace.png"), Buffer.from(screenshot.data, "base64"));
  });

  test("lists a repository cloned inside another under it in a collapsible Workspace tree", async () => {
    const parent = directory();
    init(parent);
    commit("f", "outer repository", parent);
    const inner = path.join(parent, "tools", "inner");
    fs.mkdirSync(inner, { recursive: true });
    init(inner);
    commit("f", "inner repository", inner);
    await openRepo(parent);
    if (!(await graph.evaluate('!!document.querySelector("aside")'))) {
      await button("Workspace");
    }
    const innerRow = `document.querySelector('aside button[title=${JSON.stringify(repoKey(inner))}]')`;
    await until(
      () => graph.evaluate(`${innerRow}?.textContent === "tools/inner"`),
      "nested repository listed by its path in the parent"
    );
    const toggle = `document.querySelector('aside button[aria-label="Hide the repositories inside ${path.basename(parent)}"]')`;
    await graph.evaluate(`${toggle}.click()`);
    await until(() => graph.evaluate(`!${innerRow}`), "nested repository hidden");
    await graph.evaluate(
      `document.querySelector('aside button[aria-label="Show the repositories inside ${path.basename(parent)}"]').click()`
    );
    await until(() => graph.evaluate(`!!${innerRow}`), "nested repository shown again");
    await graph.evaluate(`${innerRow}.click()`);
    await until(
      () =>
        graph.evaluate('document.querySelector("tbody").innerText.includes("inner repository")'),
      "nested repository graph"
    );
  });

  test("reviews submodule commits and stages only the parent pointer", async () => {
    const child = directory();
    init(child);
    commit("f", "pointer base", child);
    const parent = directory();
    init(parent);
    commit("f", "pointer parent", parent);
    git(["-c", "protocol.file.allow=always", "submodule", "add", child, "module"], parent);
    git(["commit", "-am", "record pointer"], parent);
    const module = path.join(parent, "module");
    git(["config", "user.name", "UI Test"], module);
    git(["config", "user.email", "ui@test"], module);
    commit("a", "pointer update", module);
    fs.writeFileSync(path.join(parent, "other"), "staged unrelated");
    git(["add", "other"], parent);
    await openRepo(module);
    await openRepo(parent);
    if (!(await graph.evaluate('!!document.querySelector("aside")'))) {
      await button("Workspace");
    }
    await button("Different from parent revision", 'document.querySelector("aside")');
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("pointer update")'
        ),
      "child commit preview"
    );
    await button("Stage Submodule Pointer");
    await finished();
    assert.equal(
      git(["diff", "--cached", "--name-only"], parent),
      "module\nother".replace("\\n", "\n")
    );
    await button("Parent has a staged revision change", 'document.querySelector("aside")');
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("pointer update")'
        ),
      "staged pointer comparison"
    );
    await button("Unstage Submodule Pointer");
    await finished();
    assert.equal(git(["diff", "--cached", "--name-only"], parent), "other");
  });

  test("fetches and fast-forwards every branch that is only behind, without a checkout", async () => {
    const local = directory();
    init(local);
    commit("f", "ff base", local);
    git(["branch", "topic"], local);
    const bare = directory();
    git(["clone", "--bare", local, bare]);
    git(["remote", "add", "origin", bare], local);
    git(["fetch", "origin"], local);
    git(["branch", "--set-upstream-to=origin/main", "main"], local);
    git(["branch", "--set-upstream-to=origin/topic", "topic"], local);
    const peer = directory();
    git(["clone", bare, peer]);
    git(["config", "user.name", "UI Test"], peer);
    git(["config", "user.email", "ui@test"], peer);
    commit("f", "peer main", peer);
    git(["checkout", "topic"], peer);
    commit("t", "peer topic", peer);
    git(["push", "origin", "main", "topic"], peer);
    await openRepo(local);
    await toolsMenu("Fast-forward Branches");
    const dialog = 'document.querySelector("[role=dialog]")';
    await until(
      () => graph.evaluate(`${dialog}?.innerText.includes("No branch can move")`),
      "nothing to move before fetching"
    );
    await button("Fetch All & Refresh");
    const listed = () =>
      graph.evaluate(
        `[...${dialog}.querySelectorAll("[data-fast-forward-branch]")].map(e => e.dataset.fastForwardBranch).join()`
      );
    await until(async () => (await listed()) === "main,topic", "branches behind after the fetch");
    await button("Fast-forward 2 Branches");
    await until(
      () => graph.evaluate(`${dialog}?.innerText.includes("Fast-forwarded 2 branches.")`),
      "fast-forward result"
    );
    assert.equal(git(["rev-parse", "main"], local), git(["rev-parse", "main"], bare));
    assert.equal(git(["rev-parse", "topic"], local), git(["rev-parse", "topic"], bare));
    assert.equal(git(["branch", "--show-current"], local), "main");
    assert.equal(git(["status", "--porcelain"], local), "");
    await until(async () => (await listed()) === "", "nothing left to move");
    await keypress("Escape");
  });

  test("previews pushes and fast-forward pulls and removes only selected merged branches", async () => {
    const local = directory();
    init(local);
    commit("f", "sync base", local);
    const bare = directory();
    git(["clone", "--bare", local, bare]);
    git(["remote", "add", "origin", bare], local);
    git(["fetch", "origin"], local);
    git(["branch", "--set-upstream-to=origin/main"], local);
    const original = git(["rev-parse", "HEAD"], bare);
    commit("out", "outgoing preview", local);
    await openRepo(local);
    await contextRef("main");
    await menu("Push Branch…");
    await button("Preview Push");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("outgoing preview")'
        ),
      "outgoing commits"
    );
    assert.equal(git(["rev-parse", "HEAD"], bare), original);
    await button("Push Branch");
    await finished();
    assert.equal(git(["rev-parse", "HEAD"], bare), git(["rev-parse", "HEAD"], local));
    const peer = directory();
    git(["clone", bare, peer]);
    git(["config", "user.name", "UI Test"], peer);
    git(["config", "user.email", "ui@test"], peer);
    commit("in", "incoming preview", peer);
    git(["push", "origin", "main"], peer);
    await contextRef("main");
    await menu("Pull Branch…");
    await button("Fetch & Preview Pull");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]")?.innerText.includes("incoming preview")'
        ),
      "incoming commits"
    );
    assert.equal(fs.existsSync(path.join(local, "in")), false);
    await button("Apply Reviewed Fast-forward");
    await finished();
    assert.equal(fs.readFileSync(path.join(local, "in"), "utf8"), "incoming preview");
    git(["branch", "merged-cleanup"], local);
    git(["checkout", "-b", "unmerged-keep"], local);
    commit("keep", "unmerged work", local);
    git(["checkout", "main"], local);
    await button("Refresh");
    await until(
      () => graph.evaluate('document.querySelector("tbody").innerText.includes("merged-cleanup")'),
      "graph with the new branch"
    );
    await toolsMenu("Clean Up Merged Branches");
    await until(
      () =>
        graph.evaluate(
          `(() => {const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent.includes('merged-cleanup'));if(!label)return false;label.querySelector('input').click();return true;})()`
        ),
      "merged branch candidate"
    );
    assert.equal(
      await graph.evaluate(
        'document.querySelector("[role=dialog]").innerText.includes("unmerged-keep")'
      ),
      false
    );
    await button("Delete Selected Branches");
    await button("Delete Selected Branches");
    await finished();
    assert.equal(git(["branch", "--list", "merged-cleanup"], local), "");
    assert.match(git(["branch", "--list", "unmerged-keep"], local), /unmerged-keep/);
  });

  test("fetches selected workspace repositories and keeps independent failure results", async () => {
    const local = directory();
    init(local);
    commit("f", "workspace sync base", local);
    const bare = directory();
    git(["clone", "--bare", local, bare]);
    git(["remote", "add", "origin", bare], local);
    git(["fetch", "origin"], local);
    git(["branch", "--set-upstream-to=origin/main"], local);
    const peer = directory();
    git(["clone", bare, peer]);
    git(["config", "user.name", "UI Test"], peer);
    git(["config", "user.email", "ui@test"], peer);
    commit("new", "workspace incoming", peer);
    git(["push", "origin", "main"], peer);
    const broken = directory();
    init(broken);
    commit("f", "workspace failure", broken);
    git(["remote", "add", "origin", path.join(broken, "missing-remote")], broken);
    await openRepo(broken);
    await openRepo(local);
    await toolsMenu("Workspace Fetch & Update");
    for (const dir of [local, broken]) {
      await until(
        () =>
          graph.evaluate(
            `(() => {const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent.trim()===${JSON.stringify(repoKey(dir))});if(!label)return false;label.querySelector('input').click();return true;})()`
          ),
        "workspace selection"
      );
    }
    await button("Fetch Selected Repositories");
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("Failed") && document.querySelector("[role=dialog]").innerText.includes("Review Update")'
        ),
      "independent fetch results"
    );
    await button("Close");
    await toolsMenu("Workspace Fetch & Update");
    assert.equal(
      await graph.evaluate('document.querySelector("[role=dialog]").innerText.includes("Failed")'),
      true
    );
    await until(
      () =>
        graph.evaluate(
          `(() => {const b=[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.startsWith('Review Update'));if(!b)return false;b.click();return true;})()`
        ),
      "review workspace update"
    );
    await until(
      () =>
        graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("workspace incoming")'
        ),
      "workspace incoming preview"
    );
    await button("Apply Reviewed Fast-forward");
    await until(() => fs.existsSync(path.join(local, "new")), "workspace fast-forward");
    await button("Close");
  });

  test("totals workspace status, filters to a behind repository and pulls only what is safe", async () => {
    const base = directory();
    const repos = {};
    for (const name of ["behind", "dirty", "clean"]) {
      const dir = path.join(base, name);
      fs.mkdirSync(dir);
      init(dir);
      commit("f", `status ${name}`, dir);
      git(["clone", "--bare", "-q", dir, `${name}.git`], base);
      git(["remote", "add", "origin", path.join(base, `${name}.git`)], dir);
      git(["fetch", "origin"], dir);
      git(["branch", "--set-upstream-to=origin/main"], dir);
      repos[name] = dir;
    }
    const peer = path.join(base, "peer");
    git(["clone", "-q", "behind.git", "peer"], base);
    git(["config", "user.name", "UI Test"], peer);
    git(["config", "user.email", "ui@test"], peer);
    commit("incoming", "status incoming", peer);
    git(["push", "origin", "main"], peer);
    git(["fetch", "origin"], repos.behind);
    fs.writeFileSync(path.join(repos.dirty, "f"), "uncommitted");
    const heads = Object.fromEntries(
      Object.entries(repos).map(([name, dir]) => [name, git(["rev-parse", "HEAD"], dir)])
    );
    for (const dir of Object.values(repos)) {
      await openRepo(dir);
    }
    const pane = 'document.querySelector("aside[aria-label=Workspace]")';
    if (!(await graph.evaluate(`!!${pane}`))) {
      await button("Workspace");
    }
    const setNameFilter = (value) =>
      graph.evaluate(
        `(() => { const input = ${pane}.querySelector('input[aria-label="Filter repositories…"]'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event("input", { bubbles: true })); })()`
      );
    const totals = `[...${pane}.querySelectorAll("[data-total]")].map((chip) => chip.textContent).join(" | ")`;
    const rows = `[...${pane}.querySelectorAll("button[title]")].map((row) => row.title).join(" | ")`;
    try {
      await setNameFilter(repoKey(base));
      await until(
        async () =>
          (await graph.evaluate(totals)) ===
          "2 repositories need attention | 1 behind | 1 with changes",
        "workspace status totals"
      );
      await graph.evaluate(`${pane}.querySelector('[data-total="behind"]').click()`);
      await until(
        async () => (await graph.evaluate(rows)) === repoKey(repos.behind),
        "only the repository behind its remote"
      );
      await graph.evaluate(`${pane}.querySelector('[data-total="behind"]').click()`);
      await until(
        async () => (await graph.evaluate(rows)).split(" | ").length === 3,
        "every repository again"
      );
      await button("Pull All", pane);
      await until(
        () =>
          graph.evaluate(
            `(() => { const text = document.querySelector("[role=dialog]")?.innerText ?? ""; return text.includes("main → origin/main, 1 new commits") && text.includes("Skip main: uncommitted changes") && text.includes("Skip main: already up to date"); })()`
          ),
        "pull confirmation"
      );
      assert.equal(git(["rev-parse", "HEAD"], repos.behind), heads.behind);
      await button("Fast-forward 1 Branches");
      await until(
        () =>
          graph.evaluate(
            'document.querySelector("[role=dialog]")?.innerText.includes("1 completed · 2 skipped · 0 failed")'
          ),
        "pull summary"
      );
      assert.equal(git(["rev-parse", "HEAD"], repos.behind), git(["rev-parse", "HEAD"], peer));
      assert.equal(git(["status", "--porcelain"], repos.behind), "");
      assert.equal(git(["rev-parse", "HEAD"], repos.dirty), heads.dirty);
      assert.equal(git(["rev-parse", "HEAD"], repos.clean), heads.clean);
      assert.equal(fs.readFileSync(path.join(repos.dirty, "f"), "utf8"), "uncommitted");
      await button("Close");
      await until(
        async () =>
          (await graph.evaluate(totals)) === "1 repository needs attention | 1 with changes",
        "totals after the pull"
      );
    } finally {
      // The name filter and the chosen total outlive this scenario's repositories otherwise.
      await graph.evaluate(`${pane}?.querySelector('[data-total][aria-pressed="true"]')?.click()`);
      await setNameFilter("").catch(() => {});
    }
  });

  test("guides bisect to a regression, restores the branch, and restores keyboard focus", async () => {
    const history = directory();
    init(history);
    commit("f", "bisect good", history);
    const hashes = [git(["rev-parse", "HEAD"], history)];
    for (let i = 1; i <= 8; i++) {
      git(["commit", "--allow-empty", "-m", "bisect revision " + i], history);
      hashes.push(git(["rev-parse", "HEAD"], history));
    }
    await openRepo(history);
    await contextCommit("bisect good");
    await menu("Use as Good Bisect Commit");
    await button("Start Bisect");
    await finished();
    for (let step = 0; step < 5; step++) {
      await button("Find a Regression (Bisect)");
      await until(
        () =>
          graph.evaluate(
            'document.querySelector("[role=dialog]").innerText.includes("Original checkout")'
          ),
        "bisect candidate"
      );
      if (
        await graph.evaluate(
          'document.querySelector("[role=dialog]").innerText.includes("First bad commit")'
        )
      ) {
        break;
      }
      const head = git(["rev-parse", "HEAD"], history);
      await button(hashes.indexOf(head) >= 4 ? "Mark Bad" : "Mark Good");
      await finished();
    }
    assert.equal(
      await graph.evaluate(
        `document.querySelector('[role=dialog]').innerText.includes(${JSON.stringify(hashes[4])})`
      ),
      true
    );
    await button("Reset Bisect");
    await button("Reset Bisect");
    await finished();
    assert.equal(git(["branch", "--show-current"], history), "main");
    assert.equal(git(["rev-parse", "HEAD"], history), hashes[8]);
    await graph.evaluate(
      `(() => {const b=document.querySelector('header button[aria-label="Compare"]');b.focus();b.click();})()`
    );
    await button("Close");
    await until(
      () => graph.evaluate('document.activeElement.getAttribute("aria-label")==="Compare"'),
      "focus returns to toolbar"
    );
    const page = connections[0];
    await page.call("Emulation.setDeviceMetricsOverride", {
      width: 520,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false
    });
    await button("Compare", 'document.querySelector("header")');
    assert.equal(
      await graph.evaluate(
        '(() => {const r=document.querySelector("[role=dialog]").getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;})()'
      ),
      true
    );
    const screenshot = await page.call("Page.captureScreenshot");
    fs.writeFileSync(
      path.join(artifacts, "narrow-window.png"),
      Buffer.from(screenshot.data, "base64")
    );
    await button("Close");
    await contextCommit("bisect revision 8");
    await graph.evaluate(
      `document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`
    );
    await until(
      () =>
        graph.evaluate(
          `(() => {const menu=document.querySelector('[role=menu]');if(!menu)return false;const active=document.getElementById(menu.getAttribute('aria-activedescendant'));return active && active.getBoundingClientRect().bottom<=menu.getBoundingClientRect().bottom;})()`
        ),
      "long menu keyboard scrolling"
    );
    await graph.evaluate(
      `document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`
    );
    await page.call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false
    });
  });
  test("shows a graph error and retries after a Git configuration failure is repaired", async () => {
    const dir = directory();
    init(dir);
    commit("base", "retry-graph-base", dir);
    // The repository watcher refreshes the graph when .git/config changes. Break an included
    // file outside the repository instead, so only Refresh and Retry reload the graph.
    const included = path.join(directory(), "included.gitconfig");
    fs.writeFileSync(included, "[core]\n");
    git(["config", "include.path", included], dir);
    await openRepo(dir);
    try {
      fs.writeFileSync(included, "[invalid config\n");
      await button("Refresh");
      await until(
        () =>
          graph.evaluate(
            'document.querySelector("[data-graph-error] [role=alert]") !== null && /Unable to load the graph/.test(document.querySelector("[data-graph-error]").innerText)'
          ),
        "recoverable graph error"
      );
      assert.doesNotMatch(
        await graph.evaluate('document.querySelector("main").innerText'),
        /has no commits yet/
      );
    } finally {
      fs.writeFileSync(included, "[core]\n");
    }
    await button("Retry", 'document.querySelector("[data-graph-error]")');
    await until(
      () =>
        graph.evaluate(
          '!document.querySelector("[data-graph-error]") && [...document.querySelectorAll("tbody tr")].some(row => row.innerText.includes("retry-graph-base"))'
        ),
      "graph recovery after retry"
    );
  });

  test("keeps a renamed remote hidden across panel reopening and clears its removed preference", async () => {
    const dir = directory();
    init(dir);
    commit("base", "rename-remote-base", dir);
    git(["remote", "add", "team/upstream", dir], dir);
    const base = git(["rev-parse", "HEAD"], dir);
    const tree = git(["rev-parse", "HEAD^{tree}"], dir);
    const tip = git(["commit-tree", tree, "-p", base, "-m", "rename-remote-only"], dir);
    git(["update-ref", "refs/remotes/team/upstream/topic", tip], dir);
    await openRepo(dir);
    if (!(await graph.evaluate('!!document.querySelector("nav[aria-label=Branches]")'))) {
      await button("Branches", 'document.querySelector("header")');
    }
    const nav = `document.querySelector('nav[aria-label="Branches"]')`;
    const eye = (name) =>
      `${nav}.querySelector('button[aria-label="Show remote ${name} in the graph"]')`;
    await until(() => graph.evaluate(visible(tip)), "remote history before hiding");
    await button("Show remote team/upstream in the graph");
    await until(
      () => graph.evaluate(`${eye("team/upstream")}?.getAttribute('aria-pressed') === 'false'`),
      "hidden remote"
    );
    await button("Actions for remote team/upstream");
    await menu("Rename Remote…");
    await fill(["team/mirror"]);
    await button("Rename Remote");
    await finished();
    await until(
      () =>
        graph.evaluate(
          `${eye("team/mirror")}?.getAttribute('aria-pressed') === 'false' && !${visible(tip)}`
        ),
      "hidden renamed remote"
    );
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await openRepo(dir);
    await until(
      () =>
        graph.evaluate(
          `${eye("team/mirror")}?.getAttribute('aria-pressed') === 'false' && !${visible(tip)}`
        ),
      "restored hidden remote in fresh panel"
    );
    await button("Actions for remote team/mirror");
    await menu("Remove Remote…");
    await button("Remove Remote");
    await finished();
    assert.equal(git(["remote"], dir), "");
    git(["remote", "add", "team/mirror", dir], dir);
    git(["update-ref", "refs/remotes/team/mirror/topic", tip], dir);
    await button("Refresh");
    await until(
      () =>
        graph.evaluate(
          `${eye("team/mirror")}?.getAttribute('aria-pressed') === 'true' && ${visible(tip)}`
        ),
      "re-added remote is visible"
    );
  });

  test("restores repository view preferences after switching, closing and reloading the graph", async () => {
    const first = directory();
    const second = directory();
    for (const dir of [first, second]) {
      init(dir);
      commit("base", "preferences-base", dir);
      git(["branch", "topic"], dir);
      git(["remote", "add", "origin", dir], dir);
      const base = git(["rev-parse", "HEAD"], dir);
      const tree = git(["rev-parse", "HEAD^{tree}"], dir);
      for (let index = 0; index < 16; index++) {
        const tip = git(["commit-tree", tree, "-p", base, "-m", `preferences-lane-${index}`], dir);
        git(["update-ref", `refs/heads/lane-${index}`, tip], dir);
      }
      const remote = git(["commit-tree", tree, "-p", base, "-m", "preferences-remote-only"], dir);
      git(["update-ref", "refs/remotes/origin/topic", remote], dir);
    }
    const refsBefore = git(["show-ref"], first);
    const nav = `document.querySelector('nav[aria-label="Branches"]')`;
    const eye = `${nav}?.querySelector('button[aria-label="Show remote origin in the graph"]')`;
    const remoteRow = `[...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('preferences-remote-only'))`;
    const pan = async () => {
      await graph.evaluate(`(() => {
        const scroll = document.querySelector('[data-graph-scroll]');
        scroll.scrollLeft = 10000; scroll.dispatchEvent(new Event('scroll'));
      })()`);
      await until(
        () => graph.evaluate("document.querySelector('[data-graph-scroll]')?.scrollLeft > 0"),
        "manual panning"
      );
    };
    const checkFirst = (remotesShown = false) =>
      until(
        () =>
          graph.evaluate(`
      !!document.querySelector('header button[title="ancestors"]') &&
      !!document.querySelector('[data-focus-branch="topic"][data-focus-paused="true"]') &&
      document.querySelector('select[aria-label="Dimming"]')?.value === 'strong' &&
      ${eye}?.getAttribute('aria-pressed') === 'false' && !${remoteRow} &&
      ${nav}?.querySelector('button[aria-label="Show Remote Branches in Graph"]')?.getAttribute('aria-pressed') === '${remotesShown}'
    `),
        "first repository preferences"
      );
    const checkStart = () =>
      until(
        () =>
          graph.evaluate(`
      document.querySelector('[data-graph-scroll]')?.scrollLeft === 0 &&
      document.querySelector('[data-graph-viewport]')?.scrollLeft === 0
    `),
        "temporary pan reset"
      );
    try {
      await openRepo(first);
      if (!(await graph.evaluate("!!" + nav))) {
        await button("Branches", 'document.querySelector("header")');
      }
      await contextRef("topic");
      await menu("Focus this branch");
      await headerChoice("View", "Focus all ancestors");
      await graph.evaluate(`(() => {
        const dimming = document.querySelector('select[aria-label="Dimming"]');
        dimming.value = 'strong'; dimming.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await button("Pause focus");
      await button("Show remote origin in the graph");
      await button("Show Remote Branches in Graph", nav);
      await checkFirst();
      await pan();
      const position = await graph.evaluate(
        "document.querySelector('[data-graph-scroll]').scrollLeft"
      );
      await button("Refresh");
      await checkFirst();
      assert.equal(
        await graph.evaluate("document.querySelector('[data-graph-scroll]').scrollLeft"),
        position
      );

      await openRepo(second);
      await until(
        () =>
          graph.evaluate(`
        !!document.querySelector('header button[title="filter"]') &&
        ${eye}?.getAttribute('aria-pressed') === 'true' && ${remoteRow}
      `),
        "independent repository defaults"
      );
      await checkStart();
      await contextRef("main");
      await menu("Focus this branch");
      await openRepo(first);
      await checkFirst();
      await checkStart();
      await pan();
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openRepo(first);
      await checkFirst();
      await checkStart();
      // Turning all remotes on must retain the individual hidden choice.
      await button("Show Remote Branches in Graph", nav);
      await checkFirst(true);
      await button("Show remote origin in the graph");
      await until(() => graph.evaluate(remoteRow), "remote restored after panel recreation");
      await button("Show remote origin in the graph");
      await button("Show Remote Branches in Graph", nav);
      await pan();
      await graph.evaluate("window.__preferenceReloadMarker = true");
      await vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction");
      await until(async () => {
        graph = await findGraph();
        return !(await graph.evaluate("!!window.__preferenceReloadMarker"));
      }, "fresh webview after reload");
      await openRepo(first);
      await checkFirst();
      await checkStart();
      await openRepo(second);
      await until(
        () =>
          graph.evaluate(`
        !!document.querySelector('header button[title="focus"]') &&
        !!document.querySelector('[data-focus-branch="main"][data-focus-paused="false"]') &&
        document.querySelector('select[aria-label="Dimming"]')?.value === 'subtle' && ${remoteRow}
      `),
        "second repository restored after reload"
      );
      await openRepo(first);
      await checkFirst();
      assert.equal(git(["show-ref"], first), refsBefore);
      assert.equal(git(["branch", "--show-current"], first), "main");

      git(["branch", "-m", "topic", "renamed-topic"], first);
      await button("Refresh");
      await until(
        () =>
          graph.evaluate(
            `!!document.querySelector('[data-focus-branch="main"][data-focus-paused="true"]')`
          ),
        "renamed focus target falls back to current branch"
      );
      await headerChoice("Branch", "renamed-topic");
      git(["branch", "-D", "renamed-topic"], first);
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openRepo(first);
      await until(
        () => graph.evaluate(`!!document.querySelector('[data-focus-branch="main"]')`),
        "deleted saved target falls back on reopening"
      );
      await button("Clear focus");
      // Clearing posts the preference to the extension, and closing at once can drop the
      // message on a slow machine. The page's messages arrive in order, so once a refresh
      // posted after it has been answered, the preference is saved.
      git(["branch", "after-clear-focus"], first);
      await button("Refresh");
      await until(
        () => graph.evaluate(`${nav}?.textContent.includes("after-clear-focus") === true`),
        "refresh answered after clearing focus"
      );
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await openRepo(first);
      await until(
        () =>
          graph.evaluate(
            `!!document.querySelector('header button[title="*"]') && !document.querySelector('[data-focus-branch]')`
          ),
        "explicitly cleared focus stays cleared"
      );
    } finally {
      await openRepo(repo);
    }
  });

  test("hides individual remotes and restores their visibility without changing Git refs", async () => {
    const dir = directory();
    init(dir);
    commit("base", "remote-base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    const tree = git(["rev-parse", "HEAD^{tree}"], dir);
    const origin = git(["commit-tree", tree, "-p", base, "-m", "remote-origin-only"], dir);
    const upstream = git(["commit-tree", tree, "-p", base, "-m", "remote-upstream-only"], dir);
    git(["remote", "add", "origin", dir], dir);
    git(["remote", "add", "upstream", dir], dir);
    git(["update-ref", "refs/remotes/origin/topic", origin], dir);
    git(["update-ref", "refs/remotes/upstream/topic", upstream], dir);
    git(["update-ref", "refs/remotes/origin/shared", base], dir);
    const refsBefore = git(["show-ref"], dir);
    await openRepo(dir);
    const nav = `document.querySelector('nav[aria-label="Branches"]')`;
    if (!(await graph.evaluate("!!" + nav))) {
      await button("Branches", 'document.querySelector("header")');
    }
    const eye = (remote) =>
      `${nav}.querySelector('button[aria-label="Show remote ${remote} in the graph"]')`;
    await until(
      () => graph.evaluate(`${visible(origin)} && ${visible(upstream)} && !!${eye("origin")}`),
      "both remote histories"
    );
    await graph.evaluate(`${eye("origin")}.click()`);
    await until(
      () => graph.evaluate(`!${visible(origin)} && ${visible(upstream)} && ${visible(base)}`),
      "one remote hidden"
    );
    assert.equal(await graph.evaluate(`${eye("origin")}.getAttribute('aria-pressed')`), "false");
    assert.ok(await graph.evaluate(`${nav}.innerText.includes('origin')`));
    assert.equal(
      await graph.evaluate(`!!document.querySelector('tbody span[title^="origin/"]')`),
      false
    );
    if (!(await graph.evaluate('!!document.querySelector("[data-history-search]")'))) {
      await button("Search history", 'document.querySelector("header")');
    }
    await graph.evaluate(`(() => {
      const input = document.querySelector('[data-history-search]');
      input.value = 'remote-'; input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await button("Search", 'document.querySelector("form[role=search]")');
    await until(
      () =>
        graph.evaluate(
          `!${visible(origin)} && ${visible(upstream)} && !!document.querySelector('main').innerText.includes('Filtered history')`
        ),
      "search respects hidden remote"
    );
    await button("Return to Graph");
    await headerChoice("Branch", "All branches");
    await graph.evaluate(`document.querySelector('header button[title="*"]').click()`);
    assert.equal(
      await graph.evaluate(
        `[...document.querySelectorAll('[role=option]')].some(option => option.title.startsWith('remotes/origin/'))`
      ),
      false
    );
    await graph.evaluate(`document.querySelector('header button[title="*"]').click()`);
    await openRepo(repo);
    await openRepo(dir);
    await until(
      () =>
        graph.evaluate(
          `!${visible(origin)} && ${visible(upstream)} && ${eye("origin")}?.getAttribute('aria-pressed') === 'false'`
        ),
      "saved remote visibility"
    );
    await graph.evaluate(`${nav}.querySelector('button[title="origin/topic"]').click()`);
    await until(
      () =>
        graph.evaluate(
          `${visible(origin)} && ${eye("origin")}.getAttribute('aria-pressed') === 'true'`
        ),
      "selecting hidden branch reveals it"
    );
    await graph.evaluate(`${eye("origin")}.click()`);
    await until(
      () =>
        graph.evaluate(
          `!${visible(origin)} && ${visible(upstream)} && !!document.querySelector('header button[title="*"]')`
        ),
      "hiding selected remote clears selection"
    );
    await button("Show Remote Branches in Graph", nav);
    await until(
      () => graph.evaluate(`!${visible(origin)} && !${visible(upstream)} && ${visible(base)}`),
      "all remotes hidden"
    );
    await button("Show Remote Branches in Graph", nav);
    await until(
      () => graph.evaluate(`!${visible(origin)} && ${visible(upstream)}`),
      "individual choice retained after global toggle"
    );
    await graph.evaluate(`${eye("origin")}.click()`);
    await until(
      () => graph.evaluate(`${visible(origin)} && ${visible(upstream)}`),
      "remote restored"
    );
    assert.equal(git(["show-ref"], dir), refsBefore);
    assert.equal(git(["branch", "--show-current"], dir), "main");
    const screenshot = await connections[0].call("Page.captureScreenshot");
    fs.writeFileSync(
      path.join(artifacts, "remote-visibility.png"),
      Buffer.from(screenshot.data, "base64")
    );
    await openRepo(repo);
  });

  test("hides branches by name pattern, keeps the patterns and shows the branches again", async () => {
    const dir = directory();
    init(dir);
    commit("base", "pattern-base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    const tree = git(["rev-parse", "HEAD^{tree}"], dir);
    const only = (message) => git(["commit-tree", tree, "-p", base, "-m", message], dir);
    const botOne = only("bot-one-only");
    const botTwo = only("bot-two-only");
    const botRemote = only("bot-remote-only");
    const feature = only("feature-only");
    git(["update-ref", "refs/heads/bot/one", botOne], dir);
    git(["update-ref", "refs/heads/bot/two", botTwo], dir);
    git(["update-ref", "refs/heads/feature", feature], dir);
    git(["branch", "bot/shared", base], dir);
    git(["remote", "add", "origin", dir], dir);
    git(["update-ref", "refs/remotes/origin/bot/remote", botRemote], dir);
    const refsBefore = git(["show-ref"], dir);
    const nav = `document.querySelector('nav[aria-label="Branches"]')`;
    const openPane = async () => {
      if (!(await graph.evaluate("!!" + nav))) {
        await button("Branches", 'document.querySelector("header")');
      }
    };
    const botsHidden = `!${visible(botOne)} && !${visible(botTwo)} && !${visible(botRemote)}`;
    const botsShown = `${visible(botOne)} && ${visible(botTwo)} && ${visible(botRemote)}`;
    const others = `${visible(feature)} && ${visible(base)}`;
    // A branch label's tooltip starts with its name.
    const botLabels = `[...document.querySelectorAll('tbody span[title]')].some(e => /^(origin\\/)?bot\\//.test(e.title))`;
    const paneRow = (title) =>
      `[...${nav}.querySelectorAll('button[title]')].find(b => b.title === ${JSON.stringify(title)})?.parentElement`;
    const editPatterns = async (text) => {
      await button("Settings & Tools", 'document.querySelector("header")');
      await menu("Hidden Branches…");
      await until(
        () => graph.evaluate('!!document.querySelector("[role=dialog] textarea")'),
        "hidden branches dialog"
      );
      await graph.evaluate(`(() => {
        const area = document.querySelector('[role="dialog"] textarea');
        area.value = ${JSON.stringify(text)}; area.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    };

    await openRepo(dir);
    await openPane();
    await until(() => graph.evaluate(`${botsShown} && ${others}`), "every branch's history");

    await editPatterns("bot/*");
    // bot/one, bot/two, bot/shared and origin/bot/remote.
    await until(
      () =>
        graph.evaluate(
          `[...document.querySelectorAll('[data-hidden-branch-preview] li')].map(li => li.querySelector('code').textContent + '=' + li.querySelector('[data-hidden-count]').textContent).join('|') === 'bot/*=4'`
        ),
      "pattern preview"
    );
    await button("Save");
    await until(
      () => graph.evaluate(`${botsHidden} && ${others} && !${botLabels}`),
      "bot branches hidden"
    );
    await until(
      () =>
        graph.evaluate(
          `(document.querySelector('main [data-hidden-branches]')?.innerText || '').includes('4')`
        ),
      "hidden branch count"
    );
    assert.ok(await graph.evaluate(`${paneRow("bot/one")}.className.includes('text-muted')`));
    assert.ok(
      await graph.evaluate(`${paneRow("origin/bot/remote")}.className.includes('text-muted')`)
    );
    assert.equal(
      await graph.evaluate(`${paneRow("feature")}.className.includes('text-muted')`),
      false
    );
    await headerChoice("Branch", "All branches");
    await graph.evaluate(`document.querySelector('header button[title="*"]').click()`);
    assert.deepEqual(
      await graph.evaluate(
        `[...document.querySelectorAll('[role=option]')].map(option => option.title).filter(title => title.includes('bot/'))`
      ),
      []
    );
    await graph.evaluate(`document.querySelector('header button[title="*"]').click()`);

    // Reopening the graph restores the patterns.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await openRepo(dir);
    await openPane();
    await until(
      () => graph.evaluate(`${botsHidden} && ${others} && !${botLabels}`),
      "saved patterns"
    );

    // Choosing a hidden branch shows it, and marks it, without dropping the pattern. One click
    // on its row is enough, once the row is there: the reopened page can show the graph's rows
    // while the Branches pane still waits for the repository state.
    await clickPaneRow("bot/one");
    await until(
      () =>
        graph.evaluate(
          `[...document.querySelectorAll('header button[aria-haspopup="listbox"]')].some(b => b.title === 'bot/one')`
        ),
      "hidden branch chosen"
    );
    await until(
      () =>
        graph.evaluate(
          `${visible(botOne)} && !!document.querySelector('header [data-selection-hidden]')`
        ),
      "chosen hidden branch shown"
    );
    assert.ok(await graph.evaluate(`!!document.querySelector('main [data-hidden-branches]')`));
    await headerChoice("Branch", "All branches");
    await until(
      () =>
        graph.evaluate(
          `${botsHidden} && !document.querySelector('header [data-selection-hidden]')`
        ),
      "hidden again once another branch is chosen"
    );

    await editPatterns("");
    await button("Save");
    await until(
      () =>
        graph.evaluate(
          `${botsShown} && ${others} && ${botLabels} && !document.querySelector('[data-hidden-branches]')`
        ),
      "patterns cleared"
    );
    assert.equal(git(["show-ref"], dir), refsBefore);
    assert.equal(git(["branch", "--show-current"], dir), "main");
    await openRepo(repo);
  });

  for (const style of ["rounded", "angular"]) {
    test(`clips wide graphs after scrolling, resizing, zoom and details (${style})`, async () => {
      const config = vscode.workspace.getConfiguration("branchwise");
      const originalStyle = config.inspect("graphStyle").globalValue;
      const windowConfig = vscode.workspace.getConfiguration("window");
      const originalZoom = windowConfig.inspect("zoomLevel").globalValue;
      const originalPixelRatio = await graph.evaluate("devicePixelRatio");
      try {
        await config.update("graphStyle", style, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        const dir = directory();
        init(dir);
        commit("base", "wide-base", dir);
        const base = git(["rev-parse", "HEAD"], dir);
        const tree = git(["rev-parse", "HEAD^{tree}"], dir);
        for (let index = 0; index < 14; index++) {
          const hash = git(["commit-tree", tree, "-p", base, "-m", "wide-lane-" + index], dir);
          git(["branch", "lane-" + index, hash], dir);
        }
        await openRepo(dir);
        const measure = () =>
          graph.evaluate(`(() => {
      const viewport = document.querySelector('[data-graph-viewport]');
      const scroll = document.querySelector('[data-graph-scroll]');
      const table = document.querySelector('table');
      const description = table.querySelector('thead th:nth-child(2)').getBoundingClientRect();
      return { clipRight: viewport.getBoundingClientRect().right, descriptionLeft: description.left,
        width: viewport.clientWidth, scrollWidth: scroll.scrollWidth, scrollLeft: scroll.scrollLeft,
        viewportScroll: viewport.scrollLeft, overflow: getComputedStyle(viewport).overflowX,
        dots: [...viewport.querySelectorAll('circle')].map(dot => dot.getBoundingClientRect().x),
        rows: [...table.querySelectorAll('tr[data-commit-hash]')].map(row => row.dataset.commitHash) };
    })()`);
        await until(async () => {
          const state = await measure();
          return state.rows.length === 15 && state.scrollWidth > state.width;
        }, "wide graph overflow");
        let before = await measure();
        assert.ok(
          before.clipRight <= before.descriptionLeft + 1,
          "graph cannot paint over description"
        );
        assert.equal(before.overflow, "hidden");
        await graph.evaluate(`(() => {
      const scroll = document.querySelector('[data-graph-scroll]');
      scroll.scrollLeft = 10000; scroll.dispatchEvent(new Event('scroll'));
    })()`);
        let after = await measure();
        assert.ok(after.scrollLeft > 0);
        assert.equal(after.viewportScroll, after.scrollLeft);
        assert.equal(after.descriptionLeft, before.descriptionLeft);
        assert.deepEqual(after.rows, before.rows);
        assert.ok(after.dots[0] < before.dots[0]);
        before = after;
        await graph.evaluate(`document.querySelector('[data-graph-scroll]').focus()`);
        await connections[0].call("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "ArrowLeft",
          code: "ArrowLeft",
          windowsVirtualKeyCode: 37
        });
        await connections[0].call("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "ArrowLeft",
          code: "ArrowLeft",
          windowsVirtualKeyCode: 37
        });
        // Native scrolling and its scroll event can arrive in separate frames, and the keyboard
        // scrolls smoothly over several frames, so wait until two readings in a row agree.
        let previous = null;
        const keyboard = await until(async () => {
          const state = await measure();
          const settled =
            state.scrollLeft < before.scrollLeft &&
            state.viewportScroll === state.scrollLeft &&
            state.scrollLeft === previous?.scrollLeft;
          previous = state;
          return settled && state;
        }, "keyboard graph scrolling");
        assert.equal(keyboard.viewportScroll, keyboard.scrollLeft);
        await graph.evaluate(
          `document.querySelector('tbody td').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, shiftKey: true, deltaY: 20 }))`
        );
        assert.ok((await measure()).scrollLeft > keyboard.scrollLeft, "Shift+wheel scrolls graph");
        await connections[0].call("Emulation.setDeviceMetricsOverride", {
          width: 650,
          height: 850,
          deviceScaleFactor: 1,
          mobile: false
        });
        await until(async () => {
          const state = await measure();
          return (
            (await graph.evaluate("innerWidth < 700")) &&
            state.clipRight <= state.descriptionLeft + 1
          );
        }, "narrow window graph clipping");
        await connections[0].call("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false
        });
        await until(() => graph.evaluate("innerWidth > 1000"), "restored window size");
        await graph.evaluate(`(() => {
      const cell = document.querySelector('thead th');
      const grip = cell.querySelector('[role=separator]');
      const rect = cell.getBoundingClientRect();
      grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.right }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + 40 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
    })()`);
        await until(async () => (await measure()).width < before.width, "narrower graph column");
        before = await measure();
        assert.ok(before.clipRight <= before.descriptionLeft + 1);
        await graph.evaluate(
          `document.querySelector('tbody td').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -50 }))`
        );
        after = await measure();
        assert.ok(after.scrollLeft < before.scrollLeft);
        assert.equal(after.viewportScroll, after.scrollLeft);
        assert.equal(after.descriptionLeft, before.descriptionLeft);
        await graph.evaluate(
          `document.querySelector('tr[data-commit-hash] td:nth-child(2)').click()`
        );
        await until(
          () =>
            graph.evaluate(
              `(() => {
            const selected = document.querySelector('tr[aria-selected="true"]');
            return selected && document.querySelector('td[colspan="4"]')?.textContent.includes(selected.dataset.commitHash);
          })()`
            ),
          "commit selection and expansion after scrolling"
        );
        assert.ok(
          await graph.evaluate(`(() => {
      const rows = [...document.querySelectorAll('tr[data-commit-hash]')];
      return [...document.querySelectorAll('[data-graph-viewport] circle')].every((dot, index) => {
        const vertex = dot.getBoundingClientRect(); const row = rows[index].getBoundingClientRect();
        return Math.abs(vertex.top + vertex.height / 2 - (row.top + row.height / 2)) < 2;
      });
    })()`),
          "graph stays aligned with rows and expanded details"
        );
        assert.equal(
          await graph.evaluate(
            `[...document.querySelectorAll('[data-graph-viewport] path')].some(path => path.getAttribute('d').includes('C'))`
          ),
          style === "rounded",
          "configured graph style"
        );
        const pixelRatio = await graph.evaluate("devicePixelRatio");
        await vscode.commands.executeCommand("workbench.action.zoomIn");
        await until(
          () => graph.evaluate(`devicePixelRatio > ${pixelRatio}`),
          "workbench zoom applied"
        );
        const zoomed = await measure();
        assert.ok(zoomed.clipRight <= zoomed.descriptionLeft + 1, "zoom preserves graph clipping");
        assert.ok(
          await graph.evaluate(`(() => {
      const rows = [...document.querySelectorAll('tr[data-commit-hash]')];
      return [...document.querySelectorAll('[data-graph-viewport] circle')].every((dot, index) => {
        const vertex = dot.getBoundingClientRect(); const row = rows[index].getBoundingClientRect();
        return Math.abs(vertex.top + vertex.height / 2 - (row.top + row.height / 2)) < 2;
      });
    })()`),
          "zoom keeps graph dots aligned with expanded rows"
        );
        await graph.evaluate(
          `(() => { const scroll = document.querySelector('[data-graph-scroll]'); scroll.scrollLeft = 10000; scroll.dispatchEvent(new Event('scroll')); })()`
        );
        assert.equal(
          (await measure()).descriptionLeft,
          zoomed.descriptionLeft,
          "panning after zoom keeps text fixed"
        );
        const screenshot = await connections[0].call("Page.captureScreenshot");
        fs.writeFileSync(
          path.join(artifacts, `wide-graph-scroll-${style}.png`),
          Buffer.from(screenshot.data, "base64")
        );
        await headerChoice("Branch", "main");
        await until(
          async () => (await measure()).rows.length === 1 && (await measure()).viewportScroll === 0,
          "scroll clamps after graph shrinks"
        );
      } finally {
        await config.update("graphStyle", originalStyle, vscode.ConfigurationTarget.Global);
        await windowConfig.update("zoomLevel", originalZoom, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand("workbench.action.zoomReset");
        await connections[0].call("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false
        });
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        await openRepo(repo);
        await until(
          () => graph.evaluate(`Math.abs(devicePixelRatio - ${originalPixelRatio}) < 0.01`),
          "restored workbench zoom"
        );
      }
    });
  }

  for (const [theme, kind] of [
    ["Light Modern", "vscode-light"],
    ["Dark Modern", "vscode-dark"],
    ["Default High Contrast", "vscode-high-contrast"],
    ["Default High Contrast Light", "vscode-high-contrast-light"]
  ]) {
    test(`keeps focus and remote controls readable and keyboard accessible (${theme})`, async () => {
      const workbench = vscode.workspace.getConfiguration("workbench");
      const originalTheme = workbench.inspect("colorTheme").globalValue;
      try {
        const dir = directory();
        init(dir);
        commit("base", "theme-base", dir);
        const base = git(["rev-parse", "HEAD"], dir);
        const tree = git(["rev-parse", "HEAD^{tree}"], dir);
        const main = git(["commit-tree", tree, "-p", base, "-m", "theme-main"], dir);
        const topic = git(["commit-tree", tree, "-p", base, "-m", "theme-merged"], dir);
        const merge = git(["commit-tree", tree, "-p", main, "-p", topic, "-m", "theme-merge"], dir);
        git(["update-ref", "refs/heads/main", merge], dir);
        for (let lane = 0; lane < 14; lane++) {
          const hash = git(["commit-tree", tree, "-p", base, "-m", `theme-side-${lane}`], dir);
          git(["branch", `side-${lane}`, hash], dir);
        }
        const remote = git(["commit-tree", tree, "-p", base, "-m", "theme-remote"], dir);
        git(["remote", "add", "origin", "."], dir);
        git(["update-ref", "refs/remotes/origin/topic", remote], dir);
        const refs = git(["show-ref"], dir);
        await openRepo(dir);
        await workbench.update("colorTheme", theme, vscode.ConfigurationTarget.Global);
        await until(
          () => graph.evaluate(`document.body.classList.contains(${JSON.stringify(kind)})`),
          `applied ${theme}`
        );
        const nav = 'nav[aria-label="Branches"]';
        if (!(await graph.evaluate(`!!document.querySelector('${nav}')`))) {
          await button("Branches", 'document.querySelector("header")');
        }
        await headerChoice("View", "Focus direct history");
        await headerChoice("Branch", "main");
        await until(
          () =>
            graph.evaluate(
              `!!document.querySelector('tr[data-branch-relation="merged"]') && !!document.querySelector('tr[data-branch-relation="unrelated"]')`
            ),
          "focus relations ready"
        );
        const eye = `${nav} button[aria-label='Show remote origin in the graph']`;
        await until(
          () => graph.evaluate(`!!document.querySelector(${JSON.stringify(eye)})`),
          "named remote visibility control"
        );
        await graph.evaluate(`document.querySelector(${JSON.stringify(eye)}).focus()`);
        await keypress("Tab", 8);
        await keypress("Tab");
        await visibleKeyboardFocus(eye);
        const visibleIcon = await graph.evaluate(
          `document.querySelector(${JSON.stringify(eye)}).innerHTML`
        );
        await keypress(" ");
        await until(
          () =>
            graph.evaluate(
              `document.querySelector(${JSON.stringify(eye)}).getAttribute('aria-pressed') === 'false' && !${visible(remote)}`
            ),
          "keyboard hides remote"
        );
        assert.notEqual(
          await graph.evaluate(`document.querySelector(${JSON.stringify(eye)}).innerHTML`),
          visibleIcon,
          "hidden status changes icon shape as well as the accessible pressed state"
        );
        const remoteLabel = `${nav} button[title='origin/topic']`;
        const hiddenText = await contrast(remoteLabel);
        assert.ok(
          hiddenText.ratio >= 4.5,
          `hidden remote text in ${theme}: ${JSON.stringify(hiddenText)}`
        );
        await graph.evaluate(`document.querySelector(${JSON.stringify(remoteLabel)}).focus()`);
        await keypress("Tab");
        await keypress("Tab", 8);
        await visibleKeyboardFocus(remoteLabel);
        await graph.evaluate(`document.querySelector(${JSON.stringify(eye)}).focus()`);
        await keypress("Enter");
        await until(
          () =>
            graph.evaluate(
              `${visible(remote)} && document.querySelector(${JSON.stringify(eye)}).getAttribute('aria-pressed') === 'true'`
            ),
          "keyboard reveals remote"
        );
        const dimming = 'select[aria-label="Dimming"]';
        await keyboardSelect(dimming, "Subtle", "subtle");
        await visibleKeyboardFocus(dimming);
        const colours = () =>
          until(
            () =>
              graph.evaluate(`(() => {
          const row = document.querySelector('tr[data-branch-relation="unrelated"]');
          const lines = [...document.querySelectorAll('path[data-branch-relation="unrelated"]')];
          // Revealing a remote reloads commits before the asynchronous focus query completes.
          if (!row || !lines.length) return null;
          return { lines: lines.map(path => getComputedStyle(path).stroke), text: getComputedStyle(row).color };
        })()`),
            "branch focus colours"
          );
        const subtle = await colours();
        for (const relation of ["direct", "merged", "unrelated"]) {
          const text = await contrast(`tr[data-branch-relation='${relation}'] td:nth-child(2)`);
          assert.ok(text.ratio >= 4.5, `${relation} text in ${theme}: ${JSON.stringify(text)}`);
        }
        await keyboardSelect(dimming, "Strong", "strong");
        const strong = await colours();
        assert.equal(strong.text, subtle.text, "strong dimming keeps readable text");
        assert.notDeepEqual(strong.lines, subtle.lines, "dimming levels are distinguishable");
        for (const label of ["Pause focus", "Resume focus"]) {
          await graph.evaluate(
            `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).focus()`
          );
          await keypress("Enter");
          await until(
            () =>
              graph.evaluate(
                `document.querySelector('[data-focus-branch="main"]').textContent === ${JSON.stringify(label === "Pause focus" ? "Paused" : "Focus")}`
              ),
            `keyboard ${label}`
          );
          await visibleKeyboardFocus("button:focus");
        }
        await connections[0].call("Emulation.setDeviceMetricsOverride", {
          width: 650,
          height: 850,
          deviceScaleFactor: 1,
          mobile: false
        });
        await until(() => graph.evaluate("innerWidth < 700"), "narrow theme viewport");
        const grip = 'thead th:nth-child(2) [role="separator"]';
        await graph.evaluate(`document.querySelector('${grip}').focus()`);
        await keypress("ArrowLeft");
        await visibleKeyboardFocus(grip);
        assert.ok(
          await graph.evaluate(
            `document.querySelector('${grip}').getAttribute('aria-label')?.includes('Graph')`
          ),
          "graph resize handle has an accessible name"
        );
        const scroll = "[data-graph-scroll]";
        await graph.evaluate(
          `(() => { const element = document.querySelector('${scroll}'); element.scrollLeft = 0; element.focus(); })()`
        );
        await keypress("ArrowRight");
        await until(
          () => graph.evaluate(`document.querySelector('${scroll}').scrollLeft > 0`),
          "keyboard pans narrow graph"
        );
        await visibleKeyboardFocus(scroll);
        const hashes = await graph.evaluate(`(() => {
          const dots = [...document.querySelectorAll('[data-graph-viewport] circle')];
          const index = dots.reduce((best, dot, i) => +dot.getAttribute('cx') > +dots[best].getAttribute('cx') ? i : best, 0);
          const rows = [...document.querySelectorAll('tr[data-commit-hash]')];
          rows[index].focus(); return rows[index].dataset.commitHash;
        })()`);
        await keypress(" ");
        await until(
          () =>
            graph.evaluate(
              `document.querySelector('tr[data-commit-hash="${hashes}"]').getAttribute('aria-selected') === 'true'`
            ),
          "keyboard selects a commit"
        );
        await graph.evaluate(
          `(() => { const element = document.querySelector('${scroll}'); element.scrollLeft = 0; element.dispatchEvent(new Event('scroll')); })()`
        );
        const reveal = 'button[aria-label="Reveal selected lane"]';
        await graph.evaluate(`document.querySelector('${reveal}').focus()`);
        await keypress("Enter");
        await visibleKeyboardFocus(reveal);
        assert.ok(
          await graph.evaluate(`document.querySelector('${scroll}').scrollLeft > 0`),
          "keyboard reveals selected lane"
        );
        const screenshot = await connections[0].call("Page.captureScreenshot");
        fs.writeFileSync(
          path.join(artifacts, `theme-${kind}.png`),
          Buffer.from(screenshot.data, "base64")
        );
        assert.equal(git(["show-ref"], dir), refs);
        assert.equal(git(["branch", "--show-current"], dir), "main");
      } finally {
        await workbench.update("colorTheme", originalTheme, vscode.ConfigurationTarget.Global);
        await connections[0].call("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false
        });
        await openRepo(repo);
      }
    });
  }

  test("reveals selected lanes and keeps graph scrolling accessible deep in history", async () => {
    const dir = directory();
    init(dir);
    commit("base", "deep-base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    const tree = git(["rev-parse", "HEAD^{tree}"], dir);
    for (let lane = 0; lane < 14; lane++) {
      let parent = base;
      for (let depth = 0; depth < 8; depth++) {
        parent = git(["commit-tree", tree, "-p", parent, "-m", `deep-${lane}-${depth}`], dir);
      }
      git(["branch", `deep-${lane}`, parent], dir);
    }
    const refsBefore = git(["show-ref"], dir);
    await openRepo(dir);
    await headerChoice("View", "Focus direct history");
    await headerChoice("Branch", "main");
    await until(
      () => graph.evaluate("document.querySelectorAll('tr[data-commit-hash]').length === 113"),
      "deep graph history"
    );
    await graph.evaluate(`(() => {
      const cell = document.querySelector('thead th');
      const rect = cell.getBoundingClientRect();
      cell.querySelector('[role=separator]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.right }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + 80 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
    })()`);
    const target = await graph.evaluate(`(() => {
      const dots = [...document.querySelectorAll('[data-graph-viewport] circle')];
      const index = dots.reduce((best, dot, i) => +dot.getAttribute('cx') >= +dots[best].getAttribute('cx') ? i : best, 0);
      const rows = [...document.querySelectorAll('tr[data-commit-hash]')];
      rows[index - 1].focus();
      rows[index - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      return { index, hash: rows[index].dataset.commitHash, x: +dots[index].getAttribute('cx') };
    })()`);
    const measure = () =>
      graph.evaluate(`(() => {
      const scroll = document.querySelector('[data-graph-scroll]');
      const viewport = document.querySelector('[data-graph-viewport]');
      const row = document.querySelector('tr[data-commit-hash="${target.hash}"]');
      const head = document.querySelector('thead').getBoundingClientRect();
      const dot = viewport.querySelectorAll('circle')[${target.index}].getBoundingClientRect();
      const clip = viewport.getBoundingClientRect();
      return { left: scroll.scrollLeft, width: scroll.clientWidth, viewportLeft: viewport.scrollLeft,
        descriptionLeft: row.cells[1].getBoundingClientRect().left,
        headTop: head.top, headBottom: head.bottom, mainBottom: document.querySelector('header').getBoundingClientRect().bottom,
        rowTop: row.getBoundingClientRect().top, rowBottom: row.getBoundingClientRect().bottom,
        dotVisible: dot.left >= clip.left && dot.right <= clip.right,
        aligned: Math.abs(dot.top + dot.height / 2 - (row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2)) < 2,
        scrollTop: scroll.getBoundingClientRect().top, y: scrollY, height: innerHeight,
        focused: document.activeElement?.getAttribute('data-commit-hash') };
    })()`);
    await until(async () => {
      const state = await measure();
      return state.y > 500 && state.dotVisible && state.focused === target.hash;
    }, "keyboard selection reveals a deep clipped lane");
    const before = await measure();
    assert.ok(Math.abs(before.left - (target.x + 8 - before.width)) <= 1, "minimal lane movement");
    assert.ok(
      Math.abs(before.headTop - before.mainBottom) <= 1,
      "table header follows sticky controls"
    );
    assert.ok(
      before.rowTop >= before.headBottom && before.rowBottom <= before.height,
      "focused row stays visible"
    );
    assert.ok(
      before.scrollTop >= before.mainBottom && before.scrollTop < before.height,
      "scrollbar stays visible"
    );
    assert.ok(before.aligned, "sticky header does not move graph relative to rows");
    await graph.evaluate(`(() => {
      const row = document.querySelector('tr[data-commit-hash="${target.hash}"]');
      window.scrollBy(0, row.getBoundingClientRect().top - document.querySelector('thead').getBoundingClientRect().bottom);
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    })()`);
    assert.ok(
      await graph.evaluate(
        `document.activeElement.getBoundingClientRect().top >= document.querySelector('thead').getBoundingClientRect().bottom - 1`
      ),
      "keyboard navigation cannot hide a row behind the sticky header"
    );
    await graph.evaluate(
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`
    );
    await graph.evaluate(`(() => {
      const scroll = document.querySelector('[data-graph-scroll]');
      scroll.scrollLeft = 0; scroll.dispatchEvent(new Event('scroll'));
    })()`);
    // A new ref makes the refresh observable, without moving the selected row or its lane.
    git(["tag", "refresh-marker", base], dir);
    await button("Refresh", 'document.querySelector("header")');
    await until(
      () => graph.evaluate("!!document.querySelector('tbody [title=\"refresh-marker\"]')"),
      "refreshed graph data"
    );
    assert.equal((await measure()).left, 0, "refresh preserves manual panning");
    await button("Reveal selected lane", 'document.querySelector("thead")');
    let after = await measure();
    assert.ok(after.dotVisible);
    assert.equal(after.left, before.left);
    assert.equal(after.viewportLeft, after.left);
    assert.equal(after.descriptionLeft, before.descriptionLeft);
    assert.ok(
      await graph.evaluate(`(() => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
      document.querySelector('tr[data-commit-hash="${target.hash}"] td').dispatchEvent(event);
      return !event.defaultPrevented;
    })()`),
      "ordinary vertical scrolling is not intercepted"
    );
    await graph.evaluate(`(() => {
      const scroll = document.querySelector('[data-graph-scroll]');
      scroll.focus({ preventScroll: true });
    })()`);
    await connections[0].call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowLeft",
      code: "ArrowLeft",
      windowsVirtualKeyCode: 37
    });
    await connections[0].call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "ArrowLeft",
      code: "ArrowLeft",
      windowsVirtualKeyCode: 37
    });
    await until(
      async () => (await measure()).left < before.left,
      "sticky scrollbar keyboard access"
    );
    await connections[0].call("Emulation.setDeviceMetricsOverride", {
      width: 650,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false
    });
    await until(async () => {
      const state = await measure();
      return (
        (await graph.evaluate("innerWidth < 700")) &&
        Math.abs(state.headTop - state.mainBottom) <= 1
      );
    }, "sticky header follows wrapped controls at narrow width");
    await button("Reveal selected lane", 'document.querySelector("thead")');
    after = await measure();
    assert.ok(after.dotVisible && after.aligned);
    assert.ok(after.scrollTop >= after.mainBottom && after.scrollTop < after.height);
    assert.ok(
      await graph.evaluate(
        "!!document.querySelector('header button[title=\"main\"]') && !!document.querySelector('header button[title=\"focus\"]')"
      ),
      "branch and focus mode unchanged"
    );
    git(["tag", "-d", "refresh-marker"], dir);
    assert.equal(git(["show-ref"], dir), refsBefore);
    assert.equal(git(["branch", "--show-current"], dir), "main");
    const screenshot = await connections[0].call("Page.captureScreenshot");
    fs.writeFileSync(
      path.join(artifacts, "deep-graph-scroll.png"),
      Buffer.from(screenshot.data, "base64")
    );
    await connections[0].call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false
    });
    await openRepo(repo);
  });

  test("lists branches, remotes, tags and stashes beside the graph and switches the graph from them", async () => {
    const pane = directory();
    init(pane);
    commit("f", "pane-base", pane);
    git(["branch", "pane-feature"], pane);
    git(["tag", "-a", "pane-tag", "-m", "pane tag"], pane);
    git(["update-ref", "refs/remotes/mirror/main", "HEAD"], pane);
    fs.writeFileSync(path.join(pane, "f"), "stashed");
    git(["stash", "push", "-m", "pane stash"], pane);
    await openRepo(pane);
    const nav = `document.querySelector('nav[aria-label="Branches"]')`;
    if (!(await graph.evaluate("!!" + nav))) {
      await button("Branches", 'document.querySelector("header")');
    }
    await until(
      () =>
        graph.evaluate(
          `(() => { const nav = ${nav}; return !!nav && ["pane-feature", "mirror", "pane-tag", "pane stash"].every((text) => nav.innerText.includes(text)); })()`
        ),
      "branches pane contents"
    );
    await button("pane-feature", nav);
    await until(
      () => graph.evaluate(`!!document.querySelector('header button[title="pane-feature"]')`),
      "graph filtered to pane-feature"
    );
    await button("All branches", nav);
    await until(
      () => graph.evaluate(`!!document.querySelector('header button[title="*"]')`),
      "graph shows all branches"
    );
    const eye = `${nav}.querySelector('button[aria-label="Show Remote Branches in Graph"]')`;
    await graph.evaluate(`${eye}.click()`);
    await until(
      () =>
        graph.evaluate(
          `${eye}.getAttribute('aria-pressed') === 'false' && ${nav}.innerText.includes('Hidden from the graph')`
        ),
      "remote branches hidden"
    );
    await button("main", `${nav}.querySelector('[aria-labelledby]:nth-of-type(2)')`);
    await until(
      () =>
        graph.evaluate(
          `${eye}.getAttribute('aria-pressed') === 'true' && !!document.querySelector('header button[title="remotes/mirror/main"]')`
        ),
      "remote branch selected and shown again"
    );
    await button("All branches", nav);
    await graph.evaluate(`${nav}.querySelector('input').focus()`);
    const page = connections[0];
    const screenshot = await page.call("Page.captureScreenshot");
    fs.writeFileSync(
      path.join(artifacts, "branches-pane.png"),
      Buffer.from(screenshot.data, "base64")
    );
  });

  test("selects a branch clicked in the Branches pane as soon as a reopened graph lists it", async () => {
    const dir = directory();
    init(dir);
    commit("f", "reopen-base", dir);
    const base = git(["rev-parse", "HEAD"], dir);
    const tree = git(["rev-parse", "HEAD^{tree}"], dir);
    const names = ["reopen-one", "reopen-two", "reopen-three"];
    for (const name of names) {
      git(
        [
          "update-ref",
          `refs/heads/${name}`,
          git(["commit-tree", tree, "-p", base, "-m", name], dir)
        ],
        dir
      );
    }
    await openRepo(dir);
    if (!(await graph.evaluate(`!!document.querySelector('nav[aria-label="Branches"]')`))) {
      await button("Branches", 'document.querySelector("header")');
    }
    for (const name of names) {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("branchwise.view", { rootUri: vscode.Uri.file(dir) });
      graph = await findGraph();
      // The click lands while the page is still loading the branch list, rows and forecast.
      await clickPaneRow(name);
      await until(
        () =>
          graph.evaluate(
            `!!document.querySelector('header button[title=${JSON.stringify(name)}]') && [...document.querySelectorAll('tbody tr')].some(row => row.innerText.includes(${JSON.stringify(name)}))`
          ),
        "graph filtered to " + name
      );
    }
    await button("All branches", "document.querySelector('nav[aria-label=\"Branches\"]')");
  });

  test("pins and sorts branches in the Branches pane and flags merged, stale and conflicting ones", async () => {
    const dir = directory();
    init(dir);
    // Each commit gets its own committer date, so the newest-first order is certain.
    const now = Math.floor(Date.now() / 1000);
    const dated = (args, secondsAgo) =>
      cp.execFileSync("git", args, {
        cwd: dir,
        stdio: "pipe",
        env: { ...process.env, GIT_COMMITTER_DATE: `@${now - secondsAgo} +0000` }
      });
    const change = (file, message, secondsAgo) => {
      fs.writeFileSync(path.join(dir, file), message);
      git(["add", "--", file], dir);
      dated(["commit", "-m", message], secondsAgo);
    };
    change("f", "health base", 400 * 86400);
    git(["checkout", "-b", "aged"], dir);
    change("aged.txt", "aged change", 200 * 86400);
    git(["checkout", "-b", "clash", "main"], dir);
    change("f", "clash change", 400);
    git(["checkout", "-b", "done", "main"], dir);
    change("g", "done change", 300);
    git(["checkout", "main"], dir);
    dated(["merge", "--no-ff", "-m", "merge done", "done"], 200);
    change("f", "main change", 100);
    await openRepo(dir);
    const nav = `document.querySelector('nav[aria-label="Branches"]')`;
    if (!(await graph.evaluate("!!" + nav))) {
      await button("Branches", 'document.querySelector("header")');
    }
    const local = `${nav}.querySelector('section')`;
    const order = () =>
      graph.evaluate(
        `[...${local}.querySelectorAll('button[aria-current], button[title]:not([aria-label])')].map(b => b.querySelector('span.truncate')?.textContent).filter(n => n && n !== 'All branches').join()`
      );
    const flags = (branch) =>
      graph.evaluate(`(() => {
        const label = [...${local}.querySelectorAll('button[title]')].find(b => b.title.split('\\n')[0] === ${JSON.stringify(branch)});
        const row = label?.parentElement;
        return row ? [...row.querySelectorAll('[data-branch-flag], [data-conflicts]')].map(f => f.dataset.branchFlag ?? 'conflict').join() : null;
      })()`);
    await until(async () => (await order()) === "aged,clash,done,main", "branches by name");
    await until(async () => (await flags("clash")) === "conflict", "conflict mark on clash");
    assert.equal(await flags("done"), "merged");
    assert.equal(await flags("aged"), "stale");
    assert.equal(await flags("main"), "");

    await graph.evaluate(
      `${local}.querySelector('button[aria-label="Sort by most recent commit"]').click()`
    );
    await until(
      async () => (await order()) === "main,done,clash,aged",
      "branches by recent commit"
    );
    await button("Pin clash to the top", local);
    await until(async () => (await order()) === "clash,main,done,aged", "clash pinned first");

    // The pin and the order stay with the repository when the graph is reopened.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await openRepo(dir);
    if (!(await graph.evaluate("!!" + nav))) {
      await button("Branches", 'document.querySelector("header")');
    }
    await until(async () => (await order()) === "clash,main,done,aged", "pin and order kept");
    const shot = await connections[0].call("Page.captureScreenshot");
    fs.writeFileSync(path.join(artifacts, "branch-health.png"), Buffer.from(shot.data, "base64"));
    await button("Unpin clash", local);
    await graph.evaluate(
      `${local}.querySelector('button[aria-label="Sort by most recent commit"]').click()`
    );
    await until(async () => (await order()) === "aged,clash,done,main", "back to names");
  });

  test("keeps dropdowns and the sidebar inside narrow windows", async () => {
    const narrow = directory();
    init(narrow);
    commit("f", "narrow-base", narrow);
    git(
      ["branch", "narrow/" + "a-long-branch-name-that-is-wider-than-its-trigger-".repeat(2)],
      narrow
    );
    await openRepo(narrow);
    const page = connections[0];
    const size = (width, height = 800) =>
      page.call("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false
      });
    try {
      // At 400 px, the Branch dropdown's list used to reach past the window's left edge. At 700 px
      // the long branch name widened the list past the right edge after it had been placed.
      const windows = [
        [400, "innerWidth <= 400"],
        [700, "innerWidth > 400 && innerWidth <= 700"]
      ];
      for (const [width, ready] of windows) {
        await size(width);
        await until(() => graph.evaluate(ready), `${width} px window`);
        const triggers = await graph.evaluate(
          `document.querySelectorAll('header button[aria-haspopup="listbox"]').length`
        );
        assert.ok(triggers >= 3, "header dropdowns");
        for (let index = 0; index < triggers; index++) {
          await graph.evaluate(
            `document.querySelectorAll('header button[aria-haspopup="listbox"]')[${index}].click()`
          );
          const panel = await until(
            () =>
              graph.evaluate(`(() => {
                const input = document.querySelector('header [role="combobox"]');
                if (!input) return null;
                const rect = input.parentElement.getBoundingClientRect();
                return { left: rect.left, right: rect.right, width: innerWidth };
              })()`),
            `open dropdown ${index} at ${width} px`
          );
          assert.ok(
            panel.left >= 0 && panel.right <= panel.width,
            `dropdown ${index} inside the ${width} px window: ${JSON.stringify(panel)}`
          );
          await graph.evaluate(
            `document.querySelector('header [role="combobox"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`
          );
          await until(
            () => graph.evaluate(`!document.querySelector('header [role="combobox"]')`),
            `closed dropdown ${index} at ${width} px`
          );
        }
      }

      // Between 800 and 1000 px the header wraps, and the sticky sidebar must start below it.
      await size(880);
      if (!(await graph.evaluate(`!!document.querySelector('nav[aria-label="Branches"]')`))) {
        await button("Branches", 'document.querySelector("header")');
      }
      // The header's height reaches the sidebar through a ResizeObserver, so wait for it to settle.
      let layout;
      await until(async () => {
        layout = await graph.evaluate(`(() => {
          const nav = document.querySelector('nav[aria-label="Branches"]');
          if (!nav || innerWidth < 768 || innerWidth > 1000) return null;
          const style = getComputedStyle(nav.parentElement);
          return {
            width: innerWidth,
            viewport: innerHeight,
            header: document.querySelector("header").getBoundingClientRect().height,
            position: style.position,
            top: parseFloat(style.top),
            height: parseFloat(style.height)
          };
        })()`);
        return (
          layout &&
          Math.abs(layout.top - layout.header) <= 1 &&
          Math.abs(layout.height - (layout.viewport - layout.header)) <= 1
        );
      }, "sidebar below the header at 800-1000 px").catch((error) => {
        throw new Error(`${error.message} ${JSON.stringify(layout)}`);
      });
      // The fixed offset this replaces assumed a 48 px header.
      assert.ok(layout.header > 60, "wrapped header: " + JSON.stringify(layout));
      assert.equal(layout.position, "sticky", JSON.stringify(layout));
    } finally {
      await size(1440, 1000);
    }
  });
});

/**
 * Drag the element `from` evaluates to onto the one `to` evaluates to, and drop it there once
 * the target accepts it. The events are made in the page with Chromium's own DataTransfer, which
 * runs the page's handlers exactly as a pointer drag would, without depending on where the
 * webview's frame sits in the workbench. Returns the hint shown beside the pointer.
 */
async function dragOnto(from, to) {
  return until(
    () =>
      graph.evaluate(`(() => {
        const from = ${from}, to = ${to};
        if (!from || !to) return false;
        const data = new DataTransfer();
        const fire = (type, target) => {
          const box = target.getBoundingClientRect();
          const event = new DragEvent(type, { bubbles: true, cancelable: true, composed: true,
            dataTransfer: data, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 });
          target.dispatchEvent(event);
          return event;
        };
        fire("dragstart", from);
        fire("dragenter", to);
        if (!fire("dragover", to).defaultPrevented) {
          fire("dragend", from);
          return false;
        }
        const hint = document.querySelector("[data-drop-hint]")?.textContent;
        fire("drop", to);
        fire("dragend", from);
        return hint;
      })()`),
    "drop accepted"
  );
}
async function contextCommit(subject) {
  await until(
    () =>
      graph.evaluate(
        `(() => { const row=[...document.querySelectorAll('tr[data-commit-hash]')].find(r=>r.textContent.includes(${JSON.stringify(subject)})); if(!row)return false;row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:180,clientY:240}));return true; })()`
      ),
    "commit menu " + subject
  );
}
async function selectCommits(subjects) {
  for (const subject of subjects) {
    await until(
      () =>
        graph.evaluate(
          `(() => { const row=[...document.querySelectorAll('tr[data-commit-hash]')].find(r=>r.textContent.includes(${JSON.stringify(subject)}));if(!row)return false;row.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));return true; })()`
        ),
      "select " + subject
    );
  }
}
