#!/usr/bin/env node

// Transport example only. This does not produce a semantic review narrative.

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function slug(value, fallback) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  if (request.protocolVersion !== 1 || typeof request.requestId !== "string") {
    throw new Error("unsupported hunk-guide provider request");
  }
  if (!request.acceptedGuideVersions?.includes(1)) {
    throw new Error("guide version 1 is not accepted");
  }

  const sections = [];
  for (const [index, file] of request.review.files.entries()) {
    const hunk = file.hunks.find((candidate) => candidate.newRange || candidate.oldRange);
    if (!hunk) continue;
    const side = file.changeKind === "deleted" || !hunk.newRange ? "old" : "new";
    const range = side === "old" ? hunk.oldRange : hunk.newRange;
    const id = slug(file.path, `file-${index + 1}`);
    sections.push({
      id,
      kind: "change",
      title: `Review ${file.path}`,
      explanation: "Transport example section generated from the first changed hunk in this file.",
      targets: [
        {
          id: `${id}-first-hunk`,
          path: side === "old" ? (file.previousPath ?? file.path) : file.path,
          side,
          startLine: range.startLine,
          endLine: range.endLine,
        },
      ],
    });
  }
  if (sections.length === 0) throw new Error("request contains no targetable text hunks");

  process.stdout.write(
    JSON.stringify({
      protocolVersion: 1,
      requestId: request.requestId,
      guide: {
        version: 1,
        id: `transport-${slug(request.review.id, "review")}`,
        title: "Provider transport example",
        summary: "Demonstrates the external-command request and response framing.",
        sections,
      },
    }),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "provider failed");
}
