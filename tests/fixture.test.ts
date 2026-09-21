import { expect, test } from "bun:test";
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
