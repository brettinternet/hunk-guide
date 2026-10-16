# Review workflows

There are two ways to get a guide for a changeset. Both check every target against the exact diff before you review it.

|            | Generate in Hunk                       | Agent writes the guide           |
| ---------- | -------------------------------------- | -------------------------------- |
| Start      | `Alt+Y` in Hunk                        | Ask a coding agent               |
| Result     | In memory until you save it            | `.hunk/guide.json`               |
| Checked by | The agent provider, then the extension | `bin/check.ts`, run by the agent |

`<hunk-guide>` below is this checkout or the managed install from `hunk extension install`, for example `~/.config/hunk/extensions/installed/hunk-guide`. Both helpers run with `bun`.

Add `.hunk/guide.json` to the reviewed repository's `.gitignore`; otherwise the guide appears as an untracked file in its own review.

[Example 4](../examples/04-guide-your-change/) tries both paths in a sandbox.

## Generate in Hunk

Set `HUNK_GUIDE_COMMAND` to the agent provider followed by a non-interactive agent command. The agent must read a prompt on stdin and print its answer:

```sh
export HUNK_GUIDE_COMMAND='["bun","<hunk-guide>/bin/agent-provider.ts","claude","-p"]'
# or end the array with "codex","exec","-"  or  "pi","-p"
```

Put it in your shell profile to keep it. Then, in any repository:

1. Open the review, such as `hunk diff`, `hunk diff origin/main...HEAD`, or `hunk patch pr.patch`.
2. Press `Alt+Y`. The provider sends the agent the exact review with numbered lines and the [authoring skill](../skills/create-hunk-guide/SKILL.md). It checks every returned target and asks once for a correction if any target misses the diff.
3. Run **Guide: save generated guide** to keep the result as `.hunk/guide.json`.

The agent runs from the review directory with your environment and credentials, and may read the repository. If large reviews time out, raise `provider_timeout_seconds` (default 300) in `.hunk/config.toml`.

## Agent writes the guide

From the reviewed repository, ask the agent that made the change, or any coding agent:

```text
Read and follow <hunk-guide>/skills/create-hunk-guide/SKILL.md.
Create .hunk/guide.json for the changes shown by `hunk diff`.
```

Name the exact Hunk command you will run. The skill has the agent run the checker with the same arguments and fix every target it reports:

| Review                         | Check                                              |
| ------------------------------ | -------------------------------------------------- |
| `hunk diff`                    | `bun <hunk-guide>/bin/check.ts`                    |
| `hunk diff --staged`           | `bun <hunk-guide>/bin/check.ts --staged`           |
| `hunk diff origin/main...HEAD` | `bun <hunk-guide>/bin/check.ts origin/main...HEAD` |
| `hunk patch pr.patch`          | `bun <hunk-guide>/bin/check.ts --patch pr.patch`   |

`hunk diff` shows unstaged and untracked changes only. Use `hunk diff HEAD` to include staged changes.

Open the same review afterward. If Hunk is already open, run **Guide: reload guide file**.

### Every change, automatically

Add an instruction to the repository's `AGENTS.md` or `CLAUDE.md`:

```markdown
After finishing a change, read and follow <hunk-guide>/skills/create-hunk-guide/SKILL.md
to create .hunk/guide.json for the changes shown by `hunk diff HEAD`.
```

If your agent commits its work, name the range you review instead, such as `hunk diff main...HEAD`.

### Pull requests

Prefer a dedicated worktree or clone so the agent can read the full repository:

```sh
gh pr checkout 123 --repo owner/repo
gh pr view 123 --repo owner/repo --json baseRefName --jq .baseRefName
```

Ask for a guide for `hunk diff origin/<base>...HEAD`, using the reported base branch, then review that range.

Without a checkout, freeze the patch so the agent and Hunk read identical bytes:

```sh
gh pr diff 123 --repo owner/repo > /tmp/pr-123.patch
```

Ask for `/tmp/pr-123-guide.json` for `hunk patch /tmp/pr-123.patch`. The agent checks it with `bun <hunk-guide>/bin/check.ts --guide /tmp/pr-123-guide.json --patch /tmp/pr-123.patch`. Open it with:

```sh
HUNK_GUIDE_FILE=/tmp/pr-123-guide.json hunk patch /tmp/pr-123.patch
```

If the diff changes, regenerate the guide.
