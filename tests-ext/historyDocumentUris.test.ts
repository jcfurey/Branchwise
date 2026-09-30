import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as vscode from "vscode";

import { createGit } from "@/backend/gitClient";
import {
  decodeDiffDocUri,
  DiffDocProvider,
  encodeDiffBlobUri,
  encodeDiffDocUri
} from "@/old-extension/diffDocProvider";

suite("History document URIs in VS Code", () => {
  test("keep the query format that restored editors depend on", () => {
    const id = "d4".repeat(20);
    const document = encodeDiffDocUri("/srv/work tree", "src/main.ts", id + "^");
    assert.strictEqual(document.scheme, "branchwise");
    assert.strictEqual(document.path, "src/main.ts");
    assert.strictEqual(document.query, `commit=${id}%5E&repo=%2Fsrv%2Fwork%20tree`);

    const object = encodeDiffBlobUri("/srv/work tree", "src/main.ts", null);
    assert.strictEqual(object.query, `commit=${"0".repeat(40)}&repo=%2Fsrv%2Fwork%20tree&blob=1`);
    assert.deepStrictEqual(decodeDiffDocUri(vscode.Uri.parse(object.toString())), {
      filePath: "src/main.ts",
      commit: "0".repeat(40),
      repo: "/srv/work tree",
      blob: true
    });
  });

  test("serve documents revived from their string form", async () => {
    const repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-revived-")));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
    const provider = new DiffDocProvider(
      (folder) => createGit(folder, "git"),
      () => false
    );
    try {
      git("init", "-b", "main");
      git("config", "user.name", "Revived Test");
      git("config", "user.email", "revived@example.invalid");
      git("config", "commit.gpgsign", "false");
      fs.mkdirSync(path.join(repo, "sub dir"));
      fs.writeFileSync(path.join(repo, "sub dir", "notes #1.md"), "first line\r\nsecond line\r\n");
      git("add", "--all");
      git("commit", "-m", "notes");
      const head = git("rev-parse", "HEAD");
      const blob = git("rev-parse", "HEAD:sub dir/notes #1.md");

      // VS Code refuses the URI, but the repository still counts as one this session opened.
      assert.throws(() => encodeDiffDocUri(repo, "//x", head), /two slash characters/);
      const written = vscode.Uri.from({
        scheme: DiffDocProvider.scheme,
        path: "sub dir/notes #1.md",
        query: `commit=${head}&repo=${encodeURIComponent(repo)}`
      });
      assert.strictEqual(
        await provider.provideTextDocumentContent(written),
        "first line\r\nsecond line\r\n"
      );

      const object = encodeDiffBlobUri(repo, "notes #1.md", blob);
      assert.strictEqual(
        await provider.provideTextDocumentContent(vscode.Uri.parse(object.toString())),
        "first line\r\nsecond line\r\n"
      );
    } finally {
      provider.dispose();
      await fs.promises.rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
