# 4. Guide your own change

Trains can now change platforms. This change has no guide yet: a coding agent writes one, and hunk-guide checks every target against the exact diff before you see it.

```text
│ Riverside    ◆ PLATFORM 4    │
```

From the checkout root, create a sandbox with the departure board committed and this change uncommitted. Pass the agent command that should write guides. It must read a prompt on stdin and print its answer, like `claude -p`, `codex exec -`, or `pi -p`.

```sh
eval "$(bun examples/sandbox.ts 04-guide-your-change claude -p)"
```

This enters the sandbox and exports `HUNK_GUIDE_ROOT` and `HUNK_GUIDE_COMMAND` for the current shell.

## Generate in Hunk

```sh
hunk diff --extension "$HUNK_GUIDE_ROOT"
```

1. Press `Alt+Y`. The [agent provider](../../bin/agent-provider.ts) sends your agent the exact review with numbered lines and the [authoring skill](../../skills/create-hunk-guide/SKILL.md). It checks every returned target and asks once for a correction if any target misses the diff. This usually takes under a minute.
2. Walk the generated guide with `Alt+J`.
3. Run **Guide: save generated guide** from **Extensions** to keep it as `.hunk/guide.json`.

`Alt+Shift+Y` cancels. A failed run leaves the previous guide in place and shows the reason.

## Let a coding agent write the guide

Quit Hunk. In the sandbox, start any coding agent and ask:

```text
Read and follow $HUNK_GUIDE_ROOT/skills/create-hunk-guide/SKILL.md.
Create .hunk/guide.json for the changes shown by `hunk diff`.
```

An agent started from this shell inherits `HUNK_GUIDE_ROOT`; otherwise substitute the path that `echo "$HUNK_GUIDE_ROOT"` prints. The skill has the agent run the checker until every target resolves. Run it yourself, then open the guide:

```sh
bun "$HUNK_GUIDE_ROOT/bin/check.ts"
hunk diff --extension "$HUNK_GUIDE_ROOT"
```

If Hunk is already open, run **Guide: reload guide file** instead.

To use either path on your own repositories, see [review workflows](../../docs/workflows.md).
