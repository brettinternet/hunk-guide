import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { GuideDocument } from "../model.ts";
import { MAX_GUIDE_BYTES } from "./file.ts";

export const GENERATED_GUIDE_PATH = ".hunk/guide.json";

interface DestinationState {
  fingerprint: string;
  identical: boolean;
}

export interface SaveGeneratedGuideOptions {
  cwd: string;
  guide: GuideDocument;
  confirmOverwrite: (path: string) => Promise<boolean>;
  isCurrent?: () => boolean;
}

export type SaveGeneratedGuideResult =
  | { status: "saved" | "unchanged"; path: string }
  | { status: "cancelled"; path: string };

function insideDirectory(root: string, candidate: string) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

export function serializeGuideArtifact(guide: GuideDocument): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(guide, null, 2)}\n`, "utf8");
  if (bytes.byteLength > MAX_GUIDE_BYTES) {
    throw new Error(`generated guide exceeds ${MAX_GUIDE_BYTES} bytes`);
  }
  return bytes;
}

async function destinationState(path: string, expected: Buffer): Promise<DestinationState | null> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("guide destination must not be a symbolic link");
    if (!info.isFile()) throw new Error("guide destination must be a regular file");
    const identical = info.size === expected.byteLength && (await readFile(path)).equals(expected);
    return {
      fingerprint: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`,
      identical,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function prepareDestination(cwd: string) {
  const root = await realpath(resolve(cwd));
  const directory = join(root, ".hunk");
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink()) throw new Error(".hunk must not be a symbolic link");
    if (!info.isDirectory()) throw new Error(".hunk must be a directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { mode: 0o700 });
  }
  const canonicalDirectory = await realpath(directory);
  if (!insideDirectory(root, canonicalDirectory)) {
    throw new Error("guide destination must remain inside the review directory");
  }
  return join(canonicalDirectory, "guide.json");
}

export async function saveGeneratedGuide({
  cwd,
  guide,
  confirmOverwrite,
  isCurrent = () => true,
}: SaveGeneratedGuideOptions): Promise<SaveGeneratedGuideResult> {
  if (!isCurrent()) throw new Error("generated guide is no longer current");
  const bytes = serializeGuideArtifact(guide);
  const path = await prepareDestination(cwd);
  const initial = await destinationState(path, bytes);
  if (initial?.identical) return { status: "unchanged", path };
  if (initial && !(await confirmOverwrite(GENERATED_GUIDE_PATH))) {
    return { status: "cancelled", path };
  }

  const temporaryPath = join(resolve(path, ".."), `.guide.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (!isCurrent()) throw new Error("generated guide is no longer current");
    const current = await destinationState(path, bytes);
    if (current?.identical) return { status: "unchanged", path };
    if ((current?.fingerprint ?? null) !== (initial?.fingerprint ?? null)) {
      throw new Error("guide destination changed while saving; try again");
    }
    await rename(temporaryPath, path);
    return { status: "saved", path };
  } finally {
    try {
      await unlink(temporaryPath);
    } catch {
      // The rename removes the temporary path; failed cleanup must not mask the save result.
    }
  }
}
