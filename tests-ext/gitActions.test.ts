import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { simpleGit } from "simple-git";

import { runRepositoryAction } from "@/backend/actions/repository";
import { loadOperation, loadRebasePlan } from "@/backend/queries/repository";

suite("Git actions in the extension host", () => {
  let repo: string;
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
  const commit = (file: string, value: string) => {
    fs.writeFileSync(path.join(repo, file), value);
    git(["add", "--", file]);
    git(["commit", "-m", value]);
  };

  setup(() => {
    repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-host-actions-")));
    git(["init", "-b", "main"]);
    git(["config", "user.name", "Branchwise Test"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "rerere.enabled", "false"]);
    commit("f", "base");
  });
  teardown(
    async () =>
      await fs.promises.rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  );

  test("runs interactive rebase editors using the VS Code executable as Node", async () => {
    const base = git(["rev-parse", "HEAD"]);
    commit("a", "first");
    commit("b", "second");
    const plan = await loadRebasePlan(simpleGit(repo), base);
    plan.entries[0]!.action = "reword";
    plan.entries[0]!.message = "edited in the extension host";
    plan.entries[1]!.action = "squash";
    await runRepositoryAction(simpleGit(repo), { kind: "interactiveRebase", plan });
    assert.strictEqual(git(["rev-list", "--count", `${base}..HEAD`]), "1");
    assert.match(git(["log", "-1", "--format=%B"]), /edited in the extension host/);
    assert.match(git(["log", "-1", "--format=%B"]), /second/);
    assert.strictEqual(await loadOperation(simpleGit(repo)), null);
  });

  test("resumes the saved plan after a conflict using a fresh Git client", async () => {
    const base = git(["rev-parse", "HEAD"]);
    commit("f", "first");
    commit("f", "second");
    commit("later", "later");
    const plan = await loadRebasePlan(simpleGit(repo), base);
    plan.entries[0]!.action = "drop";
    plan.entries[2]!.action = "reword";
    plan.entries[2]!.message = "continued in the extension host";
    await assert.rejects(runRepositoryAction(simpleGit(repo), { kind: "interactiveRebase", plan }));
    const operation = (await loadOperation(simpleGit(repo)))!;
    assert.strictEqual(operation.kind, "rebase");
    fs.writeFileSync(path.join(repo, "f"), "second");
    await runRepositoryAction(simpleGit(repo), { kind: "conflict", path: "f", operation: "stage" });
    await runRepositoryAction(simpleGit(repo), {
      kind: "recover",
      operation,
      resolution: "continue"
    });
    assert.strictEqual(git(["log", "-1", "--format=%s"]), "continued in the extension host");
    assert.strictEqual(await loadOperation(simpleGit(repo)), null);
  });
});
