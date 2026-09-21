import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { parseGuide, type GuideDocument } from "../model.ts";

const MAX_GUIDE_BYTES = 1_000_000;
const DEFAULT_GUIDE_FILES = [".hunk/guide.json", "hunk-guide.json"] as const;

export interface GuideFileSource {
  path: string;
  origin: "environment" | "config" | "default";
}

export interface ResolveGuideFileOptions {
  cwd: string;
  configFile?: string;
  environmentFile?: string;
  exists?: (path: string) => Promise<boolean>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function insideDirectory(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

export async function resolveGuideFile({
  cwd,
  configFile,
  environmentFile,
  exists = fileExists,
}: ResolveGuideFileOptions): Promise<GuideFileSource | null> {
  const root = resolve(cwd);
  if (environmentFile) {
    return {
      path: isAbsolute(environmentFile) ? environmentFile : resolve(root, environmentFile),
      origin: "environment",
    };
  }

  if (configFile) {
    const path = resolve(root, configFile);
    if (!insideDirectory(root, path)) {
      throw new Error("[extension.hunk-guide].file must remain inside the review directory");
    }
    return { path, origin: "config" };
  }

  for (const defaultFile of DEFAULT_GUIDE_FILES) {
    const path = resolve(root, defaultFile);
    if (await exists(path)) return { path, origin: "default" };
  }
  return null;
}

export interface LoadGuideFileOptions {
  read?: (path: string) => Promise<string>;
  size?: (path: string) => Promise<number>;
}

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

export async function loadGuideFile(
  source: GuideFileSource,
  { read = (path) => readFile(path, "utf8"), size = fileSize }: LoadGuideFileOptions = {},
): Promise<GuideDocument> {
  if ((await size(source.path)) > MAX_GUIDE_BYTES) {
    throw new Error(`guide file exceeds ${MAX_GUIDE_BYTES} bytes`);
  }

  const text = await read(source.path);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`could not parse guide JSON: ${detail}`);
  }
  return parseGuide(value);
}
