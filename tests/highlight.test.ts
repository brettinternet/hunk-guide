import { expect, test } from "bun:test";

import { targetHighlights } from "../src/highlight.ts";

test("highlights only changed patch lines in the current target range", () => {
  const marks = targetHighlights(
    {
      path: "src/main.ts",
      patch: ["@@ -4,2 +4,3 @@", " same", "-old", "+new", "+next"].join("\n"),
    },
    {
      id: "target",
      path: "src/main.ts",
      side: "new",
      startLine: 5,
      endLine: 6,
    },
  );

  expect(marks).toEqual([
    { side: "new", line: 5, range: [0, 3], tone: "current" },
    { side: "new", line: 6, range: [0, 4], tone: "current" },
  ]);
});

test("highlights new files whose old range starts at zero", () => {
  const marks = targetHighlights(
    { path: "src/new.ts", patch: "@@ -0,0 +1,2 @@\n+first\n+second" },
    { id: "new", path: "src/new.ts", side: "new", startLine: 1, endLine: 2 },
  );

  expect(marks.map((mark) => mark.line)).toEqual([1, 2]);
});
