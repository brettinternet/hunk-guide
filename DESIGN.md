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
6. Toggle the Guide pane off and use plain Hunk unchanged.

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

The prototype will use only these public APIs. It will not use `transformChangeset`: reordering or removing Hunk's canonical files would turn the guide into a presentation replacement and would interfere with normal review behavior.

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

interface GuideSection {
    id: string;
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
3. `./hunk-guide.json` when it exists.

The extension bounds file bytes, sections, targets, and text lengths. It rejects unknown versions, duplicate section or target IDs, empty paths, invalid sides, non-positive or reversed line ranges, and malformed JSON. Reload failure retains the last valid guide and reports one warning; it never breaks the review.

## Target resolution

Targets use logical source addresses, never renderer rows:

```text
path + side + line/range
```

Resolution is exact and conservative:

- New-side targets match `file.path`.
- Old-side targets match `file.previousPath ?? file.path`.
- The target's start and end must intersect one public hunk range on that side. A target spanning multiple hunks is invalid in Phase 1.
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

The changed-only scope compares the current target fingerprints to that fixed checkpoint, not merely to the previous reload. It includes `changed`, `new`, `missing`, and `unknown` targets, and excludes only targets proven `unchanged`. Before a checkpoint exists, changed-only scope is unavailable.

Authoritative `contentIdentity`/`sourceIdentity` values are used when a command snapshot provides them. Lifecycle-only reconciliation uses a deterministic patch/hunk fingerprint. Comparisons between incompatible fingerprint kinds are `unknown`; the UI must not claim line-level precision when only a containing-file identity changed.

The scope affects only the Guide pane and guide navigation. It never hides files or lines in Hunk's diff. A separate **Toggle Guide** command opens/closes the pane; closing it returns the user to ordinary Hunk.

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
- Reload guide

Default bindings should be sparse to avoid conflicts. Every command remains available from Hunk's Extensions menu if unbound.

## Configuration

Initial configuration is intentionally narrow:

```toml
[extension.hunk-guide]
file = ".hunk/guide.json"
default_open = true
placement = "right"
```

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
5. No extension contribution API for the built-in Controls help. Registered commands appear in Hunk's Extensions menu, while the Guide pane must render effective key labels itself.
6. No documented stable review-session identity. Current Hunk emits `changeset_loaded` before `session_reload` on every content reload, so module-local state resets only on the extension instance's first changeset and otherwise remains session-only.
7. No provider registration API. Future generation is an external command producing validated JSON unless Hunk adds the issue #612 surface.
8. Hunk validates navigation only against visible files. An extension cannot reveal a target hidden by the user's active filter without changing that filter, and no public filter setter exists.

## Deferred Phase 2 boundary

After the static interaction is evaluated, an external command may accept a versioned, renderer-neutral input containing repository/review metadata plus file paths, change types, public hunks, and patches, then return `GuideDocumentV1` JSON.

That phase must separately decide process trust, cwd, environment inheritance, cancellation, timeout, byte limits, progress, and malformed-output behavior. Every returned target must pass the same deterministic resolution used by static files. No model SDK belongs in hunk-guide.

## UX questions to evaluate interactively

The public API and deterministic tests can prove correctness, but only a real terminal review can answer:

- Is a right pane the best default placement and width?
- Is a section list plus current explanation readable without crowding the diff?
- Should next section always land on its first unresolved target or preserve the last target visited?
- Are target-level or section-level reviewed controls more natural in practice?
- Is Hunk's current-line marker enough feedback for keyboard and mouse target navigation?
- How should unavailable filtered targets be explained without nagging?

Provider work waits until those answers are clear.
