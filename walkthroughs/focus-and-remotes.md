# Focus a branch and hide remotes

**Focus** keeps every branch in the graph but highlights one branch's history. Right-click a
branch label in the graph, or a branch in the Branches pane, and choose **Focus this branch**.
Its first-parent history stays in full colour, history merged into it is muted, and unrelated
commits turn gray. A **Focus** badge marks the target. The **View** choice in the header switches
between filtering to one branch, focusing its direct history, and focusing all of its ancestors.
**Pause focus** restores every colour until you resume, and **Clear focus** ends it.

**Remote visibility** keeps a noisy remote out of the graph without deleting anything. In the
Branches pane, the eye on each remote hides that remote's labels and the commits only it
reaches; shared history, local branches and tags stay visible. The eye on the **Remotes**
heading hides all remote branches at once and keeps each remote's own choice. Selecting or
focusing a hidden remote's branch shows that remote again.

The focused branch, the view choice, and hidden remotes are remembered for each repository.
