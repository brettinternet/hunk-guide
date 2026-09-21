import { describe, expect, test } from "bun:test";

import { resolveGuide } from "../src/navigation.ts";
import { file, guide } from "./helpers.ts";

describe("resolveGuide", () => {
  test("resolves paths and exact side ranges", () => {
    const result = resolveGuide(guide(), [
      file("src/main.ts", { id: "main-runtime", newRange: [4, 12] }),
      file("src/caller.ts", { newRange: [10, 10] }),
      file("tests/main.test.ts", { newRange: [1, 8] }),
    ]);

    expect(result.targets.get("primary")).toMatchObject({
      status: "resolved",
      runtimeId: "main-runtime",
      hunkIndex: 0,
    });
    expect(result.targets.get("caller")?.status).toBe("resolved");
  });

  test("uses the previous path on the old side", () => {
    const oldGuide = guide({
      sections: [
        {
          id: "rename",
          title: "Rename",
          targets: [
            {
              id: "old-name",
              path: "src/before.ts",
              side: "old",
              startLine: 7,
              endLine: 7,
            },
          ],
        },
      ],
    });
    const result = resolveGuide(oldGuide, [
      file("src/after.ts", { previousPath: "src/before.ts", oldRange: [5, 9] }),
    ]);

    expect(result.targets.get("old-name")?.status).toBe("resolved");
  });

  test("reports a missing file", () => {
    const result = resolveGuide(guide(), [file("src/main.ts")]);
    expect(result.targets.get("caller")?.status).toBe("missing-file");
  });

  test("reports a missing line instead of clamping", () => {
    const result = resolveGuide(guide(), [file("src/main.ts", { newRange: [9, 20] })]);
    expect(result.targets.get("primary")?.status).toBe("missing-line");
  });

  test("rejects a range spanning multiple hunks", () => {
    const main = file("src/main.ts");
    main.hunks = [
      { index: 0, header: "@@", newRange: [5, 6] },
      { index: 1, header: "@@", newRange: [7, 8] },
    ];
    const result = resolveGuide(guide(), [main]);
    expect(result.targets.get("primary")?.status).toBe("missing-line");
  });
});
