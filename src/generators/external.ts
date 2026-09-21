import type { ExtensionChangeset, ExtensionReviewSnapshot } from "hunkdiff/extension";

import { resolveGuide } from "../navigation.ts";
import type { GuideDocument, GuideTarget } from "../model.ts";
import {
  ProviderFailure,
  buildGenerationRequest,
  runExternalCommand,
  type CommandSpec,
  type GuideGenerationRequest,
} from "./command.ts";

export interface GenerationInput {
  changeset: ExtensionChangeset;
  review: ExtensionReviewSnapshot;
  density: "compact" | "balanced" | "thorough";
}

export interface GenerationRunOptions {
  command: CommandSpec;
  cwd: string;
  timeoutSeconds: number;
  signal?: AbortSignal;
}

function targetAddress(target: GuideTarget, file: ExtensionChangeset["files"][number]) {
  return target.side === "old" ? (file.previousPath ?? file.path) : file.path;
}

function targetError(
  path: string,
  message: string,
  category: "invalid-response" | "changeset-changed",
): never {
  throw new ProviderFailure(category, `${path}: ${message}`);
}

function validateTargets(
  guide: GuideDocument,
  changeset: ExtensionChangeset,
  label: string,
  category: "invalid-response" | "changeset-changed",
) {
  const resolution = resolveGuide(guide, changeset.files);
  for (const [sectionIndex, section] of guide.sections.entries()) {
    for (const [targetIndex, target] of section.targets.entries()) {
      const fieldPath = `guide.sections[${sectionIndex}].targets[${targetIndex}]`;
      const matchingSide = changeset.files.filter(
        (file) => targetAddress(target, file) === target.path,
      );
      const oppositeSide = changeset.files.filter((file) =>
        target.side === "old"
          ? file.path === target.path
          : (file.previousPath ?? file.path) === target.path,
      );
      if (matchingSide.length === 0) {
        targetError(
          `${fieldPath}.path`,
          `no ${target.side}-side file in ${label}${oppositeSide.length ? " (wrong side)" : ""}`,
          category,
        );
      }
      if (matchingSide.length > 1)
        targetError(
          `${fieldPath}.path`,
          `ambiguous ${target.side}-side file in ${label}`,
          category,
        );
      const file = matchingSide[0]!;
      if (target.side === "new" && file.changeType === "deleted")
        targetError(`${fieldPath}.side`, `deleted file has no new side in ${label}`, category);
      const ranges = file.hunks ?? [];
      const sideRanges = ranges
        .map((hunk) => (target.side === "old" ? hunk.oldRange : hunk.newRange))
        .filter((range): range is [number, number] => Boolean(range));
      const containing = sideRanges.filter(
        ([start, end]) => target.startLine >= start && target.endLine <= end,
      );
      if (containing.length === 1) continue;
      const intersecting = sideRanges.filter(
        ([start, end]) => start <= target.endLine && target.startLine <= end,
      );
      if (intersecting.length > 1)
        targetError(
          `${fieldPath}.startLine`,
          `range crosses multiple ${target.side}-side hunks in ${label}`,
          category,
        );
      targetError(
        `${fieldPath}.startLine`,
        `line range is outside a ${target.side}-side hunk in ${label}`,
        category,
      );
    }
  }
  // Keep the existing resolver as the final consistency check, including rename semantics.
  for (const section of guide.sections)
    for (const target of section.targets) {
      if (resolution.targets.get(target.id)?.status !== "resolved")
        targetError(`target ${target.id}`, `could not resolve in ${label}`, category);
    }
}

export function validateGeneratedGuide(
  guide: GuideDocument,
  captured: ExtensionChangeset,
  current: ExtensionChangeset,
): void {
  validateTargets(guide, captured, "captured changeset", "invalid-response");
  validateTargets(guide, current, "current changeset", "changeset-changed");
}

export async function generateGuide(
  input: GenerationInput,
  options: GenerationRunOptions,
): Promise<{ guide: GuideDocument; request: GuideGenerationRequest }> {
  const request = buildGenerationRequest(input.changeset, input.review, input.density);
  const guide = await runExternalCommand({
    spec: options.command,
    cwd: options.cwd,
    request,
    timeoutSeconds: options.timeoutSeconds,
    signal: options.signal,
  });
  return { guide, request };
}
