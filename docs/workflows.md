# Review workflows

Point the coding agent at [`create-hunk-guide`](../skills/create-hunk-guide/SKILL.md), name the exact changeset, and review that same changeset in Hunk.

## Working tree

From the repository being reviewed, ask the agent:

```text
Read and follow:

<hunk-guide-checkout>/skills/create-hunk-guide/SKILL.md

Create .hunk/guide.json for the current working tree relative to HEAD,
including staged, unstaged, and untracked changes. Use balanced density.
Inspect the complete diff and validate every target against an exact changed
hunk. Do not modify source files or launch Hunk.
```

Then open the same working tree:

```sh
hunk diff --watch
```

## Checked-out pull request

Prefer a dedicated worktree or clone so the agent can inspect the full repository.

```sh
gh pr checkout 123 --repo owner/repo
gh pr view 123 --repo owner/repo --json baseRefName --jq .baseRefName
```

Use the reported base branch in both the prompt and Hunk command:

```text
Read and follow:

<hunk-guide-checkout>/skills/create-hunk-guide/SKILL.md

Create .hunk/guide.json for the pull-request changes represented by
origin/<base>...HEAD. Inspect the complete changeset and repository context.
Validate every target against that exact diff. Do not modify source files or
launch Hunk.
```

```sh
hunk diff origin/<base>...HEAD
```

## Pull request without checkout

Freeze the patch so the agent and Hunk read identical bytes:

```sh
gh pr diff 123 --repo owner/repo > /tmp/pr-123.patch
```

Ask the agent:

```text
Read and follow:

<hunk-guide-checkout>/skills/create-hunk-guide/SKILL.md

Create /tmp/pr-123-guide.json for the exact patch at /tmp/pr-123.patch.
Validate every target against that patch. Do not modify the repository or
launch Hunk.
```

Open the frozen patch with its guide:

```sh
HUNK_GUIDE_FILE=/tmp/pr-123-guide.json \
  hunk patch /tmp/pr-123.patch
```

If the diff changes, regenerate the guide. If Hunk is already open, run **Guide: reload guide file**.
