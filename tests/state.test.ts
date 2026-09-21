import { expect, test } from "bun:test";

import {
  changedUnrepresentedFiles,
  checkpointStatus,
  currentTarget,
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
  visibleSections,
} from "../src/state.ts";
import { changeset, file, guide } from "./helpers.ts";

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
  expect(changedUnrepresentedFiles().map((file) => file.path)).toEqual(["notes.txt"]);

  setSectionVisibility(true, false, false);
  expect(guideProgress().hiddenKinds).toEqual(["supporting", "mechanical"]);
});
