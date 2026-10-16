import type { ExtensionChangeset, ExtensionReviewSnapshot } from "hunkdiff/extension";

import { findTargetErrors, resolveGuide } from "../navigation.ts";
import type { GuideDocument } from "../model.ts";
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

function validateTargets(
  guide: GuideDocument,
  changeset: ExtensionChangeset,
  label: string,
  category: "invalid-response" | "changeset-changed",
) {
  const [error] = findTargetErrors(guide, changeset.files);
  if (error)
    throw new ProviderFailure(category, `guide.${error.field}: ${error.message} in ${label}`);
  // Keep the existing resolver as the final consistency check, including rename semantics.
  const resolution = resolveGuide(guide, changeset.files);
  for (const section of guide.sections)
    for (const target of section.targets) {
      if (resolution.targets.get(target.id)?.status !== "resolved")
        throw new ProviderFailure(category, `target ${target.id}: could not resolve in ${label}`);
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
