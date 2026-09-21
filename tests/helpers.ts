import type { ExtensionChangeset, ExtensionDiffFile } from "hunkdiff/extension";

import { parseGuide, type GuideDocument } from "../src/model.ts";

export function file(
  path: string,
  options: {
    id?: string;
    previousPath?: string;
    patch?: string;
    oldRange?: [number, number];
    newRange?: [number, number];
  } = {},
): ExtensionDiffFile {
  return {
    id: options.id ?? path,
    path,
    previousPath: options.previousPath,
    patch: options.patch ?? `diff --git a/${path} b/${path}`,
    stats: { additions: 1, deletions: 0 },
    metadata: {},
    hunks: [
      {
        index: 0,
        header: "@@",
        oldRange: options.oldRange ?? [1, 20],
        newRange: options.newRange ?? [1, 20],
      },
    ],
    agent: null,
  };
}

export function changeset(files: ExtensionDiffFile[]): ExtensionChangeset {
  return { id: "changes", sourceLabel: "test", title: "Test changes", files };
}

export function guide(value: Partial<GuideDocument> = {}): GuideDocument {
  return parseGuide({
    version: 1,
    id: "test-guide",
    title: "Test guide",
    sections: [
      {
        id: "implementation",
        title: "Implementation",
        explanation: "Read the implementation first.",
        targets: [
          { id: "primary", path: "src/main.ts", side: "new", startLine: 5, endLine: 8 },
          { id: "caller", path: "src/caller.ts", side: "new", startLine: 10 },
        ],
      },
      {
        id: "tests",
        kind: "verification",
        title: "Tests",
        targets: [{ id: "test", path: "tests/main.test.ts", side: "new", startLine: 4 }],
      },
    ],
    ...value,
  });
}
