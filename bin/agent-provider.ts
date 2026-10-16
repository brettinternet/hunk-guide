#!/usr/bin/env bun
// HUNK_GUIDE_COMMAND adapter that asks a non-interactive coding agent for a guide.
//
//   HUNK_GUIDE_COMMAND='["bun","/path/to/hunk-guide/bin/agent-provider.ts","claude","-p"]'
//
// Arguments after the script are the agent argv. The agent receives a prompt on stdin
// and must print its answer on stdout, like `claude -p`, `codex exec -`, or `pi -p`.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { parseGuide, type GuideDocument } from "../src/model.ts";
import { findTargetErrors, type TargetFile } from "../src/navigation.ts";

const MAX_ATTEMPTS = 2;
const MAX_ECHOED_RESPONSE = 20_000;

interface RequestRange {
  startLine: number;
  endLine: number;
}

interface RequestFile {
  path: string;
  previousPath?: string;
  changeKind: string;
  flags?: { binary?: boolean; tooLarge?: boolean; partial?: boolean };
  patch: string;
  hunks: { oldRange?: RequestRange; newRange?: RequestRange }[];
}

interface Request {
  requestId: string;
  review: { title: string; sourceLabel: string; summary?: string; files: RequestFile[] };
  preferences?: { density?: string };
}

function readRequest(text: string): Request {
  const request = JSON.parse(text);
  if (request?.protocolVersion !== 1 || typeof request.requestId !== "string")
    throw new Error("unsupported hunk-guide provider request");
  if (!request.acceptedGuideVersions?.includes(1))
    throw new Error("guide version 1 is not accepted");
  if (!Array.isArray(request.review?.files)) throw new Error("request has no review files");
  return request;
}

function tuple(range: RequestRange | undefined): [number, number] | undefined {
  return range ? [range.startLine, range.endLine] : undefined;
}

function targetFiles(request: Request): TargetFile[] {
  return request.review.files.map((file) => ({
    path: file.path,
    previousPath: file.previousPath,
    hunks: file.hunks.map((hunk, index) => ({
      index,
      header: "",
      oldRange: tuple(hunk.oldRange),
      newRange: tuple(hunk.newRange),
    })),
  }));
}

/** Prefix each patch line with its old and new line numbers so the agent never counts. */
function numberedPatch(patch: string): string {
  const output: string[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const column = (line: number | undefined) => (line === undefined ? "" : String(line)).padStart(5);
  for (const line of patch.replace(/\n$/, "").split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      inHunk = true;
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      output.push(line);
    } else if (!inHunk || line.startsWith("\\")) {
      continue;
    } else if (line.startsWith("+")) {
      output.push(`${column(undefined)} ${column(newLine++)} │${line}`);
    } else if (line.startsWith("-")) {
      output.push(`${column(oldLine++)} ${column(undefined)} │${line}`);
    } else {
      output.push(`${column(oldLine++)} ${column(newLine++)} │${line}`);
    }
  }
  return output.join("\n");
}

function describeFile(file: RequestFile): string {
  const ranges = file.hunks
    .map((hunk) =>
      [
        hunk.oldRange && `old ${hunk.oldRange.startLine}-${hunk.oldRange.endLine}`,
        hunk.newRange && `new ${hunk.newRange.startLine}-${hunk.newRange.endLine}`,
      ]
        .filter(Boolean)
        .join(" / "),
    )
    .join("; ");
  const notes = [
    file.changeKind,
    file.previousPath && `old-side path ${file.previousPath}`,
    file.flags?.binary && "binary",
    file.flags?.tooLarge && "too large",
    file.flags?.partial && "partial",
  ].filter(Boolean);
  const body = file.patch
    ? numberedPatch(file.patch)
    : "(no text patch; this file has no targetable lines)";
  return `### ${file.path} (${notes.join(", ")})\nHunks: ${ranges || "none"}\n\`\`\`\n${body}\n\`\`\``;
}

function buildPrompt(request: Request): string {
  const skill = readFileSync(
    new URL("../skills/create-hunk-guide/SKILL.md", import.meta.url),
    "utf8",
  ).replace(/^---\n[\s\S]*?\n---\n/, "");
  const { review } = request;
  return `${skill.trim()}

## This run

These instructions replace the skill's file-writing and checking steps:

- Do not create, modify, or delete files, and do not launch Hunk. You may read repository files for context.
- Use ${request.preferences?.density ?? "balanced"} density.
- Respond with exactly one JSON guide document and nothing else: no prose and no Markdown fences.
- Copy each target path exactly from a file heading below (use the old-side path for old-side targets of a rename).
- Set \`side\` on every target. Take line numbers from the matching column of the numbered patch: the left column is old-side, the right column is new-side. Each target range must stay inside one listed hunk.
- The caller validates every target and rejects the whole guide if one is wrong.

## Changeset: ${review.title} (${review.sourceLabel})
${review.summary ? `\n${review.summary}\n` : ""}
${review.files.map(describeFile).join("\n\n")}
`;
}

function runAgent(argv: string[], prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`agent ${argv[0]} exited with ${code ?? signal}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/g)].at(-1)?.[1];
  const candidate = trimmed.startsWith("{")
    ? trimmed
    : (fenced ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1));
  return JSON.parse(candidate);
}

function validate(
  output: string,
  files: TargetFile[],
): { guide?: GuideDocument; errors: string[] } {
  let guide: GuideDocument;
  try {
    guide = parseGuide(extractJson(output));
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)] };
  }
  const errors = findTargetErrors(guide, files).map(
    (error) => `${error.field} (${error.targetId}): ${error.message}`,
  );
  return errors.length ? { errors } : { guide, errors };
}

function repairPrompt(prompt: string, output: string, errors: string[]): string {
  return `${prompt}
## Correction

Your previous response was rejected:

${errors.map((error) => `- ${error}`).join("\n")}

Previous response:

${output.slice(0, MAX_ECHOED_RESPONSE)}

Return the complete corrected guide JSON document and nothing else.
`;
}

async function main() {
  const agent = process.argv.slice(2);
  if (agent.length === 0) throw new Error("usage: agent-provider.ts <agent command> [args...]");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = readRequest(input);
  const files = targetFiles(request);
  const prompt = buildPrompt(request);

  let next = prompt;
  let errors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const output = await runAgent(agent, next);
    const result = validate(output, files);
    if (result.guide) {
      process.stdout.write(
        JSON.stringify({ protocolVersion: 1, requestId: request.requestId, guide: result.guide }),
      );
      return;
    }
    errors = result.errors;
    process.stderr.write(`attempt ${attempt} rejected:\n${errors.join("\n")}\n`);
    next = repairPrompt(prompt, output, errors);
  }
  throw new Error(`agent did not produce a valid guide after ${MAX_ATTEMPTS} attempts`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
