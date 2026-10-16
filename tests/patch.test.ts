import { expect, test } from "bun:test";

import { findTargetErrors } from "../src/navigation.ts";
import { parsePatch } from "../src/patch.ts";
import { guide } from "./helpers.ts";

// Captured from `git diff --find-renames` with core.quotePath=true.
const gitPatch = [
  "diff --git a/logo.png b/logo.png",
  "new file mode 100644",
  "index 0000000..b1560d1",
  "Binary files /dev/null and b/logo.png differ",
  'diff --git "a/src/caf\\303\\251 menu.ts" "b/src/caf\\303\\251 menu.ts"',
  "index 4fd2a66..18208ef 100644",
  '--- "a/src/caf\\303\\251 menu.ts"\t',
  '+++ "b/src/caf\\303\\251 menu.ts"\t',
  "@@ -1,3 +1,3 @@",
  " line 1 menu",
  " line 2 menu",
  "-line 3 menu",
  "+line 3 changed",
  "diff --git a/src/gone.ts b/src/gone.ts",
  "deleted file mode 100644",
  "index 634e968..0000000",
  "--- a/src/gone.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "--- not a header",
  "-line 2 gone",
  "diff --git a/src/old.ts b/src/new.ts",
  "similarity index 96%",
  "rename from src/old.ts",
  "rename to src/new.ts",
  "index 4a140af..d8bd7be 100644",
  "--- a/src/old.ts",
  "+++ b/src/new.ts",
  "@@ -1,5 +1,6 @@",
  " line 1 rename",
  "+added",
  " line 2 rename",
  " line 3 rename",
  " line 4 rename",
  " line 5 rename",
  "diff --git a/src/insert.ts b/src/insert.ts",
  "index 3be9c81..2c1a4b0 100644",
  "--- a/src/insert.ts",
  "+++ b/src/insert.ts",
  "@@ -2,0 +3 @@",
  "+inserted with -U0",
  "diff --git a/src/moved.ts b/src/pure.ts",
  "similarity index 100%",
  "rename from src/moved.ts",
  "rename to src/pure.ts",
  "",
].join("\n");

test("patch parsing keeps Git paths, renames, deletions, and hunk ranges", () => {
  const files = parsePatch(gitPatch);
  expect(
    files.map(({ path, previousPath, hunks }) => ({
      path,
      previousPath,
      ranges: hunks?.map(({ oldRange, newRange }) => [oldRange, newRange]),
    })),
  ).toEqual([
    { path: "logo.png", previousPath: undefined, ranges: [] },
    {
      path: "src/café menu.ts",
      previousPath: undefined,
      ranges: [
        [
          [1, 3],
          [1, 3],
        ],
      ],
    },
    {
      path: "src/gone.ts",
      previousPath: undefined,
      ranges: [
        [
          [1, 2],
          [0, 0],
        ],
      ],
    },
    {
      path: "src/new.ts",
      previousPath: "src/old.ts",
      ranges: [
        [
          [1, 5],
          [1, 6],
        ],
      ],
    },
    {
      path: "src/insert.ts",
      previousPath: undefined,
      ranges: [
        [
          [2, 2],
          [3, 3],
        ],
      ],
    },
    { path: "src/pure.ts", previousPath: "src/moved.ts", ranges: [] },
  ]);

  const errors = findTargetErrors(
    guide({
      sections: [
        {
          id: "checks",
          title: "Checks",
          targets: [
            { id: "renamed-old", path: "src/old.ts", side: "old", startLine: 2, endLine: 5 },
            { id: "renamed-new", path: "src/old.ts", side: "new", startLine: 2, endLine: 2 },
            { id: "deleted", path: "src/gone.ts", side: "new", startLine: 1, endLine: 1 },
            { id: "outside", path: "src/café menu.ts", side: "new", startLine: 3, endLine: 4 },
            { id: "anchor", path: "src/insert.ts", side: "old", startLine: 2, endLine: 2 },
          ],
        },
      ],
    }),
    files,
  );
  expect(errors.map(({ targetId, field }) => [targetId, field])).toEqual([
    ["renamed-new", "sections[0].targets[1].path"],
    ["deleted", "sections[0].targets[2].side"],
    ["outside", "sections[0].targets[3].startLine"],
  ]);
});
