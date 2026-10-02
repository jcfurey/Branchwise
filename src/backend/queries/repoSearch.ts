import { searchDirectoryForRepos } from "@/backend/utils/repoSearch";

/**
 * The repositories in the workspace folders `paths`, searching `maxDepth` levels below each, and
 * `nestedDepth` levels inside each repository for repositories cloned there. The folders are
 * searched at once. A repository reached through several folders, a subfolder or a
 * symlink is listed once, and the list is in the locale's collation order, as the repository
 * picker shows it. Unreadable folders and a missing Git only mean fewer results.
 */
export async function findGitRepos(
  paths: string[],
  gitPath: string,
  maxDepth: number,
  nestedDepth = 0
): Promise<string[]> {
  const perFolder = await Promise.all(
    paths.map((folder) => searchDirectoryForRepos(folder, maxDepth, gitPath, [], nestedDepth))
  );
  const repos = new Set(perFolder.flat());
  return [...repos].toSorted((a, b) => a.localeCompare(b));
}
