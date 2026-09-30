import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as vscode from "vscode";

import { gitClientFactory } from "@/backend/gitClient";
import {
  decodeDiffDocUri,
  DiffDocProvider,
  encodeDiffDocUri
} from "@/old-extension/diffDocProvider";

suite("History documents", () => {
  test("round-trips reserved URI characters in repository and file paths", () => {
    const repo = "/tmp/repo #?% with spaces 中文";
    // Windows paths use backslashes as separators, so only other systems keep one in a name.
    const files = [
      "folder/odd #?\tname.txt",
      "percent %41 and %.txt",
      "目录/café.md",
      'quote"and\nnewline',
      ...(process.platform === "win32" ? [] : ["back\\slash"])
    ];
    for (const file of files) {
      const uri = vscode.Uri.parse(encodeDiffDocUri(repo, file, "a".repeat(40)).toString());
      assert.deepStrictEqual(decodeDiffDocUri(uri), {
        repo,
        filePath: file,
        commit: "a".repeat(40)
      });
    }
  });

  test("loads simultaneous comparisons from their own repositories", async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-document-")));
    const file = "file # with spaces.txt";
    const repos = [path.join(root, "first"), path.join(root, "second")];
    const provider = new DiffDocProvider(
      (repo) => gitClientFactory(repo, "git").getInstance(),
      () => false
    );
    try {
      for (const [index, repo] of repos.entries()) {
        fs.mkdirSync(repo);
        const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
        git("init", "-b", "main");
        git("config", "user.name", "History Test");
        git("config", "user.email", "history@example.invalid");
        git("config", "commit.gpgsign", "false");
        fs.writeFileSync(path.join(repo, file), "repository " + index);
        git("add", "--", file);
        git("commit", "-m", "initial");
      }
      const contents = await Promise.all(
        repos.map((repo) => {
          const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo }).toString().trim();
          return provider.provideTextDocumentContent(encodeDiffDocUri(repo, file, head));
        })
      );
      assert.deepStrictEqual(contents, ["repository 0", "repository 1"]);
    } finally {
      provider.dispose();
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
