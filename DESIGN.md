# hunk-guide design

Status: Phase 1 static-guide prototype

Research baseline: Hunk `main` at `7b99dd089fead5d5ad8deabcc1c2380aee6afa91` (extension API 28, 2026-09-20), plus Hunk PR #717, issue #612, `hunk-tutor`, `hunk-triage`, and `hunk-lens`.

## Product boundary

hunk-guide adds a narrative and progress layer to Hunk. Hunk remains the source of truth for diff rendering, filtering, layouts, comments, VCS operations, and normal navigation.

A guide is not review feedback. Guide titles and explanations render only in the Guide pane. They must never become Hunk annotations or reviewer notes.

Phase 1 proves this interaction with a static JSON guide:

1. Read a short ordered explanation.
2. Jump to each exact source target in Hunk's normal diff.
3. Mark targets reviewed and see section progress.
4. Keep the guide stable when `--watch` reloads the changeset.
5. Explicitly checkpoint the current changeset, then focus the guide on targets whose containing file changed since that checkpoint.
6. Focus the diff on the current section's target-containing hunks, with one sticky **Show all changes** toggle to restore full context.
7. Toggle the Guide pane off and use plain Hunk unchanged.

## What the current public API supports

Hunk's API differs materially from older guided-review proposals:

- The current API has no `registerReviewPlanProvider` or other declarative semantic-section presentation API. Issue #612 proposes that capability; it is not on `main`.
- `registerPane` can add an independently toggleable pane on any edge. A pane receives the currently visible/filtered files and generation-local file IDs.
- `registerCommand` provides named, user-rebindable commands. Raw keyboard handling is unnecessary for guide navigation.
- `navigation.revealLine(fileId, side, line)` provides exact source-line navigation with Hunk-owned fallback to the containing hunk.
- `registerLineHighlighter` can paint source-coordinate character ranges without replacing the diff renderer.
- `changeset_loaded` and `session_reload` expose immutable changesets. Reload reasons distinguish watch, daemon, extension, and manual reloads.
- `ctx.review.snapshot()` is available only to command handlers. It provides authoritative `fileKey`, `contentIdentity`, optional `sourceIdentity`, and the `runtimeId` valid for that exact review generation.
- Pane props and lifecycle changesets expose patches and public hunk ranges, which are enough for conservative deterministic target validation. Their runtime file IDs are not durable.
- Hunk extension configuration is available through `[extension.hunk-guide]`, but repository configuration is untrusted input.

The extension uses only public APIs. It will not use `transformChangeset`: reordering or removing Hunk's canonical files would mutate the review rather than apply a reversible presentation scope and would interfere with comments, filters, and normal review behavior.

The intended guided interaction is a host-owned transient scope over Hunk's immutable full changeset. Hunk's current public API does not expose that primitive, so section focus remains blocked until the API described under **Section focus** exists. Until then, selection fails open to the full diff and exact target navigation still works.

## Lessons from existing extensions

- `hunk-tutor` proves the core interaction: module-local immutable state via `useSyncExternalStore`, named commands, `revealLine`, public line highlighting, and lifecycle-driven file-ID refresh.
- `hunk-triage` proves async analysis and grouped panes, but its changeset transform and files-pane replacement are deliberately not copied. hunk-guide must preserve Hunk's canonical file order and file pane.
- `hunk-lens` demonstrates that a small independent pane composes cleanly with the normal diff.
- PR #717 added the navigation, lifecycle, and pane controls needed for a guide without exposing renderer internals.
- Issue #612 correctly identifies the remaining core gap: extensions cannot declaratively ask Hunk to render semantic sections, collapsed files, or provider progress in the review stream.

## Phase 1 architecture

```text
versioned JSON file
      |
      v
load + validate ---- keep last known good guide on failure
      |
      v
immutable GuideStore <---- changeset_loaded / session_reload
      |                         |
      |                         v
      |                    resolve paths and hunk ranges
      v
Guide pane + commands ---- fresh command snapshot ---- revealLine
                                                |
                                                v
                                  Hunk current-line marker
```

The Guide remains an independent registration and never claims, replaces, opens, or closes the `hunk:files` role. Guide and files-pane state are independent: toggling either never changes the other. Hunk may render both when both are open and terminal geometry allows it.

Keep the first version small:

```text
src/
  index.tsx                 extension registration
  model.ts                  guide model and schema validation
  config.ts                 trusted environment / bounded config parsing
  state.ts                  immutable store and cursor transitions
  navigation.ts             path and source-range resolution
  tourPane.tsx              Guide pane
  generators/file.ts        static JSON loader only
  reconciliation/reconcileGuide.ts
fixtures/
tests/
```

`generators/file.ts` is a loader, not a provider framework. Phase 1 defines no `TourGenerator` interface and executes no command. The versioned JSON format is already the boundary a later generator can emit.

## Guide file

The external document is versioned and has an explicit stable ID:

```ts
interface GuideDocumentV1 {
    version: 1;
    id: string;
    title?: string;
    summary?: string;
    sections: GuideSection[];
}

type GuideSectionKind = "change" | "verification" | "supporting" | "mechanical";

interface GuideSection {
    id: string;
    kind?: GuideSectionKind; // defaults to "change"
    title: string;
    explanation?: string;
    targets: GuideTarget[];
}

interface GuideTarget {
    id: string;
    path: string;
    side?: "old" | "new";
    startLine: number;
    endLine?: number;
    symbol?: string; // retained for forward compatibility; not resolved in Phase 1
}
```

The product term is **section**, while the JSON shape remains a direct evolution of the proposed tour step. A section is one logical change and may target several files.

Load paths in this order:

1. `HUNK_GUIDE_FILE`, resolved relative to the review working directory when relative. This is explicit process-owner input and may point outside the repository.
2. `[extension.hunk-guide].file`, resolved relative to the review working directory and required to remain inside it because repository config can control this value.
3. `./.hunk/guide.json` when it exists.
4. `./hunk-guide.json` when it exists, for legacy compatibility.

`.hunk/guide.json` is an ignored, generated active guide scoped to one checkout or worktree. It must be replaced for a new changeset; switching branches in one checkout does not remove it. The Guide pane shows the guide title or ID and a shortened source path so reviewers can identify what is loaded.

The extension bounds file bytes, sections, targets, and text lengths. It rejects unknown versions, duplicate section or target IDs, empty paths, invalid sides, non-positive or reversed line ranges, and malformed JSON. Reload failure retains the last valid guide and reports one warning; it never breaks the review.

## Target resolution

Targets use logical source addresses, never renderer rows:

```text
path + side + line/range
```

Resolution is exact and conservative:

- New-side targets match `file.path`.
- Old-side targets match `file.previousPath ?? file.path`.
- The target's entire inclusive range must be contained by one public hunk range on that side. A target spanning multiple hunks is invalid in Phase 1.
- Zero path matches is `missing-file`.
- Multiple path matches is `ambiguous-file`.
- A line outside every public hunk is `missing-line`.
- Targets are never clamped, fuzzy-matched, or silently redirected.
- A filtered-out target remains logically valid but may be unavailable to public navigation. The guide reports that condition and does not alter Hunk's filter.

Lifecycle resolution gives the pane timely state using public changeset data. Before every command navigation, the extension ingests `ctx.review.snapshot()`, maps the target to that snapshot's current runtime ID, verifies the path and generation again, and only then calls `revealLine`. Runtime IDs are never persisted across reloads.

Phase 1 relies on Hunk's current-line marker after `revealLine` instead of a separate highlighter. Pane actions cannot request highlighter refreshes through the public API, so an extension-owned current-target mark would become stale after mouse navigation. Reviewed ranges are not dimmed: broad dimming can obscure the canonical diff and becomes misleading when reviewed content later changes.

## State model

```text
GuideState
  load: source path, guide ID, definition, last error
  session: local epoch
  generation: changeset ID, path index, per-target resolution/fingerprint
  checkpoint: optional per-target fingerprints
  reviewed: (session epoch, guide ID, target ID) -> reviewed fingerprint
  cursor: section ID + target ID
  scope: all | changed-since-checkpoint
  section visibility: verification on/off + supporting on/off + mechanical on/off
```

Every target has three independent derived states:

- Resolution: `resolved`, `missing-file`, `ambiguous-file`, or `missing-line`.
- Checkpoint: `unchanged`, `changed`, `new`, `missing`, or `unknown`.
- Review: `unreviewed`, `reviewed`, or `stale-reviewed`.

Reviewed records store the target/source fingerprint that was present when the user marked the target reviewed. If its definition or containing source changes, it becomes `stale-reviewed`; the user's action is shown but no longer counts as freshly reviewed. Section progress is derived from target states. Commands may offer “mark section reviewed,” but the stored unit remains each target.

Reviewed state is session-local in Phase 1. Stable guide, section, and target IDs make later persistence possible without making it an MVP requirement.

## Reload and live-agent behavior

A Hunk reload and a guide reload are different operations.

On `session_reload`:

- Keep the loaded guide, cursor, checkpoint, and reviewed records.
- Rebuild every generation-local file mapping.
- Reconcile target resolution and fingerprints.
- Mark reviewed targets stale when their source changes or cannot be compared.
- Keep the user's section order and current location when that target still exists.
- Do not reread or reorder the guide.

On explicit **Reload guide**:

- Reread and validate JSON.
- Keep the last good guide on failure.
- Reconcile stable target IDs.
- Mark reviewed targets stale when their target definition changes.
- Place new targets in the file's declared order without moving the user's cursor unnecessarily.

### Changed since checkpoint

“Changed since last viewed” cannot be implemented honestly: Hunk exposes file/hunk selection events but no viewport or line-viewed event. Phase 1 therefore uses an explicit **Set change checkpoint** command.

The changed-only scope compares the current target fingerprints to that fixed checkpoint, not merely to the previous reload. It includes `changed`, `new`, `missing`, and `unknown` targets, and excludes only targets proven `unchanged`. Before a checkpoint exists, changed-only scope is unavailable. Cursor/review progress and checkpoint state use separate indicators: `~ changed`, `! missing`, `+ new`, and `? unknown`. Files outside the guide are listed by path with the same explicit comparison state.

Authoritative `contentIdentity`/`sourceIdentity` values are used when a command snapshot provides them. Lifecycle-only reconciliation uses a deterministic patch/hunk fingerprint. Comparisons between incompatible fingerprint kinds are `unknown`; the UI must not claim line-level precision when only a containing-file identity changed.

Changed-since-checkpoint scope and section-kind visibility govern which sections and targets participate in Guide navigation. Verification, supporting, and mechanical sections can be toggled independently; change sections always remain in the guide. Hidden sections still count as represented when detecting files outside the guide.

### Section focus

While actively using the guide, selecting a section or one of its targets should default to a transient **section focus** presentation. Its scope is the deduplicated union of every resolved target's containing hunk across the section's files. It preserves Hunk's canonical file and hunk order, and it never crops individual lines from a hunk.

A sticky **Show all changes** control and named command switch to the full diff. While Show all is enabled, section and target navigation reveal their destinations without re-entering focus. Selecting overview, closing Guide, unloading or failing the extension, or selecting a section with no resolved targets clears the guide-owned scope and shows all changes. No configuration chooses the initial policy; focus is the guided-review default and Show all is the immediate alternative.

Focus is presentation state only. Hunk continues to own the immutable full changeset, comments, review state, rendering, selection, ordering, and user filters. The Guide pane must show focused hunk/file counts and the number of hidden files or changes. Progress remains explicitly target-based and never implies that hidden or unrepresented changes were reviewed.

The required Hunk API is an extension-owned, generation-scoped view containing runtime file identities and hunk indexes. It must:

- compose with rather than overwrite Hunk's user filter;
- let the owning extension set and clear only its own scope;
- preserve canonical ordering, comments, and review state;
- reject stale generation identities; and
- clear automatically on extension failure, deactivation, or unload.

A separate **Toggle Guide** command opens or closes the pane. Closing it clears section focus and returns the user to ordinary Hunk.

## Commands

All actions are registered Hunk commands so users can bind them in `[keybindings]`:

- Toggle Guide
- Next / previous section
- Next / previous target
- Show overview
- Toggle current target reviewed
- Mark current section reviewed / unreviewed
- Set change checkpoint
- Toggle all / changed-since-checkpoint scope
- Toggle verification sections
- Toggle supporting sections
- Toggle mechanical sections
- Reload guide

Default bindings should be sparse to avoid conflicts. Every command remains available from Hunk's Extensions menu if unbound.

## Configuration

Initial configuration is intentionally narrow:

```toml
[extension.hunk-guide]
file = ".hunk/guide.json"
default_open = true
placement = "right"
density = "balanced" # compact | balanced | thorough
show_verification = true
show_supporting = false
show_mechanical = false
```

Section density is generator guidance, not a renderer quota: `compact` targets 3–5 sections, `balanced` 4–7, and `thorough` 6–10. The preference is an input to future generation; loaded guides retain exactly the sections they declare. `show_verification`, `show_supporting`, and `show_mechanical` set initial Guide visibility; verification defaults to visible while supporting and mechanical sections default to hidden. Named commands can change each during the review.

The environment variable remains the easiest contributor and coding-agent workflow:

```sh
HUNK_GUIDE_FILE=./fixtures/basic-guide.json hunk diff --extension .
```

The fixture is checked in, deterministic, and contains several files, a multi-target section, tests, and a mechanical/supporting section.

## Public API gaps

These are Hunk limitations, not reasons to use internals:

1. No semantic review-plan/presentation/progress registration. Guide sections remain pane-local.
2. No viewport or line-viewed event. Honest “since last viewed” semantics require an explicit checkpoint.
3. Lifecycle events do not carry the command snapshot's authoritative content identities.
4. Pane props contain filtered files and transient runtime IDs, so they are not durable guide state.
5. Vertical pane visibility is shared. Opening a right pane reveals the sidebar area and may also reveal a logically open left files pane; `isOpen` does not report rendered visibility. [Hunk #1114](https://github.com/modem-dev/hunk/issues/1114) tracks edge-independent visibility.
6. No extension contribution API for the built-in Controls help. Registered commands appear in Hunk's Extensions menu, while the Guide pane must render effective key labels itself.
7. No documented stable review-session identity. Current Hunk emits `changeset_loaded` before `session_reload` on every content reload, so module-local state resets only on the extension instance's first changeset and otherwise remains session-only.
8. No provider registration API. Future generation is an external command producing validated JSON unless Hunk adds the issue #612 surface.
9. Hunk validates navigation only against visible files. An extension cannot reveal a target hidden by the user's active filter without changing that filter, and no public filter setter exists.
10. No extension-owned transient presentation scope exists. `transformChangeset` changes canonical review input and is not a safe substitute for section focus.

## External-command provider contract

Phase 2 adds one optional provider: a trusted external command that receives one review snapshot on stdin and returns one guide on stdout. The command may be a deterministic analyzer, a local model, or an adapter around a coding agent. hunk-guide knows none of those distinctions and contains no model SDK, prompt format, provider authentication, or agent-specific process handling.

Generation is explicit. It never runs at startup, on `--watch` reload, or on guide reload, because commands may be slow, costly, or have network side effects. **Generate guide** starts one run; **Cancel guide generation** stops it. Static files remain a complete workflow for coding agents that prefer to write `.hunk/guide.json` themselves.

### Command trust and launch

Repository configuration is untrusted and must not be allowed to select an executable. Until Hunk exposes configuration provenance or a first-run confirmation API, the process owner selects the command with `HUNK_GUIDE_COMMAND`:

```sh
HUNK_GUIDE_COMMAND=hunk-guide-codex hunk diff
HUNK_GUIDE_COMMAND='["hunk-guide-agent","--profile","review"]' hunk diff
```

A plain value names one executable. A value beginning with `[` is a JSON array of non-empty argv strings. No shell is involved, so shell operators, interpolation, aliases, and command substitution have no meaning. Invalid or empty argv disables generation with an actionable message. Repository config may set bounded non-executable preferences such as `density` and `provider_timeout_seconds`, but may not add argv or environment entries.

The child runs with the review working directory as cwd and inherits the Hunk process environment. Environment inheritance is intentional: real CLI providers need `PATH`, credentials, proxy settings, and their own configuration. This is not a sandbox: selecting a command grants it the same filesystem, environment, network, and repository-mutation access as Hunk. The pane must show the executable basename before the first run but not the full argv, whose arguments may contain secrets. The child also receives `HUNK_GUIDE_PROTOCOL=1`. The extension never writes provider output or diagnostics to stdout or stderr.

The command is a one-shot subprocess, not a daemon:

1. Capture an authoritative command snapshot and pair it with the latest immutable changeset. Abort if their files cannot be matched exactly.
2. Spawn the argv directly, write one UTF-8 JSON request to stdin, and close stdin.
3. Drain stdout and stderr concurrently while enforcing limits.
4. On exit zero, decode and validate the response, then confirm that the review generation is still current.
5. Atomically replace the in-memory guide only after every check succeeds. The previous valid guide remains visible while generation runs and after any failure.

Generated guides are session-local in the first provider implementation. Automatic persistence creates surprising overwrite and source-precedence behavior, especially when `HUNK_GUIDE_FILE` selects a maintained guide. A later explicit **Save generated guide** command may atomically write a user-selected in-repository path. Providers must not modify `.hunk/guide.json` as a side effect of this protocol.

### Implementation shape

The implementation should keep Hunk adaptation, protocol validation, and process control separate without introducing a general provider framework:

```text
src/providers/external/
  protocol.ts     versioned request/response DTOs and strict parsers
  request.ts      ExtensionChangeset + review snapshot -> protocol request
  runner.ts       argv parsing, spawn, bounded streams, timeout, cancellation
  generate.ts     one-run orchestration and activation result
```

`protocol.ts` and target validation are pure and deterministic. `request.ts` is the only module that knows Hunk API shapes. `runner.ts` knows bytes, processes, and `AbortSignal`, but nothing about guides or agents. `generate.ts` owns the active-run state machine (`idle | running | succeeded | failed | cancelled`), a monotonic review epoch, and a unique invocation token. Completion must match both epoch and token even when termination races with process exit. It returns typed failure categories for the pane and does not render UI. Existing `parseGuide`, reconciliation, and `setGuide` remain the single path for file and provider output after ingress-specific validation.

Tests use tiny fixture executables for success, stderr, nonzero exit, hanging, signal handling, and oversized streams. Protocol/request/target tests remain process-free. This is enough separation to add protocol version 2 or a different transport later without inventing a model-provider abstraction now.

### Version 1 request

Protocol and guide versions are independent. The request advertises accepted guide versions so either can evolve without coupling the subprocess to Hunk's extension API:

```json
{
    "protocolVersion": 1,
    "requestId": "01J...opaque",
    "acceptedGuideVersions": [1],
    "review": {
        "id": "opaque-changeset-id",
        "sourceLabel": "working tree",
        "title": "Review changes",
        "summary": "optional changeset summary",
        "files": [
            {
                "fileKey": "opaque-stable-file-key",
                "path": "src/provider.ts",
                "previousPath": "src/generator.ts",
                "changeKind": "rename-changed",
                "language": "typescript",
                "stats": { "additions": 42, "deletions": 10, "truncated": false },
                "flags": {
                    "untracked": false,
                    "binary": false,
                    "tooLarge": false,
                    "partial": false
                },
                "contentIdentity": "opaque-content-digest",
                "sourceIdentity": "optional-source-digest",
                "patch": "diff --git ...",
                "hunks": [
                    {
                        "oldRange": { "startLine": 8, "endLine": 24 },
                        "newRange": { "startLine": 8, "endLine": 31 }
                    }
                ]
            }
        ]
    },
    "preferences": {
        "density": "balanced"
    }
}
```

All paths are repository-relative, `/`-separated logical paths. Optional fields are omitted rather than emitted as `null`. The request excludes runtime file IDs, renderer metadata, filters, cursor state, comments, review progress, agent annotations, absolute repository paths, and Hunk API objects. `fileKey`, identities, and changeset ID are opaque correlation values, not values providers should parse. A hunk side with no source lines is omitted. Ranges are 1-based and inclusive, matching guide targets. `patch` is the public unified patch exactly as Hunk supplied it; binary or unavailable content uses an empty patch plus the corresponding flags rather than an invented summary. Providers should ignore unknown request fields when `protocolVersion` remains supported.

`preferences.density` is `compact`, `balanced`, or `thorough`. It guides generation before the guide exists; it is not copied into `GuideDocumentV1`, does not hide section kinds, and is not an output quota. Output outside the suggested section counts remains valid.

The extension serializes the complete request before spawning. A request over 16,000,000 bytes is refused rather than truncated, because silent patch truncation would make explanations and target selection unreliable.

### Version 1 response

Exit zero means stdout must contain exactly one UTF-8 JSON response and no logging, Markdown fence, preamble, or trailing non-whitespace data:

```json
{
    "protocolVersion": 1,
    "requestId": "01J...opaque",
    "guide": {
        "version": 1,
        "id": "provider-protocol",
        "title": "External-command provider",
        "summary": "Add a provider without coupling the extension to an agent SDK.",
        "sections": [
            {
                "id": "provider-boundary",
                "kind": "change",
                "title": "Keep one process boundary",
                "targets": [
                    {
                        "id": "provider-runner",
                        "path": "src/provider.ts",
                        "side": "new",
                        "startLine": 8,
                        "endLine": 31
                    }
                ]
            }
        ]
    }
}
```

The guide must satisfy `GuideDocumentV1`, including at least one section. The envelope is strict: protocol version and request ID must match, the guide version must have been advertised, and unknown envelope fields are rejected. Providers send human-readable diagnostics to stderr and use a nonzero exit status for failure. Version 1 has no structured provider-error or progress-message stream; those would add protocol and UI complexity without improving successful output.

### Time, output, and process limits

- The default wall-clock timeout is 300 seconds, configurable from 10 through 1,800 seconds. It covers spawn, stdin writing, and process exit; continuous output does not reset it.
- Stdout has the same 1,000,000-byte hard limit as a guide file. The runner terminates the process as soon as the stream exceeds the limit, before JSON parsing.
- Stderr is drained concurrently and retained only up to 64,000 bytes. Additional bytes are discarded while draining continues so a noisy provider cannot deadlock. On failure the pane shows a sanitized tail, clearly labeled as provider text.
- Limits count bytes, not JavaScript characters. Invalid UTF-8 is an error.
- One generation may run at a time. A second Generate command reports that generation is already active rather than starting or implicitly cancelling another billable operation.

On user cancellation, Hunk shutdown, or any changeset reload, the runner closes its pipes, sends the child process group `SIGTERM`, waits up to two seconds, then sends `SIGKILL` where the platform supports it. Providers should treat `SIGTERM` as cancellation and promptly terminate their descendants. There is no in-band cancel message because stdin is a closed one-request stream. Cancellation is a neutral outcome; timeout, output overflow, spawn failure, nonzero exit, malformed JSON, and validation failure are errors. If several conditions race, an explicit cancellation wins, then timeout/output overflow, then the observed exit status.

### Output and target validation

A successful process exit is not sufficient. The response passes these gates in order:

1. Protocol envelope, request ID, UTF-8, JSON, and byte-limit validation.
2. Existing `GuideDocumentV1` structural validation and section/target/text limits.
3. Fresh-generation target validation against the exact request snapshot.
4. A generation check and the same target validation against the current review immediately before activation.

Every generated target must resolve exactly once by `path` and `side`, and its entire inclusive range must fit within one advertised hunk range on that side. Providers should copy paths verbatim from the request and always emit `side`, even though static guides default it to `new`. Paths must be non-empty normalized repository-relative paths: no absolute paths, `.` or `..` segments, backslashes, or NULs. The host validates but never rewrites path separators, case, segments, or rename addresses. Rename old-side targets use `previousPath`; deleted files require old-side targets; all other matching follows the static-guide rules. Missing, ambiguous, out-of-hunk, wrong-side, and cross-hunk targets reject the whole response with the first bounded set of field-specific errors. Targets are never clamped, fuzzy-matched, moved to a nearby hunk, or silently dropped.

Rejecting the complete response is deliberate: a partially accepted narrative can make later explanations false and gives providers no reliable signal about what the user saw. The last valid guide remains active. Unresolved targets may still arise later after live edits; normal guide reconciliation displays those as unavailable or stale.

### Provider user experience

The Guide pane owns generation status without taking over Hunk's diff:

- Idle: show **Generate guide** only when a valid command is configured.
- Running: keep the old guide usable and show provider basename, elapsed time, timeout, and **Cancel guide generation**.
- Success: switch guides once, preserve reviewed state only where the normal stable-ID and fingerprint rules allow it, and report duration and section/target counts.
- Failure: retain the old guide and show a concise category (`timed out`, `output too large`, `provider failed`, `invalid response`, or `changeset changed`) plus bounded details and a Retry action. Target failures identify the first target and reason plus the remaining error count.
- Cancellation: retain the old guide and return quietly to idle.

A changeset reload cancels an active run instead of accepting stale prose or attempting to retarget it. Regeneration after the reload is always an explicit user action. There is no automatic retry: it can duplicate cost and makes coding-agent behavior harder to reason about.

This boundary keeps adapter authoring small: read one documented JSON object, emit one documented JSON object, log only to stderr, and honor termination. A coding-agent adapter is free to prompt, call a service, or orchestrate tools internally, but hunk-guide sees only the stable protocol.

## UX questions to evaluate interactively

The public API and deterministic tests can prove correctness, but only a real terminal review can answer:

- Is a right pane the best default placement and width?
- Is a section list plus current explanation readable without crowding the diff?
- Should next section always land on its first unresolved target or preserve the last target visited?
- Are target-level or section-level reviewed controls more natural in practice?
- Is Hunk's current-line marker enough feedback for keyboard and mouse target navigation?
- Does default section focus feel orienting, and are its hidden-change counts conspicuous enough?
- How should unavailable user-filtered or unresolved targets be explained without nagging?

These questions remain interactive evaluation criteria; they do not block the external-command boundary or runner implementation.
