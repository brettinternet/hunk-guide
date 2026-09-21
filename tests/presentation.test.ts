import { expect, test } from "bun:test";
import type {
  ExtensionReviewPresentationControls,
  ExtensionReviewPresentationScope,
} from "hunkdiff/extension";

import { syncGuidePresentation } from "../src/presentation.ts";
import { reconcileChangeset, setGuide, showOverview, toggleShowAllChanges } from "../src/state.ts";
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

function prepare() {
  setGuide(guide({ id: "presentation-guide" }), "/repo/guide.json");
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

test("fails open when the generation is unavailable or the host rejects the scope", () => {
  prepare();
  const unavailable = controls();
  expect(syncGuidePresentation(unavailable.value, null)).toBe("rejected");
  expect(unavailable.clearCount).toBe(1);

  const rejected = controls(false);
  expect(syncGuidePresentation(rejected.value, "stale-generation")).toBe("rejected");
  expect(rejected.clearCount).toBe(1);
});
