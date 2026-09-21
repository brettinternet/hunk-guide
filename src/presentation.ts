import type {
  ExtensionReviewPresentationControls,
  ExtensionReviewPresentationScope,
} from "hunkdiff/extension";

import { currentSectionFocus, getGuideSnapshot, type GuideSnapshot } from "./state.ts";

export type PresentationResult = "focused" | "all" | "rejected";

export function syncGuidePresentation(
  controls: ExtensionReviewPresentationControls,
  generation: string | null,
  state: GuideSnapshot = getGuideSnapshot(),
  enabled = true,
): PresentationResult {
  const focus = enabled ? currentSectionFocus(state) : null;
  if (!focus) {
    controls.clearPresentationScope();
    return "all";
  }
  if (!generation) {
    controls.clearPresentationScope();
    return "rejected";
  }

  const scope: ExtensionReviewPresentationScope = {
    generation,
    files: focus.files.map((file) => ({
      fileId: file.runtimeId,
      hunkIndexes: file.hunkIndexes,
    })),
  };
  if (controls.setPresentationScope(scope)) return "focused";
  controls.clearPresentationScope();
  return "rejected";
}
