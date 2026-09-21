# Authoring guides with coding agents

A guide is a review narrative, not a file index or review verdict. It should help a reviewer understand the change in dependency order while Hunk remains the source of truth for the diff, comments, and VCS operations.

For the JSON schema and loading instructions, see [Guide JSON](../README.md#guide-json). Users can point a coding agent directly to the portable [`create-hunk-guide` skill](../skills/create-hunk-guide/SKILL.md).

## Authoring process

1. Read the complete changeset before choosing sections.
2. Identify the few reviewer questions that explain the change, such as “What contract changed?”, “Where is the policy enforced?”, and “How is it verified?”
3. Turn each question into one logical section. A section may span files and contain multiple targets.
4. Order sections by understanding and dependency, not by path or diff order.
5. Classify sections by review purpose: `change`, `verification`, `supporting`, or `mechanical`.
6. Select the smallest target ranges that contain enough context to understand each point. Every range must be inside one changed Hunk range.
7. Give sections and targets stable, descriptive IDs so regenerating the same guide does not discard review progress.
8. Re-read only the titles and explanations. They should form a coherent summary without duplicating the diff.

Do not include review findings, approval language, or instructions to comment. Guide content is orientation only.

## Writing the active guide

Write generated output to `.hunk/guide.json` unless the caller selected another path with `HUNK_GUIDE_FILE`. This ignored file is the one active guide for the current checkout or worktree; replace it for every new changeset. A separate worktree has its own file, but switching branches in the same checkout leaves the previous file in place.

When replacing the guide while Hunk is open, run **Guide: reload guide file**. A guide generated inside Hunk remains in memory until the reviewer runs **Guide: save generated guide**. Commit a guide only when it is intentionally maintained as a fixture, example, or durable project document.

## Ordering rules

Prefer causal order:

1. Contracts, types, schemas, and data models.
2. Core implementation or policy.
3. Consumers and integration points.
4. API, storage, UI, or other system boundaries.
5. Failure behavior, cleanup, and observability when they are not already part of the core section.
6. Verification: focused tests first, then integration or end-to-end coverage.
7. Supporting context such as documentation or metadata.
8. Mechanical work such as generated output, formatting, and bulk renames.

These are ordering rules, not required sections. Omit categories that do not help explain the changeset. Keep a test beside a behavior only when the test is the clearest way to understand that behavior; otherwise use a separate `verification` section near the end.

Never reorder sections to match the filesystem. hunk-guide preserves the declared order exactly.

## Density

Treat density as a preference, not a quota:

| Density    | Typical sections | Use when                                                                     |
| ---------- | ---------------: | ---------------------------------------------------------------------------- |
| `compact`  |              3–5 | The reviewer needs the main contract, implementation, and verification path. |
| `balanced` |              4–7 | The change has several meaningful layers or consumers. This is the default.  |
| `thorough` |             6–10 | Distinct boundaries, failure modes, or integrations each need attention.     |

Small changes may need fewer sections. Do not manufacture sections to reach a range.

Create a section for one logical review step, not for each file, symbol, commit, or hunk. Combine targets when they answer the same reviewer question. Split a section when:

- its targets represent independent decisions;
- its explanation needs unrelated clauses to justify the grouping;
- part of it belongs to a different visibility kind; or
- the reviewer can understand one part without the prerequisite needed by another.

As a practical check, most sections should have a short explanation and one to three targets, but neither is a hard limit. More targets are appropriate when one concept is deliberately distributed across several files.

## Titles and explanations

Use a specific title that names the review step, such as “Resolve the effective policy” rather than “Resolver changes.”

Keep an explanation to one or two short sentences. It should say:

- what changed and why it matters; and
- how the targets relate or what the reviewer should understand before moving on.

Do not restate paths, enumerate every edited symbol, narrate syntax, or claim correctness. The diff already shows implementation detail.

Good:

> The resolver walks the parent chain and returns the first explicit value, keeping inheritance logic out of consumers.

Too vague:

> This section updates the resolver.

Too detailed:

> `resolveEffectivePolicy` initializes `current`, enters a `while` loop, checks `value !== undefined`, assigns `current.parentId`, and returns the default after the loop.

## Good grouping versus over-fragmentation

The following balanced outline tells one causal story:

```json
{
    "sections": [
        {
            "id": "policy-model",
            "title": "Introduce the inheritance contract",
            "targets": ["policy-type", "policy-source"]
        },
        {
            "id": "resolution",
            "title": "Resolve the effective policy",
            "targets": ["resolver"]
        },
        {
            "id": "consumers",
            "title": "Apply the resolved policy",
            "targets": ["enrollment", "api-response"]
        },
        {
            "id": "verification",
            "kind": "verification",
            "title": "Verify precedence and propagation",
            "targets": ["resolver-test", "enrollment-test"]
        }
    ]
}
```

This is an abridged outline: target IDs stand in for full target objects. The model, implementation, consumers, and evidence each form a meaningful review step.

Avoid turning the same change into a table of contents:

```json
{
    "sections": [
        { "id": "policy-file", "title": "Update policy.ts", "targets": ["policy-type"] },
        { "id": "types-file", "title": "Update policy-types.ts", "targets": ["policy-source"] },
        { "id": "resolver-function", "title": "Add resolver function", "targets": ["resolver"] },
        { "id": "enrollment-file", "title": "Update enrollment.ts", "targets": ["enrollment"] },
        { "id": "api-file", "title": "Update API file", "targets": ["api-response"] },
        {
            "id": "resolver-test-file",
            "title": "Update resolver test",
            "targets": ["resolver-test"]
        },
        {
            "id": "enrollment-test-file",
            "title": "Update enrollment test",
            "targets": ["enrollment-test"]
        }
    ]
}
```

The fragmented version makes navigation slower without adding explanation. It groups by location, separates contracts that must be understood together, and splits evidence by file instead of behavior.

## Final check

Before writing the guide file, confirm that:

- the section titles alone describe the change in a coherent order;
- each explanation adds intent or relationships that are not obvious from the diff;
- each target is necessary, uses the correct old/new side, and fits within one changed Hunk range;
- section kinds reflect review purpose rather than directory names;
- IDs are stable and target IDs are globally unique; and
- supporting and mechanical material does not interrupt the behavioral narrative.
