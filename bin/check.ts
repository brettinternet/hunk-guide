#!/usr/bin/env bun
// Check that every guide target resolves against the changeset Hunk will review.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { loadGuideFile } from "../src/generators/file.ts";
import { findTargetErrors, type TargetFile } from "../src/navigation.ts";
import { parsePatch, type PatchFile } from "../src/patch.ts";

const USAGE = `Usage:
  check.ts [--guide <file>] [--staged] [<target> | <from> <to>]
  check.ts [--guide <file>] --patch <file | ->

Checks a guide (default .hunk/guide.json) against the same changes as
\`hunk diff [--staged] [<target> | <from> <to>]\` or \`hunk patch <file>\`.`;

// Match Hunk's Git diff normalization so hunk ranges and paths agree.
const GIT_DIFF = [
  "-c",
  "core.quotePath=true",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.srcPrefix=a/",
  "-c",
  "diff.dstPrefix=b/",
  "-c",
  "diff.relative=false",
  "diff",
  "--no-ext-diff",
  "--find-renames",
  "--no-color",
];

interface Options {
  guide: string;
  patch?: string;
  staged: boolean;
  revisions: string[];
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Options {
  const options: Options = { guide: ".hunk/guide.json", staged: false, revisions: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new UsageError(`${arg} requires a value`);
      return next;
    };
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--guide") options.guide = value();
    else if (arg === "--patch") options.patch = value();
    else if (arg === "--staged" || arg === "--cached") options.staged = true;
    else if (arg.startsWith("-")) throw new UsageError(`unknown option ${arg}`);
    else options.revisions.push(arg);
  }
  if (options.revisions.length > 2) throw new UsageError("expected at most two revisions");
  if (options.patch && (options.staged || options.revisions.length))
    throw new UsageError("--patch cannot be combined with revisions or --staged");
  return options;
}

function git(args: string[], cwd: string, okCodes = [0]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (!okCodes.includes(result.status ?? -1))
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

/** Hunk adds untracked files only when comparing the working tree with at most one revision. */
function includesUntracked(options: Options, root: string): boolean {
  if (options.staged || options.revisions.length > 1) return false;
  const [revision] = options.revisions;
  if (!revision) return true;
  const revs = git(["rev-parse", "--revs-only", revision], root).split("\n").filter(Boolean);
  return revs.length === 1 && !revs[0]!.startsWith("^");
}

// Hunk's limits for showing a file's hunks, from its large-file and binary checks.
const LARGE_FILE_BYTES = 1_000_000;
const LARGE_FILE_LINES = 20_000;
const LINE_SNIFF_BYTES = 256 * 1024;
const BINARY_SNIFF_BYTES = 8_000;

function readPrefix(path: string, bytes: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    return buffer.subarray(0, readSync(fd, buffer, 0, bytes, 0));
  } finally {
    closeSync(fd);
  }
}

function countLines(content: Buffer): number {
  const newlines = content.reduce((count, byte) => count + (byte === 10 ? 1 : 0), 0);
  return content.length && content.at(-1) !== 10 ? newlines + 1 : newlines;
}

function isProbablyBinary(prefix: Buffer): boolean {
  if (prefix.includes(0)) return true;
  const control = prefix.filter((byte) => byte < 7 || (byte > 13 && byte < 32) || byte === 127);
  return prefix.length > 0 && control.length / prefix.length >= 0.3;
}

function addedFile(path: string, lines: number): TargetFile {
  const hunk = {
    index: 0,
    header: `@@ -0,0 +1,${lines} @@`,
    newRange: [1, lines] as [number, number],
  };
  return { path, hunks: lines ? [hunk] : [] };
}

/** Mirror how Hunk shows an untracked path; `undefined` when it is not shown. */
function untrackedFile(root: string, path: string): TargetFile | undefined {
  const absolute = join(root, path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    return { path, hunks: [] };
  }
  if (stat.isDirectory()) return undefined;
  if (stat.isSymbolicLink()) {
    try {
      if (statSync(absolute).isDirectory()) return undefined;
    } catch {
      /* a dangling link is still shown */
    }
    return addedFile(path, 1); // Hunk shows the link target as one added line.
  }
  if (stat.size > LARGE_FILE_BYTES) return { path, hunks: [] };
  if (countLines(readPrefix(absolute, LINE_SNIFF_BYTES)) > LARGE_FILE_LINES)
    return { path, hunks: [] };
  if (isProbablyBinary(readPrefix(absolute, BINARY_SNIFF_BYTES))) return { path, hunks: [] };
  return addedFile(path, countLines(readFileSync(absolute)));
}

/** Hunk drops the hunks of tracked files over its limits, measured on the working tree. */
function isLargeTrackedFile(root: string, file: PatchFile): boolean {
  if (file.changedLines > LARGE_FILE_LINES) return true;
  try {
    return statSync(join(root, file.path)).size > LARGE_FILE_BYTES;
  } catch {
    return false;
  }
}

function gitChanges(options: Options): { files: TargetFile[]; label: string } {
  if (options.revisions.some((revision) => !revision))
    throw new UsageError("revisions must not be empty");
  const root = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
  const [from, to] = options.revisions;
  const range = to === undefined ? from : `${from}..${to}`;
  const args = [...GIT_DIFF, ...(options.staged ? ["--staged"] : []), ...(range ? [range] : [])];
  const files: TargetFile[] = parsePatch(git(args, root)).map((file) =>
    isLargeTrackedFile(root, file) ? { ...file, hunks: [] } : file,
  );
  if (includesUntracked(options, root)) {
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
    for (const path of untracked.split("\0").filter(Boolean)) {
      const file = untrackedFile(root, path);
      if (file) files.push(file);
    }
  }
  const label = ["hunk diff", ...(options.staged ? ["--staged"] : []), ...options.revisions];
  return { files, label: label.join(" ") };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guidePath = resolve(options.guide);
  if (!existsSync(guidePath)) throw new Error(`no guide at ${options.guide}`);
  const guide = await loadGuideFile({ path: guidePath, origin: "environment" });
  const { files, label } = options.patch
    ? {
        files: parsePatch(readFileSync(options.patch === "-" ? 0 : options.patch, "utf8")),
        label: `hunk patch ${options.patch}`,
      }
    : gitChanges(options);

  const errors = findTargetErrors(guide, files);
  for (const error of errors) console.log(`✗ ${error.field} (${error.targetId}): ${error.message}`);
  const total = guide.sections.reduce((count, section) => count + section.targets.length, 0);
  const guided = new Set(guide.sections.flatMap((section) => section.targets.map((t) => t.path)));
  const outside = files.filter(
    (file) => !guided.has(file.path) && !guided.has(file.previousPath ?? file.path),
  );
  if (outside.length) console.log(`Outside the guide: ${outside.map((f) => f.path).join(", ")}`);
  console.log(
    `${errors.length ? "✗" : "✓"} ${total - errors.length}/${total} targets resolve against \`${label}\` (${files.length} changed ${files.length === 1 ? "file" : "files"}).`,
  );
  process.exitCode = errors.length ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof UsageError) console.error(USAGE);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
