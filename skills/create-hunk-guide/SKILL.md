---
name: create-hunk-guide
description: Create a narrative hunk-guide artifact for an exact code changeset.
---

# Create a hunk-guide artifact

Create a review narrative for the exact requested changeset. The guide should explain the change in dependency order while leaving findings, comments, and verdicts to the reviewer.

Write `.hunk/guide.json` at the repository root unless the caller names another destination. Replace an old generated guide for a new changeset. Do not infer a destination from `HUNK_GUIDE_FILE`.

Use the canonical [guide schema](https://raw.githubusercontent.com/brettinternet/hunk-guide/main/hunk-guide.schema.json). The detailed authoring guide is at https://github.com/brettinternet/hunk-guide/blob/main/docs/authoring.md.

## Workflow

1. Inspect the complete requested diff, commit range, or patch. Line numbers must match the Hunk command the reviewer will run: `hunk diff` shows unstaged and untracked changes, `hunk diff <target>` compares with a revision or range, and `hunk patch <file>` reads a patch. If the exact review source is ambiguous, ask for it or report the ambiguity instead of guessing line coordinates.
2. Identify the few reviewer questions that explain the change. Prefer contracts and models, core behavior, consumers and boundaries, failure behavior, verification, supporting context, then mechanical work.
3. Create one section per logical review step, not per file. A section may target several files.
4. Keep titles specific and explanations to one or two short sentences about intent and relationships. Do not narrate syntax already visible in the diff.
5. Select the smallest useful changed ranges. Every target must use an exact repository-relative path, explicit `old` or `new` side, and 1-based inclusive lines wholly contained by one changed hunk on that side.
6. Write the file, then check it with the bundled checker. It lives at `bin/check.ts` in the hunk-guide checkout two directories above this skill. Run it from the reviewed repository with the same arguments as the Hunk command:

    ```sh
    bun <hunk-guide>/bin/check.ts                      # hunk diff
    bun <hunk-guide>/bin/check.ts origin/main...HEAD   # hunk diff origin/main...HEAD
    bun <hunk-guide>/bin/check.ts --patch review.patch # hunk patch review.patch
    ```

    Add `--guide <file>` for another destination. Fix every reported target and rerun until it passes. If the checker is unavailable, compare each target with the hunk headers by hand and say so.

## Document rules

The top-level object contains:

- `version`, currently `1`;
- a stable, non-empty `id`;
- optional `title` and `summary`; and
- a non-empty ordered `sections` array.

Each section contains a stable unique `id`, `title`, optional `explanation`, optional `kind`, and a non-empty `targets` array. Valid kinds are:

- `change` for behavior, contracts, and implementation;
- `verification` for tests and benchmarks;
- `supporting` for secondary documentation or metadata; and
- `mechanical` for generated output, formatting, or bulk renames.

Each target contains a globally unique `id`, exact `path`, explicit `side`, `startLine`, and optional `endLine` and `symbol`. `endLine` defaults to `startLine` and cannot precede it. Old-side rename targets use the previous path. Deleted-file targets use the old side.

Preserve causal order. Use stable descriptive IDs so regeneration can retain review progress. A balanced guide usually has four to seven sections, but density is guidance, not a quota.

Do not include review findings, defect claims, approval language, instructions to comment, or guessed motivation. A guide is orientation only and must never become a review annotation.

Do not launch interactive Hunk during unattended execution. Report the artifact path and any unresolved ambiguity when finished.
