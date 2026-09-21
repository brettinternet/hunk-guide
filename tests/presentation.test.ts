import { expect, test } from "bun:test";
import type {
  ExtensionReviewPresentationControls,
  ExtensionReviewPresentationScope,
  ExtensionReviewSnapshotFile,
} from "hunkdiff/extension";

import { syncGuidePresentation } from "../src/presentation.ts";
import {
  enrichFromReviewSnapshot,
  reconcileChangeset,
  setGuide,
  showOverview,
  toggleShowAllChanges,
} from "../src/state.ts";
import { changeset, file, guide } from "./helpers.ts";

function controls(accept = true) {
  const applied: ExtensionReviewPresentationScope[] = [];
  let clearCount = 0;
  const value: ExtensionReviewPresentationControls = {
    setPresentationScope(scope) {
      applied.push(scope);
      return accept;
    },
    clearPresentationScope() {
      clearCount += 1;
    },
  };
  return {
    value,
    applied,
    get clearCount() {
      return clearCount;
    },
  };
}

function snapshotFile(path: string, runtimeId: string): ExtensionReviewSnapshotFile {
  return {
    fileKey: path,
    runtimeId,
    path,
    changeKind: "change",
    stats: { additions: 1, deletions: 0, truncated: false },
    flags: { untracked: false, binary: false, tooLarge: false, partial: false },
    contentIdentity: `${path}-content`,
  };
}

function prepare() {
  setGuide(guide({ id: "presentation-guide" }), {
    kind: "file",
    path: "/repo/guide.json",
  });
  reconcileChangeset(
    changeset([
      file("src/main.ts", { id: "main" }),
      file("src/caller.ts", { id: "caller" }),
      file("tests/main.test.ts", { id: "test" }),
    ]),
    true,
  );
}

test("applies the current section hunk union for the current generation", () => {
  prepare();
  const host = controls();

  expect(syncGuidePresentation(host.value, "generation-1")).toBe("focused");
  expect(host.applied).toEqual([
    {
      generation: "generation-1",
      files: [
        { fileId: "main", hunkIndexes: [0] },
        { fileId: "caller", hunkIndexes: [0] },
      ],
    },
  ]);
  expect(host.clearCount).toBe(0);
});

test("uses authoritative snapshot runtime ids after enrichment", () => {
  prepare();
  enrichFromReviewSnapshot({
    generation: "generation-1",
    stateRevision: 1,
    notes: [],
    files: [
      snapshotFile("src/main.ts", "snapshot-main"),
      snapshotFile("src/caller.ts", "snapshot-caller"),
      snapshotFile("tests/main.test.ts", "snapshot-test"),
    ],
  });
  const host = controls();

  expect(syncGuidePresentation(host.value, "generation-1")).toBe("focused");
  expect(host.applied[0]?.files).toEqual([
    { fileId: "snapshot-main", hunkIndexes: [0] },
    { fileId: "snapshot-caller", hunkIndexes: [0] },
  ]);
});

test("clears focus for show-all and overview", () => {
  prepare();
  const host = controls();

  toggleShowAllChanges();
  expect(syncGuidePresentation(host.value, "generation-1")).toBe("all");
  expect(host.clearCount).toBe(1);

  toggleShowAllChanges();
  showOverview();
  expect(syncGuidePresentation(host.value, "generation-1")).toBe("all");
  expect(host.clearCount).toBe(2);
});

test("fails open when disabled, the generation is unavailable, or the host rejects the scope", () => {
  prepare();
  const disabled = controls();
  expect(syncGuidePresentation(disabled.value, "generation-1", undefined, false)).toBe("all");
  expect(disabled.clearCount).toBe(1);

  const unavailable = controls();
  expect(syncGuidePresentation(unavailable.value, null)).toBe("rejected");
  expect(unavailable.clearCount).toBe(1);

  const rejected = controls(false);
  expect(syncGuidePresentation(rejected.value, "stale-generation")).toBe("rejected");
  expect(rejected.clearCount).toBe(1);
});
