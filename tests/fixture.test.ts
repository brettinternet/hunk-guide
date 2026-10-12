import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadGuideFile } from "../src/generators/file.ts";

test("realistic fixture covers multi-file, multi-target, tests, and supporting changes", async () => {
  const guide = await loadGuideFile({
    path: resolve(import.meta.dir, "../fixtures/basic-guide.json"),
    origin: "environment",
  });

  expect(guide.sections.length).toBeGreaterThanOrEqual(6);
  expect(guide.sections.some((section) => section.targets.length > 1)).toBeTrue();
  expect(
    guide.sections.some((section) =>
      section.targets.some((target) => target.path.startsWith("tests/")),
    ),
  ).toBeTrue();
  expect(guide.sections.find((section) => section.id === "tests")?.kind).toBe("verification");
  expect(guide.sections.at(-1)).toMatchObject({ id: "supporting", kind: "supporting" });
});

test("example targets stay inside their paired patch hunks", async () => {
  const examples = resolve(import.meta.dir, "../examples");
  const directories = (await readdir(examples)).filter((name) => /^\d{2}-/.test(name));
  expect(directories.length).toBeGreaterThan(0);

  for (const directory of directories) {
    const guide = await loadGuideFile({
      path: resolve(examples, directory, "guide.json"),
      origin: "environment",
    });
    const patchPath = resolve(examples, directory, "review.patch");
    const patch = await readFile(patchPath, "utf8");
    const check = Bun.spawnSync(["git", "apply", "--numstat", patchPath]);
    expect(check.exitCode, `${directory}: ${check.stderr.toString()}`).toBe(0);

    for (const section of guide.sections) {
      for (const target of section.targets) {
        const filePatch = patch
          .split(/(?=^diff --git )/m)
          .find((part) => part.startsWith(`diff --git a/${target.path} b/${target.path}\n`));
        expect(filePatch, `${directory}: ${target.id} file`).toBeDefined();
        const hunks = [...filePatch!.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)];
        const containsTarget = hunks.some((hunk) => {
          const offset = target.side === "old" ? 1 : 3;
          const start = Number(hunk[offset]);
          const count = Number(hunk[offset + 1] ?? 1);
          return target.startLine >= start && target.endLine < start + count;
        });
        expect(containsTarget, `${directory}: ${target.id} range`).toBeTrue();
      }
    }
  }
});
