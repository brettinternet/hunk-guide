# External command provider protocol

This is the adapter contract for generating a guide inside hunk-guide. For agents that write `.hunk/guide.json` directly, use the [create-hunk-guide skill](../skills/create-hunk-guide/SKILL.md) instead.

## Process model

Set `HUNK_GUIDE_COMMAND` to a plain executable name or a JSON argv array:

```sh
HUNK_GUIDE_COMMAND=hunk-guide-agent hunk diff
HUNK_GUIDE_COMMAND='["node","./examples/providers/minimal-adapter.mjs"]' hunk diff
```

hunk-guide spawns argv directly without a shell. The command is trusted code. It runs from the review directory and inherits Hunk's environment, filesystem, credentials, and network access. Repository configuration cannot select the executable.

The command receives one UTF-8 JSON request on stdin followed by EOF. It must:

- write exactly one UTF-8 JSON response to stdout;
- write diagnostics only to stderr;
- exit zero only after producing a complete response; and
- honor `SIGTERM` by stopping itself and its descendants promptly.

The child environment includes `HUNK_GUIDE_PROTOCOL=1`. Providers should ignore unknown request fields when they support the declared `protocolVersion`.

## Version 1 request

Optional fields are omitted, never `null`.

```json
{
    "protocolVersion": 1,
    "requestId": "opaque-request-id",
    "acceptedGuideVersions": [1],
    "review": {
        "id": "opaque-changeset-id",
        "sourceLabel": "working tree",
        "title": "Review changes",
        "summary": "Optional changeset summary",
        "files": [
            {
                "fileKey": "opaque-file-key",
                "path": "src/provider.ts",
                "previousPath": "src/generator.ts",
                "changeKind": "rename-changed",
                "language": "typescript",
                "stats": {
                    "additions": 42,
                    "deletions": 10,
                    "truncated": false
                },
                "flags": {
                    "untracked": false,
                    "binary": false,
                    "tooLarge": false,
                    "partial": false
                },
                "contentIdentity": "opaque-content-identity",
                "sourceIdentity": "optional-source-identity",
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

### Fields

- `protocolVersion` is `1`.
- `requestId` is opaque and must be copied unchanged into the response.
- `acceptedGuideVersions` lists guide document versions accepted by this request.
- `review.id`, `fileKey`, `contentIdentity`, and `sourceIdentity` are opaque correlation values. Do not parse them.
- `changeKind` is `change`, `rename-pure`, `rename-changed`, `new`, or `deleted`.
- `path` is the new-side repository-relative path. `previousPath` is present for a rename.
- `patch` is the public unified patch. It is empty for unavailable or binary content; inspect `flags` before using it.
- Hunk ranges use 1-based inclusive source coordinates. A side with no source lines is omitted.
- `preferences.density` is `compact`, `balanced`, or `thorough`. It guides generation and is not an output quota.

The request excludes renderer IDs, renderer metadata, filters, cursor state, comments, review progress, agent annotations, and absolute repository paths.

## Version 1 response

Stdout must contain only this envelope, with optional surrounding JSON whitespace:

```json
{
    "protocolVersion": 1,
    "requestId": "opaque-request-id",
    "guide": {
        "version": 1,
        "id": "provider-protocol",
        "title": "External command provider",
        "summary": "Add a provider without coupling the extension to an agent SDK.",
        "sections": [
            {
                "id": "provider-boundary",
                "kind": "change",
                "title": "Keep one process boundary",
                "explanation": "The adapter owns provider-specific behavior and emits a renderer-neutral guide.",
                "targets": [
                    {
                        "id": "provider-runner",
                        "path": "src/provider.ts",
                        "side": "new",
                        "startLine": 8,
                        "endLine": 31,
                        "symbol": "runProvider"
                    }
                ]
            }
        ]
    }
}
```

The envelope is strict. `protocolVersion` and `requestId` must match the request, unknown envelope fields are rejected, and `guide.version` must appear in `acceptedGuideVersions`. The guide must satisfy [`hunk-guide.schema.json`](../hunk-guide.schema.json). Generated targets must include `side` explicitly even though static guide files default it to `new`.

Every target must:

- copy an exact repository-relative path from the request;
- use `previousPath` for the old side of a rename;
- use `old` for deleted-file targets;
- use 1-based inclusive lines; and
- fit wholly within one advertised hunk range on that side.

hunk-guide rejects the complete response if any target is missing, ambiguous, on the wrong side, outside a hunk, or spans hunks. It never clamps, retargets, or drops generated targets.

## Limits and failure behavior

| Resource             |               Limit |
| -------------------- | ------------------: |
| Serialized request   |    16,000,000 bytes |
| Stdout               |     1,000,000 bytes |
| Retained stderr      |        64,000 bytes |
| Default timeout      |         300 seconds |
| Configurable timeout | 10 to 1,800 seconds |

Timeout covers stdin writing and process exit. Continuous output does not reset it. On cancellation, timeout, reload, or shutdown, hunk-guide sends `SIGTERM`, waits two seconds, then sends `SIGKILL` where supported. A failed, cancelled, stale, malformed, or oversized run leaves the previous guide active.

## Minimal adapter

[`examples/providers/minimal-adapter.mjs`](../examples/providers/minimal-adapter.mjs) is a dependency-free transport example:

```sh
HUNK_GUIDE_COMMAND='["node","./examples/providers/minimal-adapter.mjs"]' hunk diff
```

It creates one section per targetable file to demonstrate framing and target addressing. It is not a semantic guide generator. A real adapter may call a coding agent, a local model, a service, or a deterministic analyzer, but the protocol remains the same.
