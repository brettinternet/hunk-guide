# hunk-guide

hunk-guide adds guided walkthroughs to [Hunk](https://hunk.dev). Instead of reviewing a changeset only in filesystem order, it groups related edits into an ordered narrative and navigates through the actual diff.

Hunk's normal diff remains the primary UI. hunk-guide adds an independent pane, section-focused presentation, exact-line navigation, session-local review progress, and explicit change checkpoints for live edits. A sticky **Show all changes** control restores full context without leaving the guide. Guide and files panes maintain independent open state. The extension does not create comments, replace Hunk's renderer, or call AI providers. An optional external command can generate a session-local guide without a shell or model SDK.

> hunk-guide is an early Phase 1 prototype built against Hunk's experimental public extension API.

## Try the fixture

From this checkout:

```sh
bun install
hunk patch fixtures/basic-review.patch
```

Do not run the demo command unattended: Hunk is an interactive terminal application.

The fixture demonstrates six conceptual sections, multiple files, multi-target sections, tests, and a supporting change. It loads the repository's [example Hunk config](.hunk/config.toml), which documents each setting for adaptation.

### Keybindings

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

Progress, overview, checkpoint, changed/all scope, and reload commands are also available in Hunk's **Extensions** menu without default bindings.

## Install

Stable release:

```sh
hunk extension install brettinternet/hunk-guide@v0.1.0
```

Latest development from `main`:

```sh
hunk extension install brettinternet/hunk-guide
```

`hunk extension update` preserves tag pins because Hunk does not currently resolve newer SemVer releases. Upgrade tagged installs by specifying the new tag explicitly.

Local development:

```sh
# Use .hunk/config.toml, pass --extension ., or install the path:
hunk extension install /path/to/hunk-guide
```

## Load a guide

Set `HUNK_GUIDE_FILE` (recommended for coding agents):

```sh
HUNK_GUIDE_FILE=./guide.json hunk diff
```

File resolution precedence:

1. `HUNK_GUIDE_FILE` (explicit user input; can point anywhere)
2. `[extension.hunk-guide].file` in Hunk config (must resolve within the reviewed working directory)
3. `./.hunk/guide.json` when present
4. `./hunk-guide.json` when present (legacy compatibility)

Relative paths resolve from the reviewed working directory.

### Generated guide lifecycle

`.hunk/guide.json` is the uncommitted active guide for one checkout or worktree. Generate or replace it for each new changeset; switching branches in the same checkout does not remove the ignored file. Separate worktrees have separate active guides.

If Hunk is already open after replacing the file, run **Guide: reload guide file**. Use `HUNK_GUIDE_FILE` when selecting a named guide or a file stored elsewhere. Commit guides only when they are intentionally maintained fixtures, examples, or durable project documentation.

### Configuration

Optional settings in `.hunk/config.toml`:

```toml
[extension.hunk-guide]
file = ".hunk/guide.json"
default_open = true
placement = "right" # or "left"
density = "balanced" # compact | balanced | thorough
show_verification = true
show_supporting = false
show_mechanical = false
provider_timeout_seconds = 300 # bounded to 10..1800 seconds
```

- `density`: Generation preference rather than a quota: `compact` (roughly 3-5 sections), `balanced` (default, 4-7 sections), or `thorough` (6-10 sections). Small changes may need fewer. It is passed to the external generator and never changes a loaded guide.
- `provider_timeout_seconds`: Maximum external-command runtime, bounded to 10 through 1,800 seconds. Output is bounded and both stdout and stderr are drained concurrently.
- Keybindings: Every guide action is a named command in the `hunk-guide.*` namespace (e.g. `hunk-guide.next-section`, `hunk-guide.toggle-reviewed`) and rebindable under `[keybindings]`. Hunk's public API does not currently let extensions add rows to the built-in Controls help; the Guide pane displays effective remapped navigation keys instead.

## External command generation

Set `HUNK_GUIDE_COMMAND` to either one executable path or a JSON argv array. It is executed directly with no shell expansion, pipes, redirects, or string-splitting. The command is trusted code: it runs from the review directory and inherits Hunk's environment, filesystem, credentials, and network access. Repository configuration cannot select the executable.

```sh
HUNK_GUIDE_COMMAND='["./tools/make-guide", "--format", "hunk-guide-v1"]' hunk diff
# or
HUNK_GUIDE_COMMAND=./tools/make-guide hunk diff
```

Use **Guide: generate with external command** (`Alt+Y`) to generate a guide for the latest changeset, or **Guide: cancel generation** (`Alt+Shift+Y`) to stop it. Generation sends a versioned JSON request containing public paths, patches, hunk ranges, review metadata, content identities, and the configured density. Runtime renderer IDs are never sent. The command must write one versioned response envelope to stdout:

```json
{
    "protocolVersion": 1,
    "requestId": "<request id>",
    "guide": {
        "version": 1,
        "id": "example",
        "sections": [
            {
                "id": "first-change",
                "title": "First change",
                "targets": [
                    { "id": "first-target", "path": "src/main.ts", "side": "new", "startLine": 1 }
                ]
            }
        ]
    }
}
```

The guide document is strictly validated, and every target must resolve against both the captured and current changesets before replacing the last known-good guide. Invalid output, timeout, cancellation, reload, or shutdown leaves the previous guide visible. The generated guide is session-local and is not written to `.hunk/guide.json`.

## Guide JSON

Coding agents should follow [the authoring guide](docs/authoring.md) for narrative ordering, section density, concise explanations, and grouping examples.

```json
{
    "$schema": "https://raw.githubusercontent.com/brettinternet/hunk-guide/main/hunk-guide.schema.json",
    "version": 1,
    "id": "authentication-retry",
    "title": "Authentication retry",
    "summary": "Retries move behind one policy and propagate through token refresh.",
    "sections": [
        {
            "id": "retry-policy",
            "kind": "change",
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

The checked-in [`hunk-guide.schema.json`](./hunk-guide.schema.json) provides coding-agent guidance plus editor completion and validation. Add the `$schema` property shown above, or use a relative path to a local copy of the schema.

### Schema rules

- `$schema`: Optional JSON Schema URI for authoring tools; it does not affect guide behavior.
- `version`: Currently `1`.
- IDs: Stable non-empty strings. Target IDs must be globally unique within the guide.
- Sections: Represent one logical change and can span multiple files.
- `kind`: Optional; defaults to `change`. Valid kinds are `change`, `verification`, `supporting`, and `mechanical`. Classify by review purpose rather than path: behavior and contracts are `change`, tests and benchmarks are `verification`, secondary context is `supporting`, and generated output, formatting, or bulk renames are `mechanical`.
- `side`: Defaults to `"new"`.
- Lines: 1-based and inclusive. Target ranges must fit inside a single changed Hunk range.
- `symbol`: Reserved for future target reconciliation; Phase 1 does not resolve it.
- Ordering: Preserved exactly as declared. Recommended sequence: contracts/models, implementation, consumers, boundaries, errors/observability, tests, and mechanical work.
- Invalid or unresolved targets appear as unavailable; hunk-guide never clamps lines or navigates to guessed locations.

Default to a separate `verification` section near the end for tests, after reviewers understand the behavior they prove. Keep a test in a `change` section only when it best explains that behavior. Cross-cutting, integration, and end-to-end tests belong in `verification`; metadata and secondary context belong in `supporting`; generated output, formatting, and bulk renames belong in `mechanical`. Split mixed-purpose sections so visibility remains predictable.

## Review progress and live changes

- Session-local: Mark targets or sections reviewed (`Alt+R` / `Alt+Shift+R`). A reviewed target becomes stale if its definition or containing changed file later differs. Stable IDs make persistence possible later, but the MVP writes no review database.
- Explicit checkpoints: "Changed since last viewed" would imply viewport tracking that Hunk's public API does not expose; hunk-guide uses an explicit checkpoint instead:
    1. Run **Guide: set change checkpoint** (`Alt+C`).
    2. Keep Hunk running with `--watch` while an agent edits the tree.
    3. Run **Guide: toggle all/changed scope** (`Alt+V`) to show only affected, new, missing, or incomparable guide targets.
    4. Toggle back to all targets at any time.
- Checkpoint presentation: Changed (`~`), missing (`!`), new (`+`), and incomparable (`?`) states are labeled independently from cursor and review progress. Files outside the guide are listed by path and identified as changed, new, or unknown.
- Section focus: Selecting a section focuses the diff on the deduplicated union of its target-containing hunks while preserving Hunk's canonical order. **Show all changes** is sticky: while enabled, guide navigation jumps without re-entering focus. Closing Guide, showing overview, an unavailable section, or an extension failure restores the full diff. This requires a host-owned transient presentation scope and fails open to the full diff on Hunk versions that do not provide it.
- Guide visibility: Changed scope and the **toggle verification/supporting/mechanical sections** commands determine Guide navigation and which section can be focused. Initial visibility comes from `show_verification` (defaults to `true`), plus `show_supporting` and `show_mechanical` (both default to `false`). Files in hidden sections remain represented, while changed files outside the guide are counted so stale guides remain visible.
- Reloads: Guide order is not regenerated during a Hunk reload. Run **Guide: reload guide file** to reload manually; failed reloads retain the last valid guide.

## Development

```sh
mise trust
mise install
task init
task test
task check
```

TypeScript is imported directly with no build step. Hunk supplies React, OpenTUI, and `hunkdiff/extension` at runtime (`devDependencies`).

### Releases

`main` is the latest development version. Published versions use immutable SemVer tags matching `package.json` (`v0.x.x`) and remain on the `0.x` line while the Hunk extension API and Guide behavior are evolving.

1. Run the **Release** workflow from `main` with the package version (e.g. `0.1.0`) and concise release notes.
2. The workflow runs the full CI matrix, verifies the version and tag, then creates the GitHub release only after CI passes.
3. Published tags cannot be moved or deleted because GitHub immutable releases are enabled.

See [DESIGN.md](DESIGN.md) for current API research, architectural decisions, known public API gaps, and the deferred external-command generator boundary.

## Current limitations

- External generation is opt-in through `HUNK_GUIDE_COMMAND`; no model SDK is included. Commands are direct argv processes and are bounded by timeout and output limits.
- Review progress and checkpoints are session-local.
- Target identity is path + side + line/range. Symbols and content fingerprints are future enhancements.
- A target hidden by Hunk's active file filter remains valid but cannot be revealed through the public navigation API until the filter is cleared.
- Current released Hunk versions do not expose the transient presentation-scope API required for section focus, so the extension currently fails open to the full diff and uses jump navigation.
- Hunk currently shares visibility across vertical pane edges. Opening Guide may also reveal a logically open files pane ([Hunk #1114](https://github.com/modem-dev/hunk/issues/1114)).
- Hunk's public API does not let extensions contribute rows to the built-in Controls help; use the Extensions menu or the live shortcut labels in the Guide pane.
