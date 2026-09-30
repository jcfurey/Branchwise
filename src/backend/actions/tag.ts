import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { ActionPayload } from "@/backend/types";
import { runGit } from "@/backend/utils/runGit";
import { requireRemote, requireTagName } from "@/backend/utils/validation";

export async function addTag(git: SimpleGit, input: ActionPayload<"addTag">) {
  // Git accepts a tag named HEAD, but it would make `HEAD` ambiguous in later commands.
  if (input.tagName === "HEAD") {
    throw new Error(l10n.t("Enter a valid tag name."));
  }
  await requireTagName(git, input.tagName);
  const annotation = input.lightweight ? [] : ["-a", "-m", input.message];
  await git.raw(["tag", ...annotation, "--", input.tagName, input.commitHash]);
}

export async function deleteTag(git: SimpleGit, input: ActionPayload<"deleteTag">) {
  // Refs such as `-d` arrive through clones and fetches, so the name is not validated.
  await git.raw(["tag", "-d", "--", input.tagName]);
}

/** Push one tag, without force, so a remote tag of the same name is never replaced. */
export async function pushTag(git: SimpleGit, input: ActionPayload<"pushTag">) {
  await requireRemote(git, input.remote);
  await requireTagName(git, input.tagName);
  const ref = `refs/tags/${input.tagName}`;
  await runGit(git, ["push", "--", input.remote, `${ref}:${ref}`]);
}
