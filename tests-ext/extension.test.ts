import * as assert from "node:assert";

import * as vscode from "vscode";

/** The label of the graph panel's tab. */
const GRAPH_TAB = "Branchwise";
/** How long a tab may take to appear, come forward or go on a slow machine. */
const TAB_DEADLINE_MS = 10_000;
/** How long the background copy of the settings may take after activation. */
const SETTING_DEADLINE_MS = 10_000;
const POLL_INTERVAL_MS = 50;

type Manifest = {
  contributes: { commands: { command: string }[]; walkthroughs: { id: string }[] };
};

const everyTab = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs);
const graphTabs = () => everyTab().filter((tab) => tab.label === GRAPH_TAB);
const graphIsOpen = () => graphTabs().length > 0;
const frontTabLabel = () => vscode.window.tabGroups.activeTabGroup.activeTab?.label;
/** What the user settings hold for `section.key`, if anything. */
const userSetting = (section: string, key: string) =>
  vscode.workspace.getConfiguration(section).inspect(key)?.globalValue;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Whether `condition` holds, checking it every 50 ms until it does or `ms` have passed. Running
 * out of time is not a failure in itself; the caller asserts the answer.
 */
async function eventually(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  const check = async (): Promise<boolean> => {
    if (condition()) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(POLL_INTERVAL_MS);
    return check();
  };
  return check();
}

/** Run `command`, then wait for the graph's tab. VS Code settles the command before the tab exists. */
async function graphOpensAfter(command: string): Promise<boolean> {
  await vscode.commands.executeCommand(command);
  return eventually(graphIsOpen, TAB_DEADLINE_MS);
}

async function closeEveryEditor(): Promise<boolean> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  return eventually(() => everyTab().length === 0, TAB_DEADLINE_MS);
}

suite("Branchwise in a running VS Code", () => {
  let extension: vscode.Extension<unknown>;
  let manifest: Manifest;

  suiteSetup(async () => {
    // .vscode-test.mjs names the extension under development; activation starts on
    // onStartupFinished, which may not have happened yet.
    const id = process.env["NGG_EXTENSION_ID"];
    assert.ok(id, "NGG_EXTENSION_ID names the extension under test");
    const found = vscode.extensions.getExtension(id);
    assert.ok(found, `${id} is installed`);
    extension = found;
    manifest = extension.packageJSON as Manifest;
    await extension.activate();
  });

  setup(async () => {
    // Other test files share this window; every check starts without a graph or other editors.
    assert.ok(await closeEveryEditor(), "no tab is left before the check");
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("is active once activated", () => {
    assert.strictEqual(extension.isActive, true);
  });

  test("opens one graph tab labelled Branchwise from the view command", async () => {
    assert.ok(await graphOpensAfter("branchwise.view"), "the graph tab appears");
    assert.strictEqual(graphTabs().length, 1);
  });

  test("brings the open graph forward on a second view command, adding no tab", async () => {
    assert.ok(await graphOpensAfter("branchwise.view"), "the first run opens the graph");
    // Another editor in front, so that bringing the graph forward can be seen.
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(extension.extensionUri, "package.json"),
      { preview: false }
    );
    assert.ok(
      await eventually(() => frontTabLabel() === "package.json", TAB_DEADLINE_MS),
      "the other editor is in front"
    );
    const tabsBefore = everyTab().length;

    await vscode.commands.executeCommand("branchwise.view");

    assert.ok(
      await eventually(() => frontTabLabel() === GRAPH_TAB, TAB_DEADLINE_MS),
      "the graph comes forward"
    );
    assert.strictEqual(everyTab().length, tabsBefore);
    assert.strictEqual(graphTabs().length, 1);
  });

  test("opens a new graph after the previous one was closed", async () => {
    assert.ok(await graphOpensAfter("branchwise.view"), "open after the first run");
    assert.ok(await closeEveryEditor(), "closed with every other editor");
    assert.strictEqual(graphIsOpen(), false);
    assert.ok(await graphOpensAfter("branchwise.view"), "open again after the second run");
  });

  test("registers the commands the manifest contributes", async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    const expected = new Set([
      "branchwise.showBranches",
      "branchwise.openDocumentation",
      "branchwise.openWalkthrough",
      "branchwise.fileHistory",
      ...manifest.contributes.commands.map(({ command }) => command)
    ]);
    for (const command of expected) {
      assert.ok(registered.has(command), `${command} is registered`);
    }
  });

  test("opens the graph from the branches command", async () => {
    assert.ok(await graphOpensAfter("branchwise.showBranches"), "the graph tab appears");
  });

  test("runs the walkthrough and documentation commands without failing", async () => {
    // VS Code settles both even for a wrong walkthrough or a missing file; see the next two checks.
    await vscode.commands.executeCommand("branchwise.openWalkthrough");
    await vscode.commands.executeCommand("branchwise.openDocumentation");
  });

  test("opens only walkthroughs that the manifest contributes", async () => {
    // A command registered by an extension is found before the workbench's own, so this one
    // records what the extension asks for until it is disposed.
    const requested: unknown[] = [];
    const recorder = vscode.commands.registerCommand(
      "workbench.action.openWalkthrough",
      (walkthrough: unknown) => {
        requested.push(walkthrough);
      }
    );
    try {
      await vscode.commands.executeCommand("branchwise.openWalkthrough");
    } finally {
      recorder.dispose();
    }

    const contributed = manifest.contributes.walkthroughs.map(({ id }) => `${extension.id}#${id}`);
    assert.ok(requested.length > 0, "the command asks for a walkthrough");
    for (const walkthrough of requested) {
      assert.ok(
        typeof walkthrough === "string" && contributed.includes(walkthrough),
        `${JSON.stringify(walkthrough)} is one of ${JSON.stringify(contributed)}`
      );
    }
  });

  test("shows the packaged guide from the documentation command", async () => {
    const guide = vscode.Uri.joinPath(extension.extensionUri, "docs", "git-actions.md");
    const { type } = await vscode.workspace.fs.stat(guide);
    assert.strictEqual(type & vscode.FileType.File, vscode.FileType.File);

    await vscode.commands.executeCommand("branchwise.openDocumentation");

    // The preview, or the editor it falls back to, loads the file it shows as a document. A tab
    // alone proves nothing: the preview of a missing file opens one to report the error.
    assert.ok(
      await eventually(
        () => vscode.workspace.textDocuments.some(({ uri }) => uri.fsPath === guide.fsPath),
        TAB_DEADLINE_MS
      ),
      `${guide.fsPath} is loaded`
    );
  });

  test("copies the user setting saved under the extension's former name", async () => {
    // .vscode-test.mjs saves neo-git-graph.showUncommittedChanges; activation copies it in the
    // background.
    await eventually(
      () => userSetting("branchwise", "showUncommittedChanges") !== undefined,
      SETTING_DEADLINE_MS
    );

    assert.strictEqual(userSetting("branchwise", "showUncommittedChanges"), true);
    assert.strictEqual(
      userSetting("neo-git-graph", "showUncommittedChanges"),
      true,
      "the setting under the former name stays"
    );
  });
});
