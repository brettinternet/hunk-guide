@AGENTS.local.md

# hunk-guide

## Workflow

- Install the pinned toolchain and hooks with `task init`.
- Use `task` targets rather than reconstructing project commands.
- Run the smallest relevant tests while developing. Run `task check` before a release or after cross-cutting changes.
- Before committing, stage only intended files and run `task check:staged`.
- Create agent branches as Worktrunk worktrees under `.worktrees/`.

## Extension constraints

- Use only the public API exported by `hunkdiff/extension`.
- Hunk owns diff rendering, filtering, navigation, comments, and VCS operations. Guide content must never become a review annotation.
- Fail open: extension errors must leave normal Hunk review usable.
- Never write to stdout or stderr from extension runtime code; use Hunk notifications.
- Treat `hunk.config`, tour files, and future generator output as untrusted input.
- Runtime imports supplied by Hunk (`react`, `@opentui/*`, and `hunkdiff/extension`) stay in `devDependencies`; never bundle React.
- Do not launch the Hunk TUI from an unattended check. Ask for an interactive smoke test.

## Git

- Use `gh` for GitHub operations.
- Do not push or open a pull request without explicit instruction.
