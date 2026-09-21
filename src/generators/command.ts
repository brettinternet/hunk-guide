import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  ExtensionChangeset,
  ExtensionDiffFile,
  ExtensionReviewSnapshot,
} from "hunkdiff/extension";

import { parseGuide, type GuideDocument } from "../model.ts";

export const COMMAND_PROTOCOL_VERSION = 1 as const;
export const ACCEPTED_GUIDE_VERSIONS = [1] as const;
export const DEFAULT_PROVIDER_TIMEOUT_SECONDS = 300;
export const MIN_PROVIDER_TIMEOUT_SECONDS = 10;
export const MAX_PROVIDER_TIMEOUT_SECONDS = 1_800;
export const MAX_REQUEST_BYTES = 16_000_000;
export const MAX_STDOUT_BYTES = 1_000_000;
export const MAX_STDERR_BYTES = 64_000;
const TERMINATION_GRACE_MS = 2_000;

type GuideVersion = (typeof ACCEPTED_GUIDE_VERSIONS)[number];
export type ProviderFailureCategory =
  | "snapshot-mismatch"
  | "request-too-large"
  | "spawn-failed"
  | "timed-out"
  | "cancelled"
  | "output-too-large"
  | "provider-failed"
  | "invalid-response"
  | "changeset-changed";

export class ProviderFailure extends Error {
  readonly category: ProviderFailureCategory;
  readonly detail?: string;

  constructor(category: ProviderFailureCategory, message: string, detail?: string) {
    super(message);
    this.name = "ProviderFailure";
    this.category = category;
    this.detail = detail;
  }
}

export class CommandProtocolError extends ProviderFailure {
  constructor(message: string) {
    super("invalid-response", message);
    this.name = "CommandProtocolError";
  }
}

export class CommandExecutionError extends ProviderFailure {
  constructor(
    category: Exclude<
      ProviderFailureCategory,
      "snapshot-mismatch" | "request-too-large" | "invalid-response"
    >,
    message: string,
    detail?: string,
  ) {
    super(category, message, detail);
    this.name = "CommandExecutionError";
  }
}

export interface CommandSpec {
  argv: readonly [string, ...string[]];
}

export interface GuideGenerationRequest {
  protocolVersion: typeof COMMAND_PROTOCOL_VERSION;
  requestId: string;
  acceptedGuideVersions: readonly GuideVersion[];
  review: {
    id: string;
    sourceLabel: string;
    title: string;
    summary?: string;
    files: readonly RequestFile[];
  };
  preferences: { density: "compact" | "balanced" | "thorough" };
}

export interface RequestFile {
  fileKey: string;
  path: string;
  previousPath?: string;
  changeKind: string;
  language?: string;
  stats: { additions: number; deletions: number; truncated: boolean };
  flags: { untracked: boolean; binary: boolean; tooLarge: boolean; partial: boolean };
  contentIdentity: string;
  sourceIdentity?: string;
  patch: string;
  hunks: readonly {
    oldRange?: { startLine: number; endLine: number };
    newRange?: { startLine: number; endLine: number };
  }[];
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CommandProtocolError(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function assertKeys(value: Record<string, unknown>, path: string, allowed: readonly string[]) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new CommandProtocolError(`${path}.${unknown}: unknown field`);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CommandProtocolError(`${path}: expected a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") throw new CommandProtocolError(`${path}: expected a string`);
  return value;
}

function optional<T extends object>(entries: T): T {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as T;
}

function parseCommandJson(value: unknown): CommandSpec {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProviderFailure(
      "spawn-failed",
      "HUNK_GUIDE_COMMAND JSON must be a non-empty argv array",
    );
  }
  const argv = value.map((entry, index) => requiredString(entry, `HUNK_GUIDE_COMMAND[${index}]`));
  return { argv: argv as [string, ...string[]] };
}

export function parseCommandSpec(value: string | undefined): CommandSpec | null {
  if (value === undefined || !value.trim()) return null;
  const text = value.trim();
  if (text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ProviderFailure("spawn-failed", "HUNK_GUIDE_COMMAND contains invalid JSON argv");
    }
    return parseCommandJson(parsed);
  }
  if (/\s/.test(text)) {
    throw new ProviderFailure(
      "spawn-failed",
      "HUNK_GUIDE_COMMAND must be one executable path or a JSON argv array; shell arguments are not supported",
    );
  }
  return { argv: [text] };
}

function publicRange(range: readonly [number, number] | undefined) {
  return range ? { startLine: range[0], endLine: range[1] } : undefined;
}

function publicHunks(file: ExtensionDiffFile) {
  return (file.hunks ?? []).map((hunk) =>
    optional({ oldRange: publicRange(hunk.oldRange), newRange: publicRange(hunk.newRange) }),
  );
}

function fileMatchKey(path: string, previousPath: string | undefined) {
  return `${previousPath ?? ""}\u0000${path}`;
}

function snapshotFileMap(
  changeset: ExtensionChangeset,
  review: ExtensionReviewSnapshot,
): Map<string, ExtensionReviewSnapshot["files"][number]> {
  if (review.files.length !== changeset.files.length) {
    throw new ProviderFailure(
      "snapshot-mismatch",
      "changeset and command snapshot contain different files",
    );
  }
  const result = new Map<string, ExtensionReviewSnapshot["files"][number]>();
  for (const file of review.files) {
    const key = fileMatchKey(file.path, file.previousPath);
    if (result.has(key))
      throw new ProviderFailure("snapshot-mismatch", `duplicate snapshot file ${file.path}`);
    result.set(key, file);
  }
  const changesetKeys = new Set<string>();
  for (const file of changeset.files) {
    const key = fileMatchKey(file.path, file.previousPath);
    if (changesetKeys.has(key))
      throw new ProviderFailure("snapshot-mismatch", `duplicate changeset file ${file.path}`);
    changesetKeys.add(key);
    const snapshot = result.get(key);
    if (!snapshot)
      throw new ProviderFailure("snapshot-mismatch", `snapshot does not match ${file.path}`);
    const changeKind = file.changeType ?? "change";
    const flagsMatch =
      Boolean(file.isUntracked) === snapshot.flags.untracked &&
      Boolean(file.isBinary) === snapshot.flags.binary &&
      Boolean(file.isTooLarge) === snapshot.flags.tooLarge;
    const statsMatch =
      file.stats.additions === snapshot.stats.additions &&
      file.stats.deletions === snapshot.stats.deletions &&
      Boolean(file.statsTruncated) === snapshot.stats.truncated;
    if (changeKind !== snapshot.changeKind || !flagsMatch || !statsMatch) {
      throw new ProviderFailure(
        "snapshot-mismatch",
        `snapshot metadata does not match ${file.path}`,
      );
    }
  }
  return result;
}

/** Map public Hunk data to the renderer-neutral request, omitting undefined optionals. */
export function buildGenerationRequest(
  changeset: ExtensionChangeset,
  review: ExtensionReviewSnapshot,
  density: "compact" | "balanced" | "thorough",
  requestId: string = randomUUID(),
): GuideGenerationRequest {
  const snapshots = snapshotFileMap(changeset, review);
  return {
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    requestId,
    acceptedGuideVersions: ACCEPTED_GUIDE_VERSIONS,
    review: {
      id: changeset.id,
      sourceLabel: changeset.sourceLabel,
      title: changeset.title,
      ...optional({ summary: changeset.summary }),
      files: changeset.files.map((file) => {
        const snapshot = snapshots.get(fileMatchKey(file.path, file.previousPath))!;
        const flags = snapshot.flags;
        return optional({
          fileKey: snapshot.fileKey,
          path: file.path,
          previousPath: file.previousPath,
          changeKind: file.changeType ?? snapshot.changeKind,
          language: file.language,
          stats: {
            additions: snapshot.stats.additions,
            deletions: snapshot.stats.deletions,
            truncated: snapshot.stats.truncated,
          },
          flags,
          contentIdentity: snapshot.contentIdentity,
          sourceIdentity: snapshot.sourceIdentity,
          patch: flags.binary || flags.tooLarge ? "" : file.patch,
          hunks: publicHunks(file),
        }) as RequestFile;
      }),
    },
    preferences: { density },
  };
}

export function serializeRequest(request: GuideGenerationRequest): string {
  const text = JSON.stringify(request);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_REQUEST_BYTES) {
    throw new ProviderFailure(
      "request-too-large",
      `serialized request exceeds ${MAX_REQUEST_BYTES} bytes`,
    );
  }
  return text;
}

function validateRequest(value: unknown): GuideGenerationRequest {
  const request = objectAt(value, "request");
  assertKeys(request, "request", [
    "protocolVersion",
    "requestId",
    "acceptedGuideVersions",
    "review",
    "preferences",
  ]);
  if (request.protocolVersion !== COMMAND_PROTOCOL_VERSION)
    throw new CommandProtocolError("request.protocolVersion: unsupported protocol version");
  requiredString(request.requestId, "request.requestId");
  if (
    !Array.isArray(request.acceptedGuideVersions) ||
    request.acceptedGuideVersions.length === 0 ||
    request.acceptedGuideVersions.some((version) => version !== 1)
  )
    throw new CommandProtocolError("request.acceptedGuideVersions: invalid versions");
  const review = objectAt(request.review, "request.review");
  assertKeys(review, "request.review", ["id", "sourceLabel", "title", "summary", "files"]);
  requiredString(review.id, "request.review.id");
  requiredString(review.sourceLabel, "request.review.sourceLabel");
  requiredString(review.title, "request.review.title");
  optionalString(review.summary, "request.review.summary");
  if (!Array.isArray(review.files) || review.files.length === 0)
    throw new CommandProtocolError("request.review.files: expected a non-empty array");
  review.files.forEach((value, index) => {
    const file = objectAt(value, `request.review.files[${index}]`);
    assertKeys(file, `request.review.files[${index}]`, [
      "fileKey",
      "path",
      "previousPath",
      "changeKind",
      "language",
      "stats",
      "flags",
      "contentIdentity",
      "sourceIdentity",
      "patch",
      "hunks",
    ]);
    requiredString(file.fileKey, `request.review.files[${index}].fileKey`);
    requiredString(file.path, `request.review.files[${index}].path`);
    optionalString(file.previousPath, `request.review.files[${index}].previousPath`);
    requiredString(file.changeKind, `request.review.files[${index}].changeKind`);
    optionalString(file.language, `request.review.files[${index}].language`);
    requiredString(file.contentIdentity, `request.review.files[${index}].contentIdentity`);
    optionalString(file.sourceIdentity, `request.review.files[${index}].sourceIdentity`);
    stringValue(file.patch, `request.review.files[${index}].patch`);
    const stats = objectAt(file.stats, `request.review.files[${index}].stats`);
    assertKeys(stats, `request.review.files[${index}].stats`, [
      "additions",
      "deletions",
      "truncated",
    ]);
    if (
      !Number.isSafeInteger(stats.additions) ||
      !Number.isSafeInteger(stats.deletions) ||
      typeof stats.truncated !== "boolean"
    )
      throw new CommandProtocolError(`request.review.files[${index}].stats: invalid fields`);
    const flags = objectAt(file.flags, `request.review.files[${index}].flags`);
    assertKeys(flags, `request.review.files[${index}].flags`, [
      "untracked",
      "binary",
      "tooLarge",
      "partial",
    ]);
    if (
      ["untracked", "binary", "tooLarge", "partial"].some((key) => typeof flags[key] !== "boolean")
    )
      throw new CommandProtocolError(`request.review.files[${index}].flags: invalid fields`);
    if (!Array.isArray(file.hunks))
      throw new CommandProtocolError(`request.review.files[${index}].hunks: expected an array`);
    file.hunks.forEach((hunk, hunkIndex) => {
      const parsed = objectAt(hunk, `request.review.files[${index}].hunks[${hunkIndex}]`);
      assertKeys(parsed, `request.review.files[${index}].hunks[${hunkIndex}]`, [
        "oldRange",
        "newRange",
      ]);
      for (const rangeName of ["oldRange", "newRange"] as const) {
        const range = parsed[rangeName];
        if (range !== undefined) {
          const rangeObject = objectAt(
            range,
            `request.review.files[${index}].hunks[${hunkIndex}].${rangeName}`,
          );
          assertKeys(
            rangeObject,
            `request.review.files[${index}].hunks[${hunkIndex}].${rangeName}`,
            ["startLine", "endLine"],
          );
          if (
            !Number.isSafeInteger(rangeObject.startLine) ||
            !Number.isSafeInteger(rangeObject.endLine)
          )
            throw new CommandProtocolError(
              `request.review.files[${index}].hunks[${hunkIndex}].${rangeName}: invalid range`,
            );
        }
      }
    });
  });
  const preferences = objectAt(request.preferences, "request.preferences");
  assertKeys(preferences, "request.preferences", ["density"]);
  if (!["compact", "balanced", "thorough"].includes(preferences.density as string))
    throw new CommandProtocolError("request.preferences.density: invalid density");
  return request as unknown as GuideGenerationRequest;
}

export function parseGenerationRequest(value: unknown): GuideGenerationRequest {
  return validateRequest(value);
}

function validateGeneratedTargetFields(rawGuide: unknown) {
  const guide = objectAt(rawGuide, "response.guide");
  const sections = guide.sections;
  if (!Array.isArray(sections)) return;
  sections.forEach((rawSection, sectionIndex) => {
    const section = objectAt(rawSection, `response.guide.sections[${sectionIndex}]`);
    if (!Array.isArray(section.targets)) return;
    section.targets.forEach((rawTarget, targetIndex) => {
      const path = `response.guide.sections[${sectionIndex}].targets[${targetIndex}]`;
      const target = objectAt(rawTarget, path);
      if (!Object.hasOwn(target, "side"))
        throw new CommandProtocolError(
          `${path}.side: generated targets must specify side explicitly`,
        );
      if (target.side !== "old" && target.side !== "new")
        throw new CommandProtocolError(`${path}.side: expected old or new`);
      if (typeof target.path !== "string" || !target.path || target.path !== target.path.trim())
        throw new CommandProtocolError(`${path}.path: expected a non-empty relative path`);
      if (
        target.path.includes("\\") ||
        target.path.includes("\0") ||
        target.path.startsWith("/") ||
        /^[A-Za-z]:/.test(target.path)
      )
        throw new CommandProtocolError(
          `${path}.path: must be normalized relative slash-separated path`,
        );
      const segments = target.path.split("/");
      if (segments.some((segment) => !segment || segment === "." || segment === ".."))
        throw new CommandProtocolError(`${path}.path: must not contain dot or empty path segments`);
    });
  });
}

/** Strictly parse the response envelope and the guide document it contains. */
export function parseGenerationResponse(
  value: unknown,
  expectedRequestId?: string,
  acceptedGuideVersions: readonly number[] = ACCEPTED_GUIDE_VERSIONS,
): GuideDocument {
  const response = objectAt(value, "response");
  assertKeys(response, "response", ["protocolVersion", "requestId", "guide"]);
  if (response.protocolVersion !== COMMAND_PROTOCOL_VERSION)
    throw new CommandProtocolError("response.protocolVersion: unsupported protocol version");
  const requestId = requiredString(response.requestId, "response.requestId");
  if (expectedRequestId !== undefined && requestId !== expectedRequestId)
    throw new CommandProtocolError("response.requestId: does not match request");
  validateGeneratedTargetFields(response.guide);
  const guide = parseGuide(response.guide);
  if (!acceptedGuideVersions.includes(guide.version))
    throw new CommandProtocolError("response.guide.version: not accepted by request");
  return guide;
}

interface ChildResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

async function readStream(
  stream: AsyncIterable<Uint8Array | string>,
  limit: number,
  hard: boolean,
  onOverflow?: () => void,
): Promise<{ text: string; overflow: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (hard && size > limit) {
      if (!overflow) onOverflow?.();
      overflow = true;
    }
    if (!hard) {
      chunks.push(buffer);
      while (Buffer.byteLength(Buffer.concat(chunks)) > limit) chunks.shift();
    } else if (!overflow) chunks.push(buffer);
  }
  if (hard && overflow) return { text: "", overflow: true };
  const bytes = Buffer.concat(chunks);
  try {
    return { text: new TextDecoder("utf-8", { fatal: hard }).decode(bytes), overflow };
  } catch {
    throw new CommandProtocolError("provider output is not valid UTF-8");
  }
}

function stopProcess(child: ChildProcess, forceAfterMs = TERMINATION_GRACE_MS) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  try {
    if (process.platform !== "win32" && child.spawnargs && pid) process.kill(-pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }
  const forceTimer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform !== "win32" && child.spawnargs && pid) process.kill(-pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      /* process already exited or unsupported signal */
    }
  }, forceAfterMs);
  forceTimer.unref?.();
}

export interface CommandRunOptions {
  spec: CommandSpec;
  cwd: string;
  request: GuideGenerationRequest;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  spawnProcess?: typeof spawn;
}

async function execute(options: CommandRunOptions): Promise<ChildResult> {
  const requestText = serializeRequest(options.request);
  const timeoutMs = Math.max(
    1,
    Math.floor((options.timeoutSeconds ?? DEFAULT_PROVIDER_TIMEOUT_SECONDS) * 1000),
  );
  const spawnProcess = options.spawnProcess ?? spawn;
  const [executable, ...args] = options.spec.argv;
  let child: ChildProcess;
  try {
    child = spawnProcess(executable, args, {
      cwd: options.cwd,
      env: { ...process.env, HUNK_GUIDE_PROTOCOL: "1" },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new CommandExecutionError(
      "spawn-failed",
      `could not start guide command: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let timedOut = false;
  let cancelled = false;
  const processErrors: { spawn?: Error; stdin?: Error } = {};
  child.once("error", (error) => {
    processErrors.spawn = error;
  });
  child.stdin?.once("error", (error) => {
    processErrors.stdin = error;
  });
  const abort = () => {
    cancelled = true;
    stopProcess(child);
  };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    stopProcess(child);
  }, timeoutMs);
  timeout.unref?.();
  try {
    child.stdin?.end(requestText);
    const stdoutPromise = readStream(
      child.stdout as AsyncIterable<Uint8Array | string>,
      MAX_STDOUT_BYTES,
      true,
      () => stopProcess(child),
    );
    const stderrPromise = readStream(
      child.stderr as AsyncIterable<Uint8Array | string>,
      MAX_STDERR_BYTES,
      false,
    );
    const close = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once("close", (code, signal) => resolve({ code, signal })),
    );
    const [stdout, stderr, result] = await Promise.all([stdoutPromise, stderrPromise, close]);
    if (cancelled) throw new CommandExecutionError("cancelled", "guide generation cancelled");
    if (timedOut)
      throw new CommandExecutionError(
        "timed-out",
        `guide command timed out after ${timeoutMs / 1000} seconds`,
      );
    if (stdout.overflow)
      throw new CommandExecutionError(
        "output-too-large",
        `provider stdout exceeds ${MAX_STDOUT_BYTES} bytes`,
      );
    if (processErrors.spawn)
      throw new CommandExecutionError(
        "spawn-failed",
        `could not start guide command: ${processErrors.spawn.message}`,
      );
    if (result.code !== 0)
      throw new CommandExecutionError(
        "provider-failed",
        `guide command exited with ${result.code ?? result.signal ?? "unknown status"}`,
        stderr.text.slice(-MAX_STDERR_BYTES),
      );
    if (processErrors.stdin)
      throw new CommandExecutionError(
        "provider-failed",
        `could not write provider request: ${processErrors.stdin.message}`,
      );
    return { stdout: stdout.text, stderr: stderr.text, ...result };
  } catch (error) {
    stopProcess(child);
    if (cancelled) throw new CommandExecutionError("cancelled", "guide generation cancelled");
    if (timedOut)
      throw new CommandExecutionError(
        "timed-out",
        `guide command timed out after ${timeoutMs / 1000} seconds`,
      );
    if (processErrors.spawn)
      throw new CommandExecutionError(
        "spawn-failed",
        `could not start guide command: ${processErrors.spawn.message}`,
      );
    if (error instanceof ProviderFailure) throw error;
    throw new CommandExecutionError(
      "provider-failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export async function runExternalCommand(options: CommandRunOptions): Promise<GuideDocument> {
  const result = await execute(options);
  let response: unknown;
  try {
    response = JSON.parse(result.stdout);
  } catch (error) {
    throw new CommandProtocolError(
      `provider returned invalid JSON: ${error instanceof Error ? error.message : "parse error"}`,
    );
  }
  return parseGenerationResponse(
    response,
    options.request.requestId,
    options.request.acceptedGuideVersions,
  );
}

export function requestUsesRuntimeIds(request: GuideGenerationRequest): boolean {
  return JSON.stringify(request).includes('"runtimeId"');
}
