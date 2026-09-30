# Act on a commit

Right-click any commit, or click the **⋯** button that appears at the end of its row, to see what you can do with it:

- Create a **tag** or a **branch** at the commit.
- **Check out** the commit, **cherry-pick** it onto the current branch, or **revert** it.
- **Merge** it into the current branch, or **reset** the current branch to it.
- Edit the commits after it (interactive rebase), fold staged changes into it (fixup), compare it with HEAD, or mark it good or bad for a bisect.

Right-click a **label** for branch, tag and remote actions such as checkout, push, pull, rename, delete and upstream tracking. Double-click a label to check it out.

Every change opens a confirmation first, and the dialog explains what will happen and how to undo it. With the keyboard, use the arrow keys to move between commits, **Enter** to open details, and **Shift+F10** for the actions menu. Hold **Ctrl** or **Cmd** while clicking to select several commits, then cherry-pick, revert or compare them together.
