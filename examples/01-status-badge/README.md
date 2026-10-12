# 1. Status badge

One file, two stops. Compare the old label with two distinct status badges.

From the checkout root, after [setup](../README.md),

```sh
HUNK_GUIDE_FILE=examples/01-status-badge/guide.json \
  hunk patch examples/01-status-badge/review.patch --extension .
```

1. Read **See the old label**. Its target points to the removed line on the old side.
2. Press `Alt+J` for **Separate on-time and delayed trains**. The target now points to the new side.
3. Press `Alt+R` to mark the target reviewed. Press it again to undo.
4. Press `Alt+K` to return, or `Alt+G` to close Guide. Normal diff navigation still works.

[Next: Departure board](../02-departure-board/)
