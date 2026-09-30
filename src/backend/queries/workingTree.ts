import type { SimpleGit } from "simple-git";

import type { WorkingTreeFile } from "@/backend/types";

/** Porcelain's NUL format keeps renamed paths, whitespace and Unicode intact. */
export async function loadWorkingTree(git: SimpleGit): Promise<WorkingTreeFile[]> {
  const fields = (await git.raw(["status", "--porcelain=v1", "-z", "--untracked-files=all"])).split(
    "\0"
  );
  const files: WorkingTreeFile[] = [];
  for (let index = 0; index < fields.length; index++) {
    const record = fields[index]!;
    if (!record) {
      continue;
    }
    const status = record.slice(0, 2);
    const path = record.slice(3);
    const oldPath = /[RC]/.test(status) ? fields[++index]! : path;
    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status)) {
      files.push({ path, oldPath, status, group: "conflicts" });
    } else if (status === "??") {
      // With every untracked file listed, only a nested repository stays a folder.
      files.push(
        path.endsWith("/")
          ? { path, oldPath, status: "?", group: "untracked", repository: true }
          : { path, oldPath, status: "?", group: "untracked" }
      );
    } else {
      if (status[0] !== " ") {
        files.push({ path, oldPath, status: status[0]!, group: "staged" });
      }
      if (status[1] !== " ") {
        files.push({
          path,
          oldPath: /[RC]/.test(status[1]!) ? oldPath : path,
          status: status[1]!,
          group: "unstaged"
        });
      }
    }
  }
  return files;
}
