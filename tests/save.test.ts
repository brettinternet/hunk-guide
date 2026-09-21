import { afterEach, expect, test } from "bun:test";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GENERATED_GUIDE_PATH,
  saveGeneratedGuide,
  serializeGuideArtifact,
} from "../src/generators/save.ts";
import { guide } from "./helpers.ts";

const cleanupPaths: string[] = [];

async function ignoreMissing(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function cleanupRoot(root: string) {
  const guideDirectory = join(root, ".hunk");
  await ignoreMissing(() => unlink(join(guideDirectory, "guide.json")));
  try {
    const info = await lstat(guideDirectory);
    if (info.isSymbolicLink()) await unlink(guideDirectory);
    else await rmdir(guideDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await ignoreMissing(() => rmdir(root));
}

afterEach(async () => {
  while (cleanupPaths.length > 0) await cleanupRoot(cleanupPaths.pop()!);
});

async function temporaryRoot(prefix = "hunk-guide-save-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(root);
  return root;
}

test("saves a generated guide atomically and skips identical rewrites", async () => {
  const root = await temporaryRoot();
  let confirmations = 0;
  const document = guide({ id: "saved-guide" });
  const first = await saveGeneratedGuide({
    cwd: root,
    guide: document,
    confirmOverwrite: async () => {
      confirmations += 1;
      return true;
    },
  });
  expect(first).toEqual({
    status: "saved",
    path: join(await realpath(root), GENERATED_GUIDE_PATH),
  });
  expect(await readFile(first.path, "utf8")).toBe(
    serializeGuideArtifact(document).toString("utf8"),
  );

  const second = await saveGeneratedGuide({
    cwd: root,
    guide: document,
    confirmOverwrite: async () => {
      confirmations += 1;
      return true;
    },
  });
  expect(second.status).toBe("unchanged");
  expect(confirmations).toBe(0);
});

test("confirms before replacing a different regular guide", async () => {
  const root = await temporaryRoot();
  await mkdir(join(root, ".hunk"));
  const path = join(await realpath(root), GENERATED_GUIDE_PATH);
  await writeFile(path, "old guide\n");
  const document = guide({ id: "replacement" });

  expect(
    await saveGeneratedGuide({ cwd: root, guide: document, confirmOverwrite: async () => false }),
  ).toEqual({ status: "cancelled", path });
  expect(await readFile(path, "utf8")).toBe("old guide\n");

  let current = true;
  await expect(
    saveGeneratedGuide({
      cwd: root,
      guide: document,
      confirmOverwrite: async () => {
        current = false;
        return true;
      },
      isCurrent: () => current,
    }),
  ).rejects.toThrow(/no longer current/);
  expect(await readFile(path, "utf8")).toBe("old guide\n");

  expect(
    await saveGeneratedGuide({ cwd: root, guide: document, confirmOverwrite: async () => true }),
  ).toEqual({ status: "saved", path });
  expect(await readFile(path, "utf8")).toBe(serializeGuideArtifact(document).toString("utf8"));
});

test("refuses a symlinked guide directory", async () => {
  const root = await temporaryRoot();
  const outside = await temporaryRoot("hunk-guide-save-outside-");
  await symlink(outside, join(root, ".hunk"));

  await expect(
    saveGeneratedGuide({ cwd: root, guide: guide(), confirmOverwrite: async () => true }),
  ).rejects.toThrow(/symbolic link/);
});
