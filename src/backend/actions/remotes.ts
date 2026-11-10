import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { RepositoryAction } from "@/backend/types";
import { runGit } from "@/backend/utils/runGit";
import {
  requireBranchName,
  requireRefName,
  requireRemote,
  requireTagName
} from "@/backend/utils/validation";

type RemoteAction = Extract<
  RepositoryAction,
  {
    kind:
      | "addRemote"
      | "editRemote"
      | "renameRemote"
      | "removeRemote"
      | "pushDefault"
      | "setTracking"
      | "deleteRemoteRef";
  }
>;

async function requireRemoteName(git: SimpleGit, name: string) {
  await requireRefName(
    git,
    "refs/remotes/",
    !name || name === "." ? "" : `${name}/branch`,
    l10n.t("Enter a valid remote name.")
  );
}

function requireUrl(url: string) {
  if (!url.trim() || /[\r\n\0]/.test(url) || url.startsWith("-")) {
    throw new Error(l10n.t("Enter a nonempty remote URL without line breaks."));
  }
}

async function replaceConfig(git: SimpleGit, key: string, values: string[]) {
  const existing = await git.getConfig(key, "local");
  if (values.length === 0) {
    if (existing.values.length > 0) {
      await git.raw(["config", "--local", "--unset-all", key]);
    }
    return;
  }
  await git.raw(["config", "--local", "--replace-all", key, values[0]!]);
  for (const value of values.slice(1)) {
    // Git config writes share config.lock and must preserve URL order.
    // eslint-disable-next-line no-await-in-loop
    await git.raw(["config", "--local", "--add", key, value]);
  }
}

/** Point the repository's push defaults that name `oldName` at `newName`, or remove them. */
async function updatePushDefaults(git: SimpleGit, oldName: string, newName: string | null) {
  // One read for every branch; Git prints each key and value, then NUL.
  const settings = await git
    .raw([
      "config",
      "--local",
      "-z",
      "--get-regexp",
      "^(remote\\.pushdefault|branch\\..+\\.pushremote)$"
    ])
    .catch(() => "");
  const keys = settings
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      // A key without a value has no newline.
      const [key = "", value = null] = entry.split(/\n(.*)/s);
      return { key, value };
    })
    .filter((entry) => entry.value === oldName)
    .map((entry) => entry.key);
  for (const key of new Set(keys)) {
    // Serialize writes to the repository's config.lock.
    // eslint-disable-next-line no-await-in-loop
    await replaceConfig(git, key, newName === null ? [] : [newName]);
  }
}

export async function manageRemote(git: SimpleGit, action: RemoteAction) {
  switch (action.kind) {
    case "addRemote":
      await requireRemoteName(git, action.name);
      requireUrl(action.url);
      await git.raw(["remote", "add", "--", action.name, action.url]);
      if (action.fetch) {
        await runGit(git, ["fetch", "--", action.name]);
      }
      return;
    case "editRemote":
      await requireRemote(git, action.name);
      if (action.fetchUrls.length === 0) {
        throw new Error(l10n.t("A remote needs at least one fetch URL."));
      }
      [...action.fetchUrls, ...action.pushUrls].forEach(requireUrl);
      await replaceConfig(git, `remote.${action.name}.url`, action.fetchUrls);
      await replaceConfig(git, `remote.${action.name}.pushurl`, action.pushUrls);
      return;
    case "renameRemote":
      await requireRemote(git, action.name);
      await requireRemoteName(git, action.newName);
      await git.raw(["remote", "rename", "--", action.name, action.newName]);
      await updatePushDefaults(git, action.name, action.newName);
      return;
    case "removeRemote":
      await requireRemote(git, action.name);
      await git.raw(["remote", "remove", "--", action.name]);
      await updatePushDefaults(git, action.name, null);
      return;
    case "pushDefault":
      if (action.remote !== null) {
        await requireRemote(git, action.remote);
      }
      await replaceConfig(git, "remote.pushDefault", action.remote === null ? [] : [action.remote]);
      return;
    case "setTracking":
      await requireBranchName(git, action.branch);
      if (action.upstream === null) {
        await git.raw(["branch", "--unset-upstream", "--", action.branch]);
      } else {
        await git.raw(["branch", `--set-upstream-to=${action.upstream}`, "--", action.branch]);
      }
      return;
    case "deleteRemoteRef": {
      await requireRemote(git, action.remote);
      await (action.refType === "tag" ? requireTagName : requireBranchName)(git, action.name);
      const ref = `refs/${action.refType === "tag" ? "tags" : "heads"}/${action.name}`;
      // A branch goes only as it was last fetched, which is what the user saw and what the
      // Safety Net records: commits pushed to it since then would otherwise go unseen.
      const known =
        action.refType === "branch"
          ? (
              await git
                .raw([
                  "rev-parse",
                  "--verify",
                  "--quiet",
                  `refs/remotes/${action.remote}/${action.name}^{commit}`
                ])
                .catch(() => "")
            ).trim()
          : "";
      try {
        await runGit(git, [
          "push",
          ...(known === "" ? [] : [`--force-with-lease=${ref}:${known}`]),
          "--",
          action.remote,
          `:${ref}`
        ]);
      } catch (error) {
        if (known === "") {
          throw error;
        }
        // Git words a refused lease in the user's language, so the remote is asked instead.
        const listed = await runGit(git, ["ls-remote", "--", action.remote, ref]).catch(() => null);
        const now = listed === null ? known : (listed.split("\t")[0] ?? "").trim();
        if (now === "") {
          throw new Error(
            l10n.t(
              "{0} was already deleted on {1}. Fetch to update the list of branches.",
              action.name,
              action.remote
            ),
            { cause: error }
          );
        }
        if (now !== known) {
          throw new Error(
            l10n.t(
              "{0} has commits on {1} that were never fetched, so it was not deleted. Fetch, look at them, then delete the branch again.",
              action.name,
              action.remote
            ),
            { cause: error }
          );
        }
        throw error;
      }
      return;
    }
  }
}
