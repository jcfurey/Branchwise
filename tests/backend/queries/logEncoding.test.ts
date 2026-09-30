import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";
import { loadBatchPlan, loadHistory } from "@/backend/queries/history";
import { loadCommits } from "@/backend/queries/loadCommits";
import { loadRebasePlan } from "@/backend/queries/repository";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

const repo = freshRepo();

it.each(["ISO-8859-1", "UTF-16LE"])(
  "reads and rewords Unicode commits when log output is configured as %s",
  async (encoding) => {
    const folder = repo();
    const base = gitOutput(["rev-parse", "HEAD"], folder);
    writeFileSync(join(folder, "f"), "changed");
    git(["add", "f"], folder);
    git(["commit", "--author=André <test@example.com>", "-m", "café"], folder);
    const head = gitOutput(["rev-parse", "HEAD"], folder);
    git(["config", "i18n.logOutputEncoding", encoding], folder);
    // Prove that this fixture would corrupt the UTF-8 decoder without the override.
    expect(gitOutput(["log", "-1", "--format=%s"], folder)).not.toBe("café");

    const client = createGit(folder, "git");
    const graph = await loadCommits(client, {
      branchName: "",
      maxCommits: 10,
      showRemoteBranches: true,
      hard: true,
      dateType: "Author Date",
      showUncommittedChanges: false
    });
    expect(graph.commits[0]).toMatchObject({ author: "André", message: "café" });
    const history = await loadHistory(
      client,
      {
        text: "",
        author: "",
        since: "",
        until: "",
        path: "",
        revision: "",
        follow: false
      },
      0
    );
    expect(history.entries[0]).toMatchObject({ author: "André", message: "café" });
    expect((await loadBatchPlan(client, [head])).entries[0]).toMatchObject({
      author: "André",
      message: "café"
    });

    const plan = await loadRebasePlan(client, base);
    expect(plan.entries[0]?.message).toBe("café");
    plan.entries[0]!.action = "reword";
    plan.entries[0]!.message += " revised";
    await runRepositoryAction(client, { kind: "interactiveRebase", plan });
    expect(
      gitOutput(["-c", "i18n.logOutputEncoding=UTF-8", "log", "-1", "--format=%B"], folder)
    ).toBe("café revised");
  }
);
