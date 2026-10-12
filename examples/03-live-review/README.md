# 3. Live review

A cancellation policy touches code, tests, passenger notes, and a generated preview.

```text
┌── DEPARTURES ─────────────────┐
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

Quit patch mode. Run this from the checkout root to create a temporary repository. It leaves your checkout untouched and prints the demo path.

```sh
export HUNK_GUIDE_EXAMPLE_ROOT="$PWD"
export HUNK_GUIDE_DEMO="$(mktemp -d -t hunk-guide-demo)"
git -C "$HUNK_GUIDE_DEMO" init -q
git -C "$HUNK_GUIDE_DEMO" -c user.name=Demo -c user.email=demo@example.invalid \
  -c core.hooksPath=/dev/null commit --allow-empty --no-gpg-sign -qm "Start demo"
git -C "$HUNK_GUIDE_DEMO" apply "$HUNK_GUIDE_EXAMPLE_ROOT/examples/03-live-review/review.patch"
git -C "$HUNK_GUIDE_DEMO" add -N .
mkdir -p "$HUNK_GUIDE_DEMO/.hunk"
cp examples/03-live-review/guide.json "$HUNK_GUIDE_DEMO/.hunk/guide.json"
cp examples/providers/minimal-adapter.mjs "$HUNK_GUIDE_DEMO/.hunk/minimal-adapter.mjs"
printf '.hunk/\n' >> "$HUNK_GUIDE_DEMO/.git/info/exclude"
printf 'Demo directory: %s\n' "$HUNK_GUIDE_DEMO"
(
  cd "$HUNK_GUIDE_DEMO" || exit
  HUNK_GUIDE_FILE=.hunk/guide.json \
    HUNK_GUIDE_COMMAND='["bun",".hunk/minimal-adapter.mjs"]' \
    hunk diff --watch --extension "$HUNK_GUIDE_EXAMPLE_ROOT"
)
```

1. Select **Put cancellations first** and mark it reviewed with `Alt+R`.
2. Press `Alt+C` to set a checkpoint.
3. In another terminal, open `src/service.ts` under the printed demo path. Change `delayThreshold = 0` to `delayThreshold = 10` and save.
4. After Hunk reloads, press `Alt+V`. Targets in the changed service file remain; unchanged targets are hidden. The reviewed target is stale because its file changed.
5. Press `Alt+V` again to restore all targets.

Checkpoints and review progress last only for this Hunk session. The sandbox remains after you quit.

## Generate and reload

Continue in the live demo. The bundled adapter uses no network or model. It creates one section per file to demonstrate the provider protocol, not a hand-written narrative.

1. Press `Alt+Y` to generate. The title becomes **Provider transport example**.
2. Run **Guide: save generated guide** in **Extensions** and confirm replacement of the sandbox's `.hunk/guide.json`.
3. Edit that file's title in another terminal. Run **Guide: reload guide file** to see the new title.
4. To try recovery, temporarily make the JSON invalid and reload. The last valid guide stays visible. Undo the edit and reload again.

Only the sandbox guide is replaced. The checked-in example is unchanged.
