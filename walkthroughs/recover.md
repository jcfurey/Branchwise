# Recover from a mistake

Git rarely loses work, and the extension is built to keep it that way.

- **Interrupted operations**: when a merge, rebase, cherry-pick or revert stops on a conflict, the status strip above the graph lists the conflicted files with **Open Conflict** and **Stage Resolution**, then offers **Continue**, **Abort** and **Skip Commit**. Abort restores the state before the operation.
- **Git Activity** (in the settings cog) keeps the last hundred operations of this view with their exact Git output, and every error has **Copy Error Details**.
- **Recover lost commits (reflog)** (also in the settings cog) shows where each branch and HEAD used to point. **Show in Graph** opens that history, and **Create Recovery Branch** keeps it under a new name.
- Every workflow re-checks the repository right before it acts. If a branch, stash or file changed since you opened the dialog, the extension stops and asks you to review again instead of acting on stale information.

The full guide to every action is in the documentation, one click away from the settings cog under **Learn more**.
