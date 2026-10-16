import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createSandbox } from "../examples/sandbox.ts";
import { loadGuideFile } from "../src/generators/file.ts";
import { findTargetErrors } from "../src/navigation.ts";
import { parsePatch } from "../src/patch.ts";

const examples = resolve(import.meta.dir, "../examples");

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
  const directories = (await readdir(examples)).filter((name) => /^\d{2}-/.test(name));
  expect(directories.length).toBeGreaterThan(0);

  for (const directory of directories) {
    const patchPath = resolve(examples, directory, "review.patch");
    const check = Bun.spawnSync(["git", "apply", "--numstat", patchPath]);
    expect(check.exitCode, `${directory}: ${check.stderr.toString()}`).toBe(0);
    const guidePath = resolve(examples, directory, "guide.json");
    if (!existsSync(guidePath)) continue;

    const guide = await loadGuideFile({ path: guidePath, origin: "environment" });
    const files = parsePatch(await readFile(patchPath, "utf8"));
    expect(findTargetErrors(guide, files), directory).toEqual([]);
  }
});

test("example sandboxes apply in order and pass the guide checker", async () => {
  for (const example of ["03-live-review", "04-guide-your-change"]) {
    const directory = createSandbox(example);
    if (!existsSync(join(directory, ".hunk", "guide.json"))) continue;
    const check = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../bin/check.ts")], {
      cwd: directory,
    });
    expect(check.exitCode, `${example}: ${check.stdout}${check.stderr}`).toBe(0);
  }
});
