import { expect, test } from "bun:test";

import {
  checkpointStatus,
  currentTarget,
  getGuideSnapshot,
  nextSection,
  nextTarget,
  reconcileChangeset,
  reviewStatus,
  setCheckpoint,
  setGuide,
  toggleCurrentReviewed,
  toggleScope,
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

  reconcileChangeset(
    changeset([
      file("src/main.ts", { patch: "main-v2" }),
      file("src/caller.ts", { patch: "caller-v1" }),
      file("tests/main.test.ts", { patch: "test-v1" }),
    ]),
    false,
  );

  expect(checkpointStatus("primary")).toBe("changed");
  expect(checkpointStatus("caller")).toBe("unchanged");
  expect(reviewStatus("primary")).toBe("stale-reviewed");

  reconcileChangeset(
    changeset([file("src/main.ts", { patch: "main-v2" }), file("tests/main.test.ts")]),
    false,
  );
  expect(checkpointStatus("caller")).toBe("missing");
});
