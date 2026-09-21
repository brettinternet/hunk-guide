import { expect, test } from "bun:test";

import {
  buildGenerationRequest,
  parseCommandSpec,
  parseGenerationResponse,
  requestUsesRuntimeIds,
  runExternalCommand,
  serializeRequest,
} from "../src/generators/command.ts";
import { generateGuide, validateGeneratedGuide } from "../src/generators/external.ts";
import { file, changeset } from "./helpers.ts";

const validGuide = {
  version: 1,
  id: "generated",
  sections: [
    {
      id: "one",
      title: "One",
      targets: [{ id: "target", path: "src/main.ts", side: "new", startLine: 5 }],
    },
  ],
};

function reviewSnapshot() {
  return {
    generation: "generation-1",
    stateRevision: 1,
    files: [
      {
        fileKey: "src/main.ts",
        runtimeId: "runtime-only",
        path: "src/main.ts",
        changeKind: "change" as const,
        stats: { additions: 1, deletions: 0, truncated: false },
        flags: { untracked: false, binary: false, tooLarge: false, partial: false },
        contentIdentity: "content-1",
      },
    ],
    notes: [],
  };
}

function responseScript(guide = validGuide) {
  return `let input=''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => { const request=JSON.parse(input); process.stdout.write(JSON.stringify({ protocolVersion: 1, requestId: request.requestId, guide: ${JSON.stringify(guide)} })); });`;
}

test("command syntax is executable-only or JSON argv, never shell text", () => {
  expect(parseCommandSpec("guide-generator")).toEqual({ argv: ["guide-generator"] });
  expect(parseCommandSpec('["node", "--safe"]')).toEqual({ argv: ["node", "--safe"] });
  expect(() => parseCommandSpec("guide-generator --unsafe")).toThrow();
  expect(() => parseCommandSpec('["node"')).toThrow();
});

test("request envelope matches the authoritative snapshot and omits runtime ids", () => {
  const request = buildGenerationRequest(
    changeset([file("src/main.ts")]),
    reviewSnapshot(),
    "balanced",
    "request-1",
  );
  expect(request).toMatchObject({
    protocolVersion: 1,
    requestId: "request-1",
    acceptedGuideVersions: [1],
  });
  expect(request.review.files[0]).toMatchObject({
    fileKey: "src/main.ts",
    changeKind: "change",
    stats: { additions: 1, deletions: 0, truncated: false },
    flags: { binary: false },
    contentIdentity: "content-1",
  });
  expect(request.review.files[0]).not.toHaveProperty("runtimeId");
  expect(requestUsesRuntimeIds(request)).toBeFalse();
});

test("request rejects an exact changeset/snapshot mismatch", () => {
  expect(() =>
    buildGenerationRequest(changeset([file("src/other.ts")]), reviewSnapshot(), "balanced"),
  ).toThrow(/snapshot does not match/);
  expect(() =>
    buildGenerationRequest(
      changeset([{ ...file("src/main.ts"), stats: { additions: 2, deletions: 0 } }]),
      reviewSnapshot(),
      "balanced",
    ),
  ).toThrow(/metadata does not match/);
});

test("response envelope validates protocol version and request id strictly", () => {
  expect(
    parseGenerationResponse(
      { protocolVersion: 1, requestId: "request-1", guide: validGuide },
      "request-1",
    ).id,
  ).toBe("generated");
  expect(() =>
    parseGenerationResponse(
      { protocolVersion: 1, requestId: "wrong", guide: validGuide },
      "request-1",
    ),
  ).toThrow(/requestId/);
  expect(() =>
    parseGenerationResponse(
      { protocolVersion: 1, requestId: "request-1", guide: validGuide, extra: true },
      "request-1",
    ),
  ).toThrow();
  expect(() =>
    parseGenerationResponse(
      { protocolVersion: 1, requestId: "request-1", guide: { ...validGuide, version: 2 } },
      "request-1",
    ),
  ).toThrow();
  expect(() =>
    parseGenerationResponse(
      {
        protocolVersion: 1,
        requestId: "request-1",
        guide: {
          ...validGuide,
          sections: [
            {
              ...validGuide.sections[0],
              targets: [{ ...validGuide.sections[0]!.targets[0]!, side: undefined }],
            },
          ],
        },
      },
      "request-1",
    ),
  ).toThrow(/side/);
  expect(() =>
    parseGenerationResponse(
      {
        protocolVersion: 1,
        requestId: "request-1",
        guide: {
          ...validGuide,
          sections: [
            {
              ...validGuide.sections[0],
              targets: [{ ...validGuide.sections[0]!.targets[0]!, path: "../main.ts" }],
            },
          ],
        },
      },
      "request-1",
    ),
  ).toThrow(/path/);
});

test("runner handles valid output, noisy stderr, and protocol environment", async () => {
  const script = `${responseScript()} process.stderr.write('✓ '.repeat(40000));`;
  const result = await runExternalCommand({
    spec: { argv: [process.execPath, "-e", script] },
    cwd: process.cwd(),
    request: buildGenerationRequest(changeset([file("src/main.ts")]), reviewSnapshot(), "balanced"),
    timeoutSeconds: 10,
  });
  expect(result.id).toBe("generated");
});

test("runner reports an executable that cannot be spawned", async () => {
  await expect(
    runExternalCommand({
      spec: { argv: ["hunk-guide-command-that-does-not-exist"] },
      cwd: process.cwd(),
      request: buildGenerationRequest(
        changeset([file("src/main.ts")]),
        reviewSnapshot(),
        "balanced",
      ),
      timeoutSeconds: 10,
    }),
  ).rejects.toMatchObject({ category: "spawn-failed" });
});

test("runner rejects oversized input/stdout and invalid UTF-8", async () => {
  const hugeFile = file("src/main.ts", { patch: "x".repeat(16_000_100) });
  expect(() =>
    serializeRequest(buildGenerationRequest(changeset([hugeFile]), reviewSnapshot(), "balanced")),
  ).toThrow(/16000000/);
  await expect(
    runExternalCommand({
      spec: {
        argv: [process.execPath, "-e", "process.stdout.write(Buffer.alloc(1000001, 255))"],
      },
      cwd: process.cwd(),
      request: buildGenerationRequest(
        changeset([file("src/main.ts")]),
        reviewSnapshot(),
        "balanced",
      ),
      timeoutSeconds: 10,
    }),
  ).rejects.toMatchObject({ category: "output-too-large" });
  await expect(
    runExternalCommand({
      spec: { argv: [process.execPath, "-e", "process.stdout.write(Buffer.from([255]))"] },
      cwd: process.cwd(),
      request: buildGenerationRequest(
        changeset([file("src/main.ts")]),
        reviewSnapshot(),
        "balanced",
      ),
      timeoutSeconds: 10,
    }),
  ).rejects.toMatchObject({ category: "invalid-response" });
});

test("runner terminates a command on timeout and cancellation", async () => {
  const hangingScript = "process.stdin.resume(); setTimeout(() => {}, 5000);";
  await expect(
    runExternalCommand({
      spec: { argv: [process.execPath, "-e", hangingScript] },
      cwd: process.cwd(),
      request: buildGenerationRequest(
        changeset([file("src/main.ts")]),
        reviewSnapshot(),
        "balanced",
      ),
      timeoutSeconds: 10,
      signal: AbortSignal.timeout(20),
    }),
  ).rejects.toMatchObject({ category: "cancelled" });
  await expect(
    runExternalCommand({
      spec: { argv: [process.execPath, "-e", hangingScript] },
      cwd: process.cwd(),
      request: buildGenerationRequest(
        changeset([file("src/main.ts")]),
        reviewSnapshot(),
        "balanced",
      ),
      timeoutSeconds: 0.01,
    }),
  ).rejects.toMatchObject({ category: "timed-out" });
});

test("target validation reports wrong-side and cross-hunk fields", () => {
  const renamed = changeset([file("src/main.ts", { previousPath: "src/old.ts" })]);
  const wrongSide = parseGenerationResponse(
    {
      protocolVersion: 1,
      requestId: "x",
      guide: {
        ...validGuide,
        sections: [
          {
            ...validGuide.sections[0],
            targets: [{ id: "target", path: "src/old.ts", side: "new", startLine: 1 }],
          },
        ],
      },
    },
    "x",
  );
  expect(() => validateGeneratedGuide(wrongSide, renamed, renamed)).toThrow(/targets\[0\].path/);
  const base = file("src/main.ts", { newRange: [1, 5] });
  const twoHunks = {
    ...base,
    hunks: [
      {
        index: 0,
        header: "@@",
        oldRange: [1, 5] as [number, number],
        newRange: [1, 5] as [number, number],
      },
      {
        index: 1,
        header: "@@",
        oldRange: [10, 15] as [number, number],
        newRange: [10, 15] as [number, number],
      },
    ],
  };
  const split = changeset([twoHunks]);
  const cross = parseGenerationResponse(
    {
      protocolVersion: 1,
      requestId: "x",
      guide: {
        ...validGuide,
        sections: [
          {
            ...validGuide.sections[0],
            targets: [
              { id: "target", path: "src/main.ts", side: "new", startLine: 3, endLine: 12 },
            ],
          },
        ],
      },
    },
    "x",
  );
  expect(() => validateGeneratedGuide(cross, split, split)).toThrow(/startLine/);
});

test("generateGuide returns the request used for the command", async () => {
  const result = await generateGuide(
    { changeset: changeset([file("src/main.ts")]), review: reviewSnapshot(), density: "compact" },
    {
      command: { argv: [process.execPath, "-e", responseScript()] },
      cwd: process.cwd(),
      timeoutSeconds: 10,
    },
  );
  expect(result.request.preferences.density).toBe("compact");
});
