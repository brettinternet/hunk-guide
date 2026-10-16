# 3. Live review

A cancellation policy touches code, tests, passenger notes, and a generated preview.

```text
┌── DEPARTURES ────────────────┐
│ Harbor       ● ON TIME       │
│ Pine Ridge   ▲ +8 MIN        │
│ Old Town     ■ CANCELLED     │
└──────────────────────────────┘
```

## Explore the patch

From the checkout root, after [setup](../README.md),

```sh
HUNK_GUIDE_FILE=examples/03-live-review/guide.json \
  hunk patch examples/03-live-review/review.patch --extension .
```

1. Follow the contract, policy, display, and tests with `Alt+J`.
2. In **Extensions**, run **Guide: toggle supporting sections** and **Guide: toggle mechanical sections**. Passenger notes and the generated preview appear after the tests.
3. Press `Alt+O`. The station metadata in `station.txt` is deliberately outside the guide.
4. Press `Alt+A` to see all changes, including that metadata.

## Watch a live edit

Quit patch mode. From the checkout root, create a sandbox repository with this change uncommitted and its guide at `.hunk/guide.json`, then open it:

```sh
eval "$(bun examples/sandbox.ts 03-live-review)"
hunk diff --watch --extension "$HUNK_GUIDE_ROOT"
```

The first line prints the sandbox path, enters it, and sets `HUNK_GUIDE_ROOT` to this checkout. Your checkout is unchanged.

1. Select **Put cancellations first** and mark it reviewed with `Alt+R`.
2. Press `Alt+C` to set a checkpoint.
3. In another terminal, open `src/service.ts` in the sandbox. Change `delayThreshold = 0` to `delayThreshold = 10` and save.
4. After Hunk reloads, press `Alt+V`. Targets in the changed service file remain; unchanged targets are hidden. The reviewed target is stale because its file changed.
5. Press `Alt+V` again to restore all targets.

## Reload the guide

1. In another terminal, change the `title` in the sandbox's `.hunk/guide.json`. Run **Guide: reload guide file** to see it.
2. Make the JSON invalid and reload. The last valid guide stays visible. Undo the edit and reload again.

Checkpoints and review progress last only for this Hunk session. The sandbox remains after you quit.

[Next: Guide your own change](../04-guide-your-change/)
