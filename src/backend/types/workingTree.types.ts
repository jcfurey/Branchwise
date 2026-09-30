export type WorkingTreeGroup = "unstaged" | "staged" | "untracked" | "conflicts";

export type WorkingTreeFile = {
  path: string;
  oldPath: string;
  status: string;
  group: WorkingTreeGroup;
  /** An untracked folder that is a repository of its own, whose files Git does not list here. */
  repository?: true;
};
