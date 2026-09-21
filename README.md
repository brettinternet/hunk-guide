# hunk-guide

hunk-guide adds a guided walkthrough to [Hunk](https://hunk.dev). Instead of reviewing a changeset only in filesystem order, a guide groups related edits into an ordered narrative and navigates you through the actual diff.

Hunk's normal diff remains the primary UI. hunk-guide adds an independent pane, exact-line navigation, session-local review progress, and an explicit checkpoint for focusing on guide targets affected by later edits. The Guide and built-in files panes keep independent open state, so toggling either never changes the other. It does not create comments, replace Hunk's renderer, or call an AI provider.

> hunk-guide is an early Phase 1 prototype built against Hunk's experimental public extension API.

## Try the fixture

From this checkout:

```sh
bun install
hunk patch fixtures/basic-review.patch
```

The repository's [example Hunk config](.hunk/config.toml) loads the local extension and bundled guide for this command. Its comments explain each setting so it can be adapted for another repository.

The fixture has six conceptual sections, multiple files, multi-target sections, tests, and a final supporting change. Use Hunk's **Extensions** menu or the default bindings:

| Action                  | Default       |
| ----------------------- | ------------- |
| Toggle Guide            | `Alt+G`       |
| Next section            | `Alt+J`       |
| Previous section        | `Alt+K`       |
| Next target             | `Alt+L`       |
| Previous target         | `Alt+H`       |
| Toggle target reviewed  | `Alt+R`       |
| Toggle section reviewed | `Alt+Shift+R` |
| Set change checkpoint   | `Alt+C`       |
| Toggle all/changed      | `Alt+V`       |
| Show overview           | `Alt+O`       |

Progress, overview, checkpoint, changed/all scope, and reload commands are available in the Extensions menu without default bindings.

Do not run the demo command unattended: Hunk is an interactive terminal application.

## Install

Once the repository is published:

```sh
hunk extension install brettinternet/hunk-guide
```

For local development, use the repository's [example Hunk config](.hunk/config.toml), pass `--extension .`, or install the checkout:

```sh
hunk extension install /path/to/hunk-guide
```

## Load a guide

The easiest coding-agent workflow is an environment variable:

```sh
HUNK_GUIDE_FILE=./guide.json hunk diff
```

hunk-guide chooses a file in this order:

1. `HUNK_GUIDE_FILE`.
2. `[extension.hunk-guide].file` in Hunk config.
3. `./hunk-guide.json` when present.

A relative path is resolved from the reviewed working directory. Repository-controlled Hunk config may only select a file inside that directory. The environment variable is explicit user input and may point elsewhere.

Optional Hunk configuration:

```toml
[extension.hunk-guide]
file = ".hunk/guide.json"
default_open = true
placement = "right" # or "left"
```

Every guide action is a named Hunk command and can be rebound in the normal `[keybindings]` table. Command IDs use the `hunk-guide.*` namespace, for example `hunk-guide.next-section` and `hunk-guide.toggle-reviewed`. Hunk lists extension commands in its Extensions menu; its public API does not currently let an extension add rows to the built-in Controls help. The Guide pane shows the effective remapped navigation keys instead.

## Guide JSON

```json
{
    "version": 1,
    "id": "authentication-retry",
    "title": "Authentication retry",
    "summary": "Retries move behind one policy and propagate through token refresh.",
    "sections": [
        {
            "id": "retry-policy",
            "title": "Introduce the retry policy",
            "explanation": "Start with the policy shared by refresh and API clients.",
            "targets": [
                {
                    "id": "retry-policy-type",
                    "path": "auth/retry.ts",
                    "side": "new",
                    "startLine": 12,
                    "endLine": 28,
                    "symbol": "RetryPolicy"
                }
            ]
        }
    ]
}
```

Requirements:

- `version` is currently `1`.
- Guide, section, and target IDs are stable non-empty strings. Target IDs are globally unique within a guide.
- A section is one logical change and may contain targets in several files.
- `side` defaults to `new`.
- Lines are one-based and inclusive. The complete target range must be inside one changed Hunk range.
- `symbol` is reserved for future target reconciliation; Phase 1 does not resolve it.
- Declared section and target order is preserved exactly. Put contracts/model first, then implementation, consumers, boundaries, errors/observability, tests, and mechanical work.

Invalid or unresolved targets are shown as unavailable. hunk-guide never clamps a bad line or navigates to a guessed location.

## Review progress and live changes

**Toggle target reviewed** and **Toggle section reviewed** store progress for the current Hunk session. A reviewed target becomes stale if its definition or containing changed file later differs. Stable IDs make persistence possible later, but the MVP writes no review database.

“Changed since last viewed” would imply viewport tracking that Hunk's public API does not expose. hunk-guide uses an honest explicit checkpoint instead:

1. Run **Guide: set change checkpoint**.
2. Keep Hunk running with `--watch` while an agent edits the tree.
3. Run **Guide: toggle all/changed scope** to show only affected, new, missing, or incomparable guide targets.
4. Toggle back to all targets at any time.

The scope changes only the Guide pane. It never filters or hides Hunk's canonical diff. Files changed outside the guide are counted so a stale guide is visible rather than silently appearing complete. Guide order is not regenerated during a Hunk reload; **Guide: reload guide file** is explicit and keeps the last valid guide if reload fails.

## Development

This repository follows the toolchain conventions from [`brettinternet/project`](https://github.com/brettinternet/project): Mise pins tools, Task exposes workflows, Lefthook checks staged changes, Gitleaks scans commits, Worktrunk config prepares isolated worktrees, and CI runs on Linux, macOS, and Windows.

```sh
mise trust
mise install
task init
task test
task check
```

The extension imports TypeScript directly; there is no build step. Hunk supplies React, OpenTUI, and `hunkdiff/extension` at runtime, so they are development dependencies only.

See [DESIGN.md](DESIGN.md) for current API research, architectural decisions, known public API gaps, and the deferred external-command generator boundary.

## Current limitations

- Guide creation is a local JSON workflow; no command generator or model SDK is included.
- Review progress and checkpoints are session-local.
- Target identity is path + side + line/range. Symbols and content fingerprints are future enhancements.
- A target hidden by Hunk's active file filter remains valid but cannot be revealed through the public navigation API until the filter is cleared.
- Hunk currently shares visibility across vertical pane edges. Opening Guide may also reveal a logically open files pane; [Hunk #1114](https://github.com/modem-dev/hunk/issues/1114) requests independent edge visibility.
- Hunk's public API does not let extensions contribute rows to the built-in Controls help; use the Extensions menu or the live shortcut labels in the Guide pane.

## License

MIT
