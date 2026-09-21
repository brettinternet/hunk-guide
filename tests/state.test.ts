import { expect, test } from "bun:test";
import type { ExtensionReviewSnapshotFile } from "hunkdiff/extension";

import {
  checkpointStatus,
  checkpointSummary,
  currentTarget,
  enrichFromReviewSnapshot,
  getGuideSnapshot,
  guideProgress,
  nextSection,
  nextTarget,
  reconcileChangeset,
  reviewStatus,
  setCheckpoint,
  setGuide,
  setSectionVisibility,
  toggleCurrentReviewed,
  toggleMechanicalSections,
  toggleScope,
  toggleSupportingSections,
  toggleVerificationSections,
  unrepresentedFiles,
  visibleSections,
} from "../src/state.ts";
import { changeset, file, guide } from "./helpers.ts";

function snapshotFile(path: string, contentIdentity: string): ExtensionReviewSnapshotFile {
  return {
    fileKey: path,
    runtimeId: path,
    path,
    changeKind: "change",
    stats: { additions: 1, deletions: 0, truncated: false },
    flags: { untracked: false, binary: false, tooLarge: false, partial: false },
    contentIdentity,
  };
}

test("navigates multiple targets and reconciles reviewed/checkpoint state across reloads", () => {
  const document = guide();
  setGuide(document, "/repo/guide.json");
  reconcileChangeset(
    changeset([
      file("src/main.ts", { patch: "main-v1" }),
      file("src/caller.ts", { patch: "caller-v1" }),
      file("tests/main.test.ts", { patch: "test-v1" }),
    ]),
    true,
  );

  expect(currentTarget()?.id).toBe("primary");
  expect(guideProgress().hiddenKinds).toEqual([]);
  expect(toggleCurrentReviewed()).toBeTrue();
  expect(reviewStatus("primary")).toBe("reviewed");

  nextTarget();
  expect(currentTarget()?.id).toBe("caller");
  nextSection();
  expect(currentTarget()?.id).toBe("test");

  setCheckpoint();
  expect(checkpointStatus("primary")).toBe("unchanged");
  expect(toggleScope()).toBeTrue();
  expect(getGuideSnapshot().scope).toBe("changed");

  const reloaded = changeset([
    file("src/main.ts", { patch: "main-v2" }),
    file("src/caller.ts", { patch: "caller-v1" }),
    file("tests/main.test.ts", { patch: "test-v1" }),
  ]);
  // Hunk emits changeset_loaded and then session_reload for one content reload.
  // The extension passes false for both after the initial changeset.
  reconcileChangeset(reloaded, false);
  reconcileChangeset(reloaded, false);

  expect(getGuideSnapshot().checkpoint).not.toBeNull();
  expect(checkpointStatus("primary")).toBe("changed");
  expect(checkpointStatus("caller")).toBe("unchanged");
  expect(reviewStatus("primary")).toBe("stale-reviewed");

  reconcileChangeset(
    changeset([file("src/main.ts", { patch: "main-v2" }), file("tests/main.test.ts")]),
    false,
  );
  expect(checkpointStatus("caller")).toBe("missing");
});

test("section-kind filters affect only guide visibility and navigation", () => {
  setSectionVisibility(true, true, true);
  setGuide(
    guide({
      id: "filtered-guide",
      sections: [
        {
          id: "implementation",
          kind: "change",
          title: "Implementation",
          targets: [{ id: "code", path: "src/main.ts", side: "new", startLine: 5, endLine: 5 }],
        },
        {
          id: "verification",
          kind: "verification",
          title: "Verification",
          targets: [
            { id: "test", path: "tests/main.test.ts", side: "new", startLine: 4, endLine: 4 },
          ],
        },
        {
          id: "supporting",
          kind: "supporting",
          title: "Supporting",
          targets: [
            { id: "metadata", path: "package.json", side: "new", startLine: 3, endLine: 3 },
          ],
        },
        {
          id: "mechanical",
          kind: "mechanical",
          title: "Generated output",
          targets: [
            { id: "generated", path: "generated/client.ts", side: "new", startLine: 1, endLine: 1 },
          ],
        },
      ],
    }),
    "/repo/filtered-guide.json",
  );
  reconcileChangeset(
    changeset([
      file("src/main.ts"),
      file("tests/main.test.ts"),
      file("package.json"),
      file("generated/client.ts"),
      file("notes.txt"),
    ]),
    true,
  );

  nextSection();
  expect(currentTarget()?.id).toBe("test");
  expect(toggleVerificationSections()).toBeFalse();
  expect(visibleSections().map((section) => section.id)).toEqual([
    "implementation",
    "supporting",
    "mechanical",
  ]);
  expect(currentTarget()?.id).toBe("metadata");

  expect(toggleSupportingSections()).toBeFalse();
  expect(visibleSections().map((section) => section.id)).toEqual(["implementation", "mechanical"]);
  expect(currentTarget()?.id).toBe("generated");

  expect(toggleMechanicalSections()).toBeFalse();
  expect(visibleSections().map((section) => section.id)).toEqual(["implementation"]);
  expect(currentTarget()?.id).toBe("code");
  expect(guideProgress()).toEqual({
    reviewedCount: 0,
    targetCount: 4,
    visibleReviewedCount: 0,
    visibleTargetCount: 1,
    hiddenKinds: ["verification", "supporting", "mechanical"],
  });
  expect(unrepresentedFiles().map((file) => file.path)).toEqual(["notes.txt"]);

  setSectionVisibility(true, false, false);
  expect(guideProgress().hiddenKinds).toEqual(["supporting", "mechanical"]);
});

test("distinguishes changed, missing, new, and unknown guide targets", () => {
  const document = guide({
    id: "checkpoint-target-states",
    sections: [
      {
        id: "implementation",
        kind: "change",
        title: "Implementation",
        targets: [
          { id: "changed", path: "changed.ts", side: "new", startLine: 1, endLine: 1 },
          { id: "missing", path: "missing.ts", side: "new", startLine: 1, endLine: 1 },
          { id: "ambiguous", path: "ambiguous.ts", side: "new", startLine: 1, endLine: 1 },
        ],
      },
    ],
  });
  setGuide(document, "/repo/checkpoint-target-states.json");
  reconcileChangeset(
    changeset([
      file("changed.ts", { patch: "changed-v1" }),
      file("missing.ts"),
      file("ambiguous.ts"),
    ]),
    true,
  );
  setCheckpoint();

  reconcileChangeset(
    changeset([
      file("changed.ts", { patch: "changed-v2" }),
      file("ambiguous.ts", { id: "ambiguous-1" }),
      file("ambiguous.ts", { id: "ambiguous-2" }),
      file("new.ts"),
    ]),
    false,
  );
  setGuide(
    guide({
      ...document,
      sections: [
        ...document.sections,
        {
          id: "new-section",
          kind: "change",
          title: "New section",
          targets: [{ id: "new", path: "new.ts", side: "new", startLine: 1, endLine: 1 }],
        },
      ],
    }),
    "/repo/checkpoint-target-states.json",
  );

  expect(checkpointStatus("changed")).toBe("changed");
  expect(checkpointStatus("missing")).toBe("missing");
  expect(checkpointStatus("ambiguous")).toBe("unknown");
  expect(checkpointStatus("new")).toBe("new");
  expect(checkpointSummary()).toMatchObject({
    changedTargets: 1,
    missingTargets: 1,
    newTargets: 1,
    unknownTargets: 1,
  });
});

test("classifies files outside the guide against the checkpoint", () => {
  setGuide(
    guide({
      id: "outside-file-states",
      sections: [
        {
          id: "implementation",
          kind: "change",
          title: "Implementation",
          targets: [{ id: "guided", path: "guided.ts", side: "new", startLine: 1, endLine: 1 }],
        },
      ],
    }),
    "/repo/outside-file-states.json",
  );
  reconcileChangeset(
    changeset([
      file("guided.ts"),
      file("changed.txt", { patch: "changed-v1" }),
      file("unknown.txt", { patch: "unknown-v1" }),
      file("old-name.txt"),
    ]),
    true,
  );
  enrichFromReviewSnapshot({
    generation: "one",
    stateRevision: 1,
    notes: [],
    files: [snapshotFile("unknown.txt", "authoritative-v1")],
  });
  setCheckpoint();

  reconcileChangeset(
    changeset([
      file("guided.ts"),
      file("changed.txt", { patch: "changed-v2" }),
      file("unknown.txt", { patch: "unknown-v1" }),
      file("new.txt"),
      file("new-name.txt", { previousPath: "old-name.txt" }),
    ]),
    false,
  );

  expect(unrepresentedFiles()).toEqual([
    { path: "changed.txt", status: "changed" },
    { path: "unknown.txt", status: "unknown" },
    { path: "new.txt", status: "new" },
    { path: "new-name.txt", status: "changed" },
  ]);
  expect(checkpointSummary()).toMatchObject({
    changedFiles: 2,
    newFiles: 1,
    unknownFiles: 1,
  });
});

test("changed scope relocates the cursor after authoritative enrichment", () => {
  setGuide(
    guide({
      id: "enriched-scope",
      sections: [
        {
          id: "implementation",
          kind: "change",
          title: "Implementation",
          targets: [
            { id: "unchanged", path: "unchanged.ts", side: "new", startLine: 1, endLine: 1 },
            { id: "changed", path: "changed.ts", side: "new", startLine: 1, endLine: 1 },
          ],
        },
      ],
    }),
    "/repo/enriched-scope.json",
  );
  reconcileChangeset(
    changeset([
      file("unchanged.ts", { patch: "unchanged-patch" }),
      file("changed.ts", { patch: "changed-v1" }),
    ]),
    true,
  );
  enrichFromReviewSnapshot({
    generation: "one",
    stateRevision: 1,
    notes: [],
    files: [snapshotFile("unchanged.ts", "unchanged-content"), snapshotFile("changed.ts", "v1")],
  });
  setCheckpoint();

  reconcileChangeset(
    changeset([
      file("unchanged.ts", { patch: "unchanged-patch" }),
      file("changed.ts", { patch: "changed-v2" }),
    ]),
    false,
  );
  enrichFromReviewSnapshot({
    generation: "two",
    stateRevision: 2,
    notes: [],
    files: [snapshotFile("unchanged.ts", "unchanged-content"), snapshotFile("changed.ts", "v2")],
  });
  expect(toggleScope()).toBeTrue();

  expect(currentTarget()?.id).toBe("changed");
  expect(visibleSections().map((section) => section.id)).toEqual(["implementation"]);
});
